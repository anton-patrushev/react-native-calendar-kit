import { useCallback, useEffect, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import type { GestureType } from 'react-native-gesture-handler';
import {
  cancelAnimation,
  scrollTo,
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
    scrollVisibleHeightAnim,
  } = useCalendar();

  // Max reachable scroll for a given zoom: contentHeight - viewport (>= 0).
  const maxOffsetForZoom = (z: number) => {
    'worklet';
    return Math.max(0, timelineHeight.value * z - scrollVisibleHeightAnim.value);
  };

  const pinchGestureRef = useRef<GestureType | undefined>(undefined);
  const startScale = useSharedValue(1);
  const lastScale = useSharedValue(1);

  // Gesture-start snapshots for focal anchoring.
  const startFocalY = useSharedValue(0);
  const startOffsetY = useSharedValue(0);
  const startZoomScale = useSharedValue(1);

  // iOS-only viewport-center anchor translate (APP-5422). iOS freezes the scroll
  // during the pinch and anchors via this transform (no scrollTo → no shake);
  // stays 0 on Android, which scrolls for real. See onUpdate.
  const pinchAnchorTranslate = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onBegin(({ focalY }) => {
      // Cancel any in-flight overscroll spring from a previous gesture.
      cancelAnimation(zoomScale);
      startScale.value = lastScale.value;
      // Snapshot current state for focal-point anchoring
      startFocalY.value = focalY;
      startOffsetY.value = offsetY.value;
      startZoomScale.value = zoomScale.value;
      pinchAnchorTranslate.value = 0;
      isPinching.value = true;
    })
    .runOnJS(false)
    .onUpdate(({ scale, velocity }) => {
      if (velocity === 0) {
        return;
      }
      const oldZoomScale = zoomScale.value;
      const newGestureScale = startScale.value * scale;
      const scaledDiff = (newGestureScale - lastScale.value) * SCALE_FACTOR;
      const newZoomScale = oldZoomScale * (1 + scaledDiff);
      // Clamp directly to [min, max] — no overshoot (overshoot bounced on Fabric).
      const clampedZoomScale = clampValues(
        newZoomScale,
        minZoomScale,
        maxZoomScale
      );

      zoomScale.value = clampedZoomScale;

      if (IS_ANDROID) {
        // Android: real per-frame scrollTo, focal-point anchored. Android has no
        // iOS-Fabric transform/scroll commit race, so the natural finger anchor
        // is smooth and the scroll is already settled at release (no reconcile).
        const anchorContentY = startFocalY.value + startOffsetY.value;
        const anchorFrac =
          anchorContentY / (timelineHeight.value * startZoomScale.value);
        const newOffsetY = clampValues(
          anchorFrac * timelineHeight.value * clampedZoomScale -
            startFocalY.value,
          0,
          maxOffsetForZoom(clampedZoomScale)
        );
        offsetY.value = newOffsetY;
        scrollTo(verticalListRef, 0, newOffsetY, false);
      } else {
        // iOS: frozen scroll, anchor via transform only (no scrollTo → no shake).
        // δ keeps the viewport-center content fixed: it solves
        // a*z + δ - startOffsetY = vh/2 for a = (startOffsetY + vh/2)/startZoom.
        const vh = scrollVisibleHeightAnim.value;
        const anchorDelta =
          startZoomScale.value > 0
            ? (startOffsetY.value + vh / 2) *
              (1 - clampedZoomScale / startZoomScale.value)
            : 0;
        pinchAnchorTranslate.value = anchorDelta;
      }
      lastScale.value = newGestureScale;
    })
    .onEnd(() => {
      // Android scroll tracked live — already settled, nothing to reconcile.
      if (IS_ANDROID) {
        lastScale.value = 1;
        startScale.value = 1;
        return;
      }
      // iOS: commit the frozen scroll to the anchored position (startOffsetY - δ,
      // clamped to range) and clear δ.
      const z = zoomScale.value;
      const delta = pinchAnchorTranslate.value;
      const targetScroll = clampValues(
        startOffsetY.value - delta,
        0,
        maxOffsetForZoom(z)
      );
      offsetY.value = targetScroll;
      pinchAnchorTranslate.value = 0;
      scrollTo(verticalListRef, 0, targetScroll, false);
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
    pinchAnchorTranslate,
  };
};

export default usePinchToZoom;
