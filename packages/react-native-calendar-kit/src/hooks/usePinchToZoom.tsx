import { useCallback, useEffect, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import type { GestureType } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  scrollTo,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
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
  // At gesture end we snap the real ScrollView contentOffset to the
  // accumulated position via a single scrollTo, then reset this back
  // to 0.
  const pinchScrollDelta = useSharedValue(0);

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

      // Apply the focal-anchor scroll movement as a translateY on the
      // inner-scale wrapper instead of moving the real ScrollView. See
      // the pinchScrollDelta declaration above for why. The transform
      // direction is inverted: a positive scroll target (content moves
      // up under the viewport) corresponds to a negative translateY.
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
      // Commit the accumulated pinch-time scroll translateY back into the
      // real ScrollView contentOffset, then zero out the delta. From the
      // user's POV nothing changes visually — translateY going from -X
      // back to 0 happens in the same UI tick as scrollTo lands at X.
      // (Reanimated batches both writes into a single commit.)
      const liveOffsetY = startOffsetY.value - pinchScrollDelta.value;
      let targetOffset = liveOffsetY;

      if (finalZoomScale !== zoomScale.value) {
        // Recompute target offset using the same anchor from gesture start
        const anchorContentY = startFocalY.value + startOffsetY.value;
        const anchorFrac =
          anchorContentY / (timelineHeight.value * startZoomScale.value);
        targetOffset =
          anchorFrac * timelineHeight.value * finalZoomScale -
          startFocalY.value;

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

      // Defer the delta reset by one frame so the native scrollTo above
      // has time to land before we drop the translateY compensation. On
      // Fabric, scrollTo dispatches a native scroll command that lands
      // ~1 frame later, while a direct `pinchScrollDelta.value = 0` write
      // propagates immediately to innerScaleStyle. Resetting instantly
      // produces a one-frame visual jump (a few pixels down on zoom-in,
      // up on zoom-out) because the transform drops its delta before the
      // ScrollView's contentOffset catches up. withDelay(16) holds the
      // delta and withTiming(0, duration:0) snaps to 0 once the delay
      // expires — by which point the native scroll has committed.
      pinchScrollDelta.value = withDelay(16, withTiming(0, { duration: 0 }));

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

  return { pinchGesture, pinchGestureRef, isPinching, pinchScrollDelta };
};

export default usePinchToZoom;
