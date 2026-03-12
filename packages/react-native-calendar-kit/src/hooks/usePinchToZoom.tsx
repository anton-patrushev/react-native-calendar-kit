import { useCallback, useEffect, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import type { GestureType } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  scrollTo,
  setNativeProps,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useCalendar } from '../context/CalendarProvider';
import { clampValues } from '../utils/utils';
import { Platform } from 'react-native';

const SCALE_FACTOR = 0.5;
const SPRING_DAMPING = 15;
const SPRING_STIFFNESS = 100;
/** Allow overscrolling past min/max by this fraction of zoomScale range. */
const BOUNDARY_PADDING_FRAC = 0.05;

const usePinchToZoom = () => {
  const {
    verticalListRef,
    timelineHeight,
    zoomScale,
    minZoomScale,
    maxZoomScale,
    offsetY,
    allowPinchToZoom,
  } = useCalendar();

  const startOffsetY = useSharedValue(offsetY.value);
  const pinchGestureRef = useRef<GestureType | undefined>(undefined);
  const startScale = useSharedValue(1);
  const lastScale = useSharedValue(1);

  const boundaryPadding =
    (maxZoomScale - minZoomScale) * BOUNDARY_PADDING_FRAC;

  const pinchGesture = Gesture.Pinch()
    .onBegin(() => {
      // Cancel any in-flight overscroll spring from a previous gesture.
      cancelAnimation(zoomScale);
      startScale.value = lastScale.value;
      startOffsetY.value = offsetY.value;
    })
    .runOnJS(false)
    .onUpdate(({ focalY, scale, velocity }) => {
      if (velocity === 0) {
        startOffsetY.value = offsetY.value;
        return;
      }
      const oldZoomScale = zoomScale.value;
      // Calculate new zoomScale from gesture scale
      const newGestureScale = startScale.value * scale;
      const scaledDiff = (newGestureScale - lastScale.value) * SCALE_FACTOR;
      const newZoomScale = oldZoomScale * (1 + scaledDiff);

      // Clamp with rubber-band padding
      const clampedZoomScale = clampValues(
        newZoomScale,
        minZoomScale - boundaryPadding,
        maxZoomScale + boundaryPadding
      );

      // Focal-point anchoring: keep the point under the finger stationary
      const anchorFrac =
        (focalY + startOffsetY.value) /
        (timelineHeight.value * oldZoomScale);
      zoomScale.value = clampedZoomScale;
      const newOffsetY =
        anchorFrac * timelineHeight.value * clampedZoomScale - focalY;

      startOffsetY.value = newOffsetY;
      offsetY.value = newOffsetY;
      if (typeof setNativeProps === 'function') {
        setNativeProps(verticalListRef, {
          contentOffset: { y: newOffsetY, x: 0 },
        });
      } else {
        scrollTo(verticalListRef, 0, newOffsetY, true);
      }
      lastScale.value = newGestureScale;
    })
    .onEnd(() => {
      // Spring back to clamped bounds if overscrolled
      const finalZoomScale = clampValues(
        zoomScale.value,
        minZoomScale,
        maxZoomScale
      );
      if (finalZoomScale !== zoomScale.value) {
        zoomScale.value = withSpring(finalZoomScale, {
          damping: SPRING_DAMPING,
          stiffness: SPRING_STIFFNESS,
        });
        const scaleFactor = finalZoomScale / zoomScale.value;
        const targetOffset = startOffsetY.value * scaleFactor;
        offsetY.value = targetOffset;
        if (typeof setNativeProps === 'function') {
          setNativeProps(verticalListRef, {
            contentOffset: { y: targetOffset, x: 0 },
          });
        } else {
          scrollTo(verticalListRef, 0, targetOffset, true);
        }
      }
      // Reset gesture scale trackers (NOT zoomScale — it persists)
      lastScale.value = 1;
      startScale.value = 1;
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

  return { pinchGesture, pinchGestureRef };
};

export default usePinchToZoom;
