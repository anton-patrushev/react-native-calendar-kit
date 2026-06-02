import { useCallback, useEffect, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import type { GestureType } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  scrollTo,
  useAnimatedReaction,
  useScrollViewOffset,
  useSharedValue,
} from 'react-native-reanimated';
import { useCalendar } from '../context/CalendarProvider';
import { clampValues } from '../utils/utils';
import { Platform } from 'react-native';

const SCALE_FACTOR = 0.5;
const IS_ANDROID = Platform.OS === 'android';

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
    ({ s, t }) => {
      'worklet';
      if (!Number.isNaN(t) && Math.abs(s - t) < 0.5) {
        // Scroll has arrived at the gesture-end target. Re-baseline so
        // subsequent vertical scrolls don't keep auto-compensating, and
        // clear the delta so translateY becomes zoom-only.
        startOffsetY.value = s;
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

      // Platform-split pinch-time scroll handling:
      //
      // ANDROID: per-frame `scrollTo` on the underlying ScrollView. The
      // earlier translate-only iOS approach (which avoids Fabric commit
      // ordering shake) does NOT translate well to Android — the
      // ScrollView's gesture handler keeps emitting native scroll
      // events alongside the pinch (we can't reliably lock scrollEnabled
      // mid-touch on Android without wedging the dispatcher), so any
      // residual offset has to be reconciled on release and the user
      // sees a jump. Driving the real contentOffset every frame keeps
      // the visual content position in lockstep with the focal-anchor
      // math, and Android's ScrollView absorbs per-frame `scrollTo`
      // smoothly without the iOS-side shake.
      //
      // iOS: translate-only via `pinchScrollDelta` folded into
      // innerScaleStyle's translateY. Avoids the per-frame native scroll
      // commit that races the inner-scale transform commit on Fabric.
      // Combined with the iOS-only scrollEnabled lock (in CalendarBody),
      // this keeps scrollOffsetLive stable through the pinch and the
      // gesture-end transition lands cleanly via pinchEndTarget +
      // auto-compensate reaction.
      if (IS_ANDROID) {
        offsetY.value = newOffsetY;
        scrollTo(verticalListRef, 0, newOffsetY, false);
      } else {
        pinchScrollDelta.value = startOffsetY.value - newOffsetY;
      }
      lastScale.value = newGestureScale;
    })
    .onEnd(() => {
      // Android: nothing to reconcile. Per-frame `scrollTo` in onUpdate
      // kept the ScrollView's contentOffset in lockstep with the
      // focal-anchor target throughout the pinch. zoomScale is already
      // within [min, max] (we clamp directly in onUpdate, no rubber-
      // band overshoot), so there's no spring-back to handle either.
      if (IS_ANDROID) {
        lastScale.value = 1;
        startScale.value = 1;
        return;
      }

      // iOS path — translate-only during pinch, reconcile here:
      // Commit the accumulated pinch-time scroll translateY back into
      // the real ScrollView contentOffset, then arm the auto-compensate
      // reaction. From the user's POV nothing changes visually because
      // innerScaleStyle's translateY includes a residual term that
      // auto-decreases as scrollOffsetLive catches up to pinchEndTarget.
      const liveOffsetY = startOffsetY.value - pinchScrollDelta.value;
      const targetOffset = liveOffsetY;

      offsetY.value = targetOffset;
      scrollTo(verticalListRef, 0, targetOffset, false);
      // Arm the settle reaction. Once the native scroll lands at
      // `targetOffset` (typically next frame), the reaction will
      // re-baseline startOffsetY and zero pinchScrollDelta — atomically
      // with the scroll arrival.
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
