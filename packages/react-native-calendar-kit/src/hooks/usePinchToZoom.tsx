import { useCallback, useEffect, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import type { GestureType } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  scrollTo,
  useAnimatedReaction,
  useScrollViewOffset,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useCalendar } from '../context/CalendarProvider';
import { clampValues } from '../utils/utils';
import { Platform } from 'react-native';

const SCALE_FACTOR = 0.5;
const SPRING_DAMPING = 15;
const SPRING_STIFFNESS = 100;

const usePinchToZoom = () => {
  const {
    verticalListRef,
    timelineHeight,
    zoomScale,
    minZoomScale,
    maxZoomScale,
    offsetY,
    allowPinchToZoom,
    // Owned by CalendarContainer so the onZoomChange reaction can gate on it.
    isPinching,
    isSettling,
  } = useCalendar();

  const pinchGestureRef = useRef<GestureType | undefined>(undefined);
  const startScale = useSharedValue(1);
  const lastScale = useSharedValue(1);

  // Gesture-start snapshot — used for focal-point anchoring.
  // We compute the anchor once at gesture start and derive the scroll
  // offset purely from the zoom ratio change each frame.
  const startFocalY = useSharedValue(0);
  const startOffsetY = useSharedValue(0);
  const startZoomScale = useSharedValue(1);

  // Pinch-time scroll compensation. During a pinch we DON'T call
  // scrollTo every frame (that triggers a separate native scroll commit
  // which races the inner-scale transform commit on Fabric and produces
  // a visible shake of the scrollable surface). Instead we accumulate
  // the focal-anchor delta here and let CalendarBody fold it into the
  // inner-scale's translateY in the same animated style as the scaleY.
  // Single commit per frame on the inner-scale node.
  //
  // At gesture end we DO NOT reset this to 0 instantly — that produces
  // a one-frame visual jump because the SV write propagates to
  // innerScaleStyle before the native scrollTo lands. Instead, the
  // formula in innerScaleStyle reads from `scrollOffsetLive` (the
  // ScrollView's live contentOffset) and a transition residual that
  // auto-decreases as the scroll catches up. Once the scroll arrives at
  // its target, the reaction below re-baselines `startOffsetY` and
  // resets `pinchScrollDelta` — atomically in one worklet tick.
  const pinchScrollDelta = useSharedValue(0);

  // Live scroll position from the ScrollView. This SV updates as native
  // scroll commits land. innerScaleStyle reads from it to compensate
  // the pinch-end transition in sync with whichever frame the native
  // scroll lands on.
  const scrollOffsetLive = useScrollViewOffset(verticalListRef);

  // Gesture-end transition state. When set, innerScaleStyle's translateY
  // includes a residual term that auto-decreases as `scrollOffsetLive`
  // approaches `pinchEndTarget`. When the scroll arrives, the reaction
  // below re-baselines startOffsetY + clears the delta.
  const pinchEndTarget = useSharedValue(Number.NaN);

  useAnimatedReaction(
    () => ({ s: scrollOffsetLive.value, t: pinchEndTarget.value }),
    (curr, prev) => {
      'worklet';
      if (Number.isNaN(curr.t)) return;
      // Skip the same UI tick that armed the target. Without this guard,
      // if scrollOffsetLive happens to already be near targetOffset (e.g.
      // tiny pinches at clamped bounds, or the calculated target equals
      // current scroll), the reaction fires immediately on the arming
      // tick and clears the delta BEFORE the native scrollTo has had a
      // chance to move — producing a visible snap.
      if (!prev || Number.isNaN(prev.t)) return;
      // Detect "arrived" either by passing through the target (sign
      // change of (s - t)) OR by being within a tolerance window. On
      // Android with sparse scroll events, the live offset can step from
      // before to past the target in one emission, never landing inside
      // a tight tolerance — `crossed` catches that case. The tolerance
      // is widened to 2px (from 0.5px) to absorb sub-pixel jitter on
      // both platforms.
      const crossed = (prev.s - curr.t) * (curr.s - curr.t) <= 0;
      const within = Math.abs(curr.s - curr.t) < 2;
      if (crossed || within) {
        // Scroll has arrived at the gesture-end target. Re-baseline so
        // subsequent vertical scrolls don't keep auto-compensating, and
        // clear the delta so translateY becomes zoom-only.
        startOffsetY.value = curr.s;
        pinchScrollDelta.value = 0;
        pinchEndTarget.value = Number.NaN;
      }
    }
  );

  const pinchGesture = Gesture.Pinch()
    .onBegin(({ focalY }) => {
      // Cancel any in-flight overscroll spring from a previous gesture.
      cancelAnimation(zoomScale);
      startScale.value = lastScale.value;
      // Snapshot current state for focal-point anchoring
      startFocalY.value = focalY;
      startOffsetY.value = offsetY.value;
      startZoomScale.value = zoomScale.value;
      pinchScrollDelta.value = 0;
      // Defensive reset of gesture-end state. If a prior gesture's
      // arrival reaction never fired (e.g. sparse Android scroll events
      // overshot the tolerance window), pinchEndTarget would still be a
      // finite number — the residual term in innerScaleStyle would then
      // compute against the PREVIOUS gesture's pinchStartOffsetY and
      // produce a visible jump on this new gesture. Clear here so each
      // gesture starts from a clean state.
      pinchEndTarget.value = Number.NaN;
      // Also reset isSettling so a cancelled spring's dropped completion
      // callback (Reanimated v4 + Android: callbacks may not fire when
      // cancelAnimation interrupts withSpring) can't leave the flag
      // stuck true across gestures.
      isSettling.value = false;
      isPinching.value = true;
    })
    .runOnJS(false)
    .onUpdate(({ scale, velocity }) => {
      if (velocity === 0) {
        return;
      }
      const oldZoomScale = zoomScale.value;
      // Calculate new zoomScale from gesture scale
      const newGestureScale = startScale.value * scale;
      const scaledDiff = (newGestureScale - lastScale.value) * SCALE_FACTOR;
      const newZoomScale = oldZoomScale * (1 + scaledDiff);

      // Clamp directly to [min, max] — no rubber-band overshoot. Allowing
      // overshoot here caused a visible "bounce" on Fabric: on release we
      // had to spring `zoomScale` back to the clamp, but the focal-point
      // anchored scroll was already set to its post-clamp target, so the
      // content visibly jumped at release moment and sprang back as the
      // value settled. Fabric commits content-size and scroll-offset
      // updates in separate phases, exposing the mismatch.
      const clampedZoomScale = clampValues(
        newZoomScale,
        minZoomScale,
        maxZoomScale
      );

      // Focal-point anchoring using gesture-start snapshot.
      // anchorFrac = normalized position (0..1) of the focal point in content
      // space at gesture start. We scale it by the new zoom to get the new
      // content-space position, then subtract the original viewport focalY
      // to get the scroll offset that keeps the anchor stationary on screen.
      const anchorContentY = startFocalY.value + startOffsetY.value;
      const anchorFrac =
        anchorContentY / (timelineHeight.value * startZoomScale.value);

      zoomScale.value = clampedZoomScale;
      const newOffsetY =
        anchorFrac * timelineHeight.value * clampedZoomScale -
        startFocalY.value;

      // Apply the focal-anchor scroll movement as a translateY on the
      // inner-scale wrapper instead of moving the real ScrollView. See
      // the pinchScrollDelta declaration above for why. The transform
      // direction is inverted: a positive scroll target (content moves
      // up under the viewport) corresponds to a negative translateY.
      //
      // Use the gesture-start SNAPSHOT (not the live scroll offset). An
      // earlier experiment fed `scrollOffsetLive` directly here on the
      // theory that absorbing native-scroll drift would cure the
      // Android gesture-end jump. It made shake during the pinch worse
      // instead: on Android, `simultaneousHandlers={pinchGestureRef}`
      // intentionally lets the native ScrollView scroll concurrently
      // with the pinch, and Android scroll events arrive on a sparse
      // bursty cadence — `scrollOffsetLive` lurches between samples,
      // which gets translated 1:1 into translateY. The scroll-lock
      // (added below in CalendarBody) is what actually prevents the
      // drift; this formula must stay snapshot-based.
      pinchScrollDelta.value = startOffsetY.value - newOffsetY;
      lastScale.value = newGestureScale;
    })
    .onEnd(() => {
      // Spring back to clamped bounds if overscrolled
      const finalZoomScale = clampValues(
        zoomScale.value,
        minZoomScale,
        maxZoomScale
      );

      // Recompute target offset from focal-anchor math (independent of
      // pinchScrollDelta). The pinchScrollDelta shortcut was tied to
      // snapshot semantics and stopped being meaningful once we switched
      // onUpdate to use the live scroll offset.
      const anchorContentY = startFocalY.value + startOffsetY.value;
      const anchorFrac =
        anchorContentY / (timelineHeight.value * startZoomScale.value);
      const targetOffset =
        anchorFrac * timelineHeight.value * finalZoomScale - startFocalY.value;

      if (finalZoomScale !== zoomScale.value) {
        // Flag the settle window so CalendarContainer defers
        // onZoomChange until the spring completes — otherwise the
        // intermediate percent ticks during the spring would land on the
        // JS thread and shake consumers that do setState in their
        // onZoomChange handler.
        isSettling.value = true;
        zoomScale.value = withSpring(
          finalZoomScale,
          {
            damping: SPRING_DAMPING,
            stiffness: SPRING_STIFFNESS,
          },
          () => {
            'worklet';
            isSettling.value = false;
          }
        );
      }

      offsetY.value = targetOffset;
      scrollTo(verticalListRef, 0, targetOffset, false);
      // Arm the settle reaction. Once the native scroll lands at
      // `targetOffset` (typically next frame), the reaction will
      // re-baseline startOffsetY and zero pinchScrollDelta — atomically
      // with the scroll arrival. Until then, innerScaleStyle's translateY
      // auto-compensates via the live scroll position so visual stays
      // constant through the transition.
      pinchEndTarget.value = targetOffset;

      // Reset gesture scale trackers (NOT zoomScale — it persists)
      lastScale.value = 1;
      startScale.value = 1;
    })
    .onFinalize(() => {
      isPinching.value = false;
    })
    .enabled(allowPinchToZoom)
    .withRef(pinchGestureRef);

  // Web ctrl+wheel zoom
  const containerRef = useRef<HTMLElement | null>(null);
  const onWheel = useCallback(
    (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();

        const scaleDelta = -event.deltaY * 0.01;
        const newGestureScale = Math.max(0.1, lastScale.value + scaleDelta);

        const containerBounds = containerRef.current?.getBoundingClientRect();
        const containerTop = containerBounds?.top || 0;
        const focalY = event.clientY - containerTop;

        const scaleFactor = newGestureScale / lastScale.value;
        const newZoomScale = zoomScale.value * scaleFactor;

        const clampedZoomScale = clampValues(
          newZoomScale,
          minZoomScale,
          maxZoomScale
        );

        if (clampedZoomScale !== zoomScale.value) {
          const anchorFrac =
            (focalY + offsetY.value) /
            (timelineHeight.value * zoomScale.value);

          zoomScale.value = clampedZoomScale;
          const newOffsetY =
            anchorFrac * timelineHeight.value * clampedZoomScale - focalY;

          offsetY.value = newOffsetY;
          scrollTo(verticalListRef, 0, newOffsetY, false);
        }

        lastScale.value = newGestureScale;
      }
    },
    [
      lastScale,
      offsetY,
      zoomScale,
      timelineHeight,
      verticalListRef,
      minZoomScale,
      maxZoomScale,
    ]
  );

  useEffect(() => {
    if (!verticalListRef || Platform.OS !== 'web') {
      return;
    }

    const scrollNode = verticalListRef.current?.getScrollableNode?.();
    containerRef.current = scrollNode;
    scrollNode?.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      scrollNode?.removeEventListener('wheel', onWheel);
    };
  }, [onWheel, verticalListRef]);

  return {
    pinchGesture,
    pinchGestureRef,
    isPinching,
    pinchScrollDelta,
    scrollOffsetLive,
    pinchStartOffsetY: startOffsetY,
    pinchEndTarget,
  };
};

export default usePinchToZoom;
