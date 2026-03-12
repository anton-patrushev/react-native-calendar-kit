import { useCallback, useEffect, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import type { GestureType } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  scrollTo,
  setNativeProps,
  useAnimatedReaction,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import type { AnimatedRef, SharedValue } from 'react-native-reanimated';
import type Animated from 'react-native-reanimated';
import { useCalendar } from '../context/CalendarProvider';
import { clampValues } from '../utils/utils';
import { Platform } from 'react-native';

const SCALE_FACTOR = 0.5;
const SPRING_DAMPING = 15;
const SPRING_STIFFNESS = 100;
const BOUNDARY_PADDING = 8;

/**
 * Minimum height change (px) required to propagate a pinch update.
 * Skipping sub-pixel updates reduces the number of Reanimated mapper
 * evaluations per frame without any perceptible visual difference.
 */
const MIN_HEIGHT_DELTA = 0.5;

/**
 * Scroll the vertical list to a given offset, using the fastest
 * available method (setNativeProps > scrollTo).
 */
function scrollToOffset(
  ref: AnimatedRef<Animated.ScrollView>,
  y: number
): void {
  'worklet';
  if (typeof setNativeProps === 'function') {
    setNativeProps(ref, { contentOffset: { y, x: 0 } });
  } else {
    scrollTo(ref, 0, y, false);
  }
}

const usePinchToZoom = () => {
  const {
    verticalListRef,
    maxTimeIntervalHeight,
    minTimeIntervalHeight,
    timeIntervalHeight,
    offsetY,
    allowPinchToZoom,
    timeInterval,
  } = useCalendar();

  const pinchGestureRef = useRef<GestureType | undefined>(undefined);

  // ── Anchor-based state ──────────────────────────────────────────────
  // Instead of accumulating offsets frame-by-frame (which causes drift),
  // we store the focal point as a "minute" in the timeline and a fixed
  // screen-Y position.  Every frame we deterministically recompute the
  // scroll offset from: newOffset = anchorMinute * minuteHeight − screenY.
  const anchorMinute = useSharedValue(0);
  const anchorScreenY = useSharedValue(0);
  const startHeight = useSharedValue(0);

  // True while gesture is active OR spring is settling.
  // Used to suppress the JS onScroll handler from overwriting offsetY
  // with native-clamped values.
  const isPinching = useSharedValue(false);

  const pinchGesture = Gesture.Pinch()
    .onBegin(({ focalY }) => {
      'worklet';
      // Cancel any in-progress spring from a previous pinch
      cancelAnimation(timeIntervalHeight);
      isPinching.value = true;

      startHeight.value = timeIntervalHeight.value;
      const minuteHeight = timeIntervalHeight.value / timeInterval;
      anchorMinute.value = (focalY + offsetY.value) / minuteHeight;
      anchorScreenY.value = focalY;
    })
    .runOnJS(false)
    .onUpdate(({ focalY, scale, velocity }) => {
      'worklet';
      if (velocity === 0) {
        // Re-anchor when fingers go still (prevents jump on resume)
        const minuteHeight = timeIntervalHeight.value / timeInterval;
        anchorMinute.value = (focalY + offsetY.value) / minuteHeight;
        anchorScreenY.value = focalY;
        startHeight.value = timeIntervalHeight.value;
        return;
      }

      // Compute height directly from gesture scale (no accumulation).
      // SCALE_FACTOR dampens sensitivity: scale=1.5 → 1.25x height.
      const rawHeight = startHeight.value * (1 + (scale - 1) * SCALE_FACTOR);
      const clampedHeight = clampValues(
        rawHeight,
        minTimeIntervalHeight - BOUNDARY_PADDING,
        maxTimeIntervalHeight + BOUNDARY_PADDING
      );

      if (
        Math.abs(clampedHeight - timeIntervalHeight.value) < MIN_HEIGHT_DELTA
      ) {
        return;
      }

      timeIntervalHeight.value = clampedHeight;

      // Deterministic offset from anchor — no accumulation, no drift.
      const minuteHeight = clampedHeight / timeInterval;
      const newOffset = anchorMinute.value * minuteHeight - focalY;
      offsetY.value = newOffset;

      // Update anchor screen position (focal point can move during pinch)
      anchorScreenY.value = focalY;

      scrollToOffset(verticalListRef, newOffset);
    })
    .onEnd(() => {
      'worklet';
      const currentHeight = timeIntervalHeight.value;
      const finalHeight = clampValues(
        currentHeight,
        minTimeIntervalHeight,
        maxTimeIntervalHeight
      );

      if (Math.abs(finalHeight - currentHeight) < 0.5) {
        // Already within bounds — no spring needed
        timeIntervalHeight.value = finalHeight;
        // Compute final offset
        const minuteHeight = finalHeight / timeInterval;
        const newOffset =
          anchorMinute.value * minuteHeight - anchorScreenY.value;
        offsetY.value = newOffset;
        scrollToOffset(verticalListRef, newOffset);
        isPinching.value = false;
        return;
      }

      // Animate to final height — the useAnimatedReaction below
      // will track each frame and update the scroll offset.
      timeIntervalHeight.value = withSpring(finalHeight, {
        damping: SPRING_DAMPING,
        stiffness: SPRING_STIFFNESS,
      });
    })
    .enabled(allowPinchToZoom)
    .withRef(pinchGestureRef);

  // ── Spring tracking ─────────────────────────────────────────────────
  // While isPinching is true and timeIntervalHeight is animating (spring),
  // recompute scroll offset every frame to keep the anchor point stable.
  // This prevents the "content size changes but offset is static" problem.
  useAnimatedReaction(
    () => timeIntervalHeight.value,
    (currentHeight, prevHeight) => {
      if (!isPinching.value) return;
      if (prevHeight === null || currentHeight === prevHeight) return;

      const minuteHeight = currentHeight / timeInterval;
      const newOffset =
        anchorMinute.value * minuteHeight - anchorScreenY.value;
      offsetY.value = newOffset;
      scrollToOffset(verticalListRef, newOffset);

      // Check if spring has settled (within bounds and barely moving)
      const finalHeight = clampValues(
        currentHeight,
        minTimeIntervalHeight,
        maxTimeIntervalHeight
      );
      if (Math.abs(currentHeight - finalHeight) < 0.1) {
        isPinching.value = false;
      }
    }
  );

  // ── Web: Ctrl+Wheel zoom ───────────────────────────────────────────
  const containerRef = useRef<HTMLElement | null>(null);
  const lastScale = useSharedValue(1);
  const onWheel = useCallback(
    (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();

        const scaleDelta = -event.deltaY * 0.01;
        const newScale = Math.max(0.1, lastScale.value + scaleDelta);

        const containerBounds = containerRef.current?.getBoundingClientRect();
        const containerTop = containerBounds?.top || 0;
        const focalY = event.clientY - containerTop;

        const scaleFactor = newScale / lastScale.value;
        const newHeight = timeIntervalHeight.value * scaleFactor;

        const clampedHeight = clampValues(
          newHeight,
          minTimeIntervalHeight,
          maxTimeIntervalHeight
        );

        if (clampedHeight !== timeIntervalHeight.value) {
          const heightDiff = clampedHeight - timeIntervalHeight.value;
          const scaleOrigin =
            (focalY + offsetY.value) / timeIntervalHeight.value;
          const newOffsetY = offsetY.value + heightDiff * scaleOrigin;

          timeIntervalHeight.value = clampedHeight;
          offsetY.value = newOffsetY;
          scrollTo(verticalListRef, 0, newOffsetY, false);
        }

        lastScale.value = newScale;
      }
    },
    [
      lastScale,
      offsetY,
      timeIntervalHeight,
      verticalListRef,
      minTimeIntervalHeight,
      maxTimeIntervalHeight,
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

  return { pinchGesture, pinchGestureRef, isPinching };
};

export default usePinchToZoom;
