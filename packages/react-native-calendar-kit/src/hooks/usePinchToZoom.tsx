import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
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
import { useCalendar } from '../context/CalendarProvider';
import { clampValues } from '../utils/utils';

/**
 * Sensitivity multiplier applied to the raw pinch scale delta.
 * Lower = slower zoom, higher = faster zoom.
 */
const SCALE_SENSITIVITY = 0.5;

/** Spring config for overscroll snap-back animation. */
const SPRING_DAMPING = 15;
const SPRING_STIFFNESS = 100;

/**
 * Extra padding (in scale units) beyond min/max bounds to give
 * a rubber-band feel before snapping back.
 */
const BOUNDARY_PADDING_PX = 8;

/**
 * Scale-based pinch-to-zoom hook.
 *
 * Performance model:
 * - During gesture: updates only `zoomScale` SharedValue → O(1) per frame.
 *   The CalendarBody applies `transform: [{ scaleY: zoomScale }]` to the
 *   content container, so all events scale visually without per-element
 *   height recalculation.
 * - On gesture end: commits `timeIntervalHeight *= zoomScale; zoomScale = 1`,
 *   triggering a one-time O(N) recalc of all event positions at the new zoom.
 *
 * Consumers get `zoomScale` via SizeAnimation and BodyContext to optionally
 * counter-scale text or make discrete layout decisions during the gesture.
 */
const usePinchToZoom = () => {
  const {
    verticalListRef,
    maxTimeIntervalHeight,
    minTimeIntervalHeight,
    timeIntervalHeight,
    offsetY,
    allowPinchToZoom,
    zoomScale,
  } = useCalendar();

  const pinchGestureRef = useRef<GestureType | undefined>(undefined);

  /** Committed timeIntervalHeight at gesture start. */
  const baseHeight = useSharedValue(0);
  /** Unscaled content Y coordinate under the focal point at gesture start. */
  const anchorContentY = useSharedValue(0);
  /** Screen Y coordinate of the focal point at gesture start. */
  const anchorScreenY = useSharedValue(0);
  /**
   * True from onBegin until commit completes.
   * Guards _onScroll from feedback-looping offsetY during gesture/spring.
   */
  const isPinching = useSharedValue(false);

  /** Scrolls the vertical list to the given Y offset on the UI thread. */
  const scrollToOffset = (y: number) => {
    'worklet';
    if (typeof setNativeProps === 'function') {
      setNativeProps(verticalListRef, {
        contentOffset: { y, x: 0 },
      });
    } else {
      scrollTo(verticalListRef, 0, y, false);
    }
  };

  /**
   * Commit the current zoomScale into timeIntervalHeight and reset.
   * Called after the gesture ends (immediately or after overscroll spring).
   */
  const commitZoom = (finalScale: number) => {
    'worklet';
    timeIntervalHeight.value = baseHeight.value * finalScale;
    zoomScale.value = 1;

    // Adjust scroll offset for the committed coordinate system.
    // The small difference from EXTRA_HEIGHT not scaling is negligible
    // and self-corrects on the next scroll event.
    const newOffsetY =
      anchorContentY.value * finalScale - anchorScreenY.value;
    offsetY.value = newOffsetY;
    scrollToOffset(newOffsetY);

    isPinching.value = false;
  };

  // ─── Focal-point tracking ──────────────────────────────────────────────
  // Fires whenever zoomScale changes (during gesture AND during
  // overscroll spring). Keeps the anchor point stable on screen.
  useAnimatedReaction(
    () => zoomScale.value,
    (currentScale, prevScale) => {
      if (!isPinching.value || currentScale === prevScale) {
        return;
      }
      const newOffsetY =
        anchorContentY.value * currentScale - anchorScreenY.value;
      offsetY.value = newOffsetY;
      scrollToOffset(newOffsetY);
    }
  );

  // ─── Pinch gesture (mobile) ────────────────────────────────────────────
  const pinchGesture = Gesture.Pinch()
    .onBegin(({ focalY }) => {
      // Cancel any in-flight overscroll spring from a previous gesture.
      cancelAnimation(zoomScale);

      isPinching.value = true;
      baseHeight.value = timeIntervalHeight.value;

      // At begin zoomScale is 1, so content coordinates = scroll coordinates.
      anchorContentY.value = offsetY.value + focalY;
      anchorScreenY.value = focalY;
    })
    .runOnJS(false)
    .onUpdate(({ scale, velocity }) => {
      if (velocity === 0) {
        return;
      }

      // Apply sensitivity damping to the raw pinch scale.
      const rawScale = 1 + (scale - 1) * SCALE_SENSITIVITY;

      // Clamp with rubber-band padding beyond min/max bounds.
      const minScale =
        (minTimeIntervalHeight - BOUNDARY_PADDING_PX) / baseHeight.value;
      const maxScale =
        (maxTimeIntervalHeight + BOUNDARY_PADDING_PX) / baseHeight.value;
      const clampedScale = clampValues(rawScale, minScale, maxScale);

      // This is the ONLY shared value updated per frame → O(1).
      // The useAnimatedReaction above handles scroll offset.
      zoomScale.value = clampedScale;
    })
    .onEnd(() => {
      // Determine the clamped target scale (within hard bounds, no padding).
      const targetScale = clampValues(
        zoomScale.value,
        minTimeIntervalHeight / baseHeight.value,
        maxTimeIntervalHeight / baseHeight.value
      );

      const isOverscrolled =
        Math.abs(targetScale - zoomScale.value) > 0.001;

      if (isOverscrolled) {
        // Spring zoomScale back to bounds. The useAnimatedReaction
        // above continuously adjusts scroll offset during the spring.
        // On completion, commit the final scale.
        zoomScale.value = withSpring(
          targetScale,
          { damping: SPRING_DAMPING, stiffness: SPRING_STIFFNESS },
          (finished) => {
            if (finished) {
              commitZoom(targetScale);
            }
          }
        );
      } else {
        // Within bounds — commit immediately.
        commitZoom(targetScale);
      }
    })
    .enabled(allowPinchToZoom)
    .withRef(pinchGestureRef);

  // ─── Ctrl+Wheel zoom (web) ────────────────────────────────────────────
  // Web uses direct timeIntervalHeight updates (no scaleY) since
  // per-frame performance is not an issue on desktop.
  const lastWheelScale = useSharedValue(1);
  const containerRef = useRef<HTMLElement | null>(null);

  const onWheel = useCallback(
    (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();

      const scaleDelta = -event.deltaY * 0.01;
      const newScale = Math.max(0.1, lastWheelScale.value + scaleDelta);

      const containerBounds = containerRef.current?.getBoundingClientRect();
      const containerTop = containerBounds?.top || 0;
      const focalY = event.clientY - containerTop;

      const scaleFactor = newScale / lastWheelScale.value;
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

      lastWheelScale.value = newScale;
    },
    [
      lastWheelScale,
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
