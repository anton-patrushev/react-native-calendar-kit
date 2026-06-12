import type { FC } from 'react';
import React, { useCallback, useMemo, useState } from 'react';
import type { ViewStyle } from 'react-native';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import type { SharedValue } from 'react-native-reanimated';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
} from 'react-native-reanimated';
import { MILLISECONDS_IN_MINUTE } from '../constants';
import { useBody } from '../context/BodyContext';
import {
  useDragEvent,
  useDragEventActions,
} from '../context/DragEventProvider';
import { useTheme } from '../context/ThemeProvider';
import type { ResourceItem, SelectedEventType } from '../types';
import { parseDateTime } from '../utils/dateUtils';
import DragDot from './DragDot';

export interface DraggableEventProps {
  index: number;
  startUnix: number;
  visibleDates: Record<string, { diffDays: number; unix: number }>;
  renderEvent?: (
    event: SelectedEventType,
    options: {
      width: SharedValue<number>;
      height: SharedValue<number>;
    }
  ) => React.ReactElement | null;
  TopEdgeComponent?: React.ReactElement | null;
  BottomEdgeComponent?: React.ReactElement | null;
  containerStyle?: ViewStyle;
  resources?: ResourceItem[];
}

export const DraggableEvent: FC<DraggableEventProps> = ({
  startUnix,
  visibleDates,
  index,
  renderEvent,
  resources,
  TopEdgeComponent,
  BottomEdgeComponent,
  containerStyle,
}) => {
  const theme = useTheme(
    useCallback((state) => {
      return {
        primaryColor: state.colors.primary,
        eventContainerStyle: state.eventContainerStyle,
        eventTitleStyle: state.eventTitleStyle,
      };
    }, [])
  );
  const {
    minuteHeight,
    columnWidth,
    start,
    numberOfDays,
    counterScaleStyle,
    zoomScale,
  } = useBody();
  const {
    dragStartUnix,
    dragSelectedStartUnix,
    dragSelectedDuration,
    dragSelectedStartMinutes,
    selectedEvent,
    isDraggingAnim,
    isPendingConfirmation,
  } = useDragEvent();
  const { triggerDragSelectedEvent } = useDragEventActions();
  const totalResources =
    resources && resources.length > 1 ? resources.length : 1;

  const eventWidth = columnWidth / totalResources;

  const eventWidthAnim = useDerivedValue(() => eventWidth, [eventWidth]);

  const resourceIndex = useMemo(() => {
    if (!resources) {
      return -1;
    }

    return resources.findIndex(
      (resource) => resource.id === selectedEvent?.resourceId
    );
  }, [resources, selectedEvent?.resourceId]);
  const left = useMemo(() => {
    const diffDays = visibleDates[startUnix]?.diffDays ?? 0;
    return diffDays * columnWidth;
  }, [visibleDates, startUnix, columnWidth]);

  const top = useDerivedValue(() => {
    if (index > 0) {
      const dragSelectedStart =
        dragSelectedStartUnix.value +
        dragSelectedStartMinutes.value * MILLISECONDS_IN_MINUTE;
      const diffMinutes =
        (startUnix - dragSelectedStart) / MILLISECONDS_IN_MINUTE;
      return (0 - diffMinutes - start) * minuteHeight.value;
    }
    return (dragSelectedStartMinutes.value - start) * minuteHeight.value;
  }, [startUnix, start, index]);

  const eventHeight = useDerivedValue(
    () => dragSelectedDuration.value * minuteHeight.value
  );
  const startX = resourceIndex !== -1 ? resourceIndex * eventWidth : 0;

  const isDragging = useDerivedValue(() => dragStartUnix.value !== -1);
  const animView = useAnimatedStyle(() => {
    // When pending confirmation, keep the dimmed version visible
    if (isPendingConfirmation.value) {
      return {
        top: top.value,
        height: eventHeight.value,
        opacity: 0.3, // Dimmed but visible
      };
    }

    return {
      top: top.value,
      height: eventHeight.value,
      opacity:
        isDragging.value || dragSelectedStartMinutes.value === -1 ? 0 : 1,
    };
  }, [resourceIndex]);

  // Base border width / radius — sourced from consumer's containerStyle
  // first, then theme.eventContainerStyle, then library defaults. Always
  // zoom-compensate so the consumer's static value doesn't visibly stretch
  // at high zoom.
  const consumerSelectedBorderWidth =
    typeof (containerStyle as { borderWidth?: number } | undefined)
      ?.borderWidth === 'number'
      ? (containerStyle as { borderWidth: number }).borderWidth
      : undefined;
  const consumerSelectedBorderRadius =
    typeof (containerStyle as { borderRadius?: number } | undefined)
      ?.borderRadius === 'number'
      ? (containerStyle as { borderRadius: number }).borderRadius
      : undefined;
  const themeSelectedBorderRadius =
    typeof (theme.eventContainerStyle as { borderRadius?: number } | undefined)
      ?.borderRadius === 'number'
      ? (theme.eventContainerStyle as { borderRadius: number }).borderRadius
      : undefined;
  const baseSelectedWidth = consumerSelectedBorderWidth ?? 3;
  const baseSelectedRadius =
    consumerSelectedBorderRadius ?? themeSelectedBorderRadius ?? 4;

  const sideBordersStyle = {
    borderLeftWidth: baseSelectedWidth,
    borderRightWidth: baseSelectedWidth,
  };
  // Top/bottom widths + borderRadius animate with zoom so their visual
  // values stay constant. Selecting an event then pinching is rare; this
  // animated layout prop fires only when zoomScale changes.
  const outlineBorderStyle = useAnimatedStyle(() => ({
    borderTopWidth: baseSelectedWidth / zoomScale.value,
    borderBottomWidth: baseSelectedWidth / zoomScale.value,
    borderRadius: baseSelectedRadius / zoomScale.value,
  }));

  const gesture = Gesture.Tap()
    .runOnJS(true)
    .onTouchesDown(() => {
      triggerDragSelectedEvent({
        startIndex: index,
        type: 'center',
        resourceIndex,
      });
    })
    .onTouchesUp(() => {
      isDraggingAnim.value = false;
    });

  const topEdgeGesture = Gesture.Tap()
    .runOnJS(true)
    .onTouchesDown(() => {
      triggerDragSelectedEvent({
        startIndex: index,
        type: 'top',
        resourceIndex,
      });
    })
    .onTouchesUp(() => {
      isDraggingAnim.value = false;
    });

  const bottomEdgeGesture = Gesture.Tap()
    .runOnJS(true)
    .onTouchesDown(() => {
      triggerDragSelectedEvent({
        startIndex: index,
        type: 'bottom',
        resourceIndex,
      });
    })
    .onTouchesUp(() => {
      isDraggingAnim.value = false;
    });

  return (
    <Animated.View
      style={[
        styles.container,
        { width: eventWidth, left: startX + left },
        animView,
      ]}>
      {/* When the consumer provides `containerStyle`, hand visual control
          fully over to them — see DraggingEvent for the same rationale. */}
      {selectedEvent && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            theme.eventContainerStyle,
            {
              backgroundColor:
                selectedEvent?.color ??
                (Platform.OS === 'android'
                  ? theme.primaryColor
                  : 'transparent'),
              borderColor: theme.primaryColor,
              overflow: 'hidden',
            },
            containerStyle,
            // Apply our computed border widths/radius LAST so they always
            // win over consumer's shorthand `borderWidth` — see DraggingEvent.
            sideBordersStyle,
            outlineBorderStyle,
          ]}>
          {renderEvent ? (
            renderEvent(selectedEvent, {
              width: eventWidthAnim,
              height: eventHeight,
            })
          ) : (
            <Animated.View
              style={[{ transformOrigin: 'top' }, counterScaleStyle]}>
              <Text style={[styles.eventTitle, theme.eventTitleStyle]}>
                {selectedEvent.title}
              </Text>
            </Animated.View>
          )}
        </Animated.View>
      )}
      <GestureDetector gesture={gesture}>
        <View style={[StyleSheet.absoluteFill, { cursor: 'pointer' }]} />
      </GestureDetector>
      <GestureDetector gesture={topEdgeGesture}>
        {/* Default (center) transformOrigin so counter-scale shrinks around
            the dot's center — keeps its visual center on the event's
            top/bottom edge regardless of zoom. */}
        <Animated.View
          style={[
            styles.dot,
            styles.dotLeft,
            numberOfDays === 1 && styles.dotLeftSingle,
            counterScaleStyle,
          ]}>
          {TopEdgeComponent || <DragDot />}
        </Animated.View>
      </GestureDetector>
      <GestureDetector gesture={bottomEdgeGesture}>
        <Animated.View
          style={[
            styles.dot,
            styles.dotRight,
            numberOfDays === 1 && styles.dotRightSingle,
            counterScaleStyle,
          ]}>
          {BottomEdgeComponent || <DragDot />}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
  },
  dot: {
    position: 'absolute',
    borderRadius: 12,
    width: 24,
    height: 24,
    cursor: 'pointer',
  },
  event: {
    overflow: 'hidden',
    borderLeftWidth: 3,
    borderRightWidth: 3,
    // borderRadius supplied by outlineBorderStyle (animated by zoom).
  },
  dotLeft: { top: -12, left: -12 },
  dotRight: { bottom: -12, right: -12 },
  eventTitle: { fontSize: 12, paddingHorizontal: 2 },
  dotLeftSingle: { left: 0 },
  dotRightSingle: { right: 0 },
});

interface DraggableEventWrapperProps {
  startUnix: number;
  visibleDates: Record<string, { diffDays: number; unix: number }>;
  renderEvent?: (
    event: SelectedEventType,
    options: {
      width: SharedValue<number>;
      height: SharedValue<number>;
    }
  ) => React.ReactElement | null;
  renderDraggableEvent?: (
    event: DraggableEventProps
  ) => React.ReactElement | null;
  resources?: ResourceItem[];
}

const DraggableEventWrapper: FC<DraggableEventWrapperProps> = ({
  startUnix,
  visibleDates,
  renderEvent,
  renderDraggableEvent,
  resources,
}) => {
  const [draggableDates, setDraggableDates] = useState<number[]>([]);
  const {
    dragSelectedStartUnix,
    dragSelectedDuration,
    dragSelectedStartMinutes,
  } = useDragEvent();

  const endUnix = useMemo(() => {
    const lastDate = Object.values(visibleDates).pop();
    if (!lastDate) {
      return 0;
    }
    return parseDateTime(lastDate.unix).plus({ days: 1 }).toMillis();
  }, [visibleDates]);

  const _handleDragSelectedEvent = (
    unix: number,
    minutes: number,
    duration: number
  ) => {
    const dragStartUnix = unix + minutes * MILLISECONDS_IN_MINUTE;
    const dragEndUnix = dragStartUnix + duration * MILLISECONDS_IN_MINUTE;
    const isValidStart = dragStartUnix >= startUnix && dragStartUnix < endUnix;
    const isValidEnd = dragEndUnix > startUnix && dragEndUnix < endUnix;
    if (!isValidStart && !isValidEnd) {
      setDraggableDates([]);
      return;
    }

    const startDate = parseDateTime(dragStartUnix).startOf('day');
    const endDate = parseDateTime(dragEndUnix).startOf('day');
    const diffDays = endDate.diff(startDate, 'day').days;
    if (diffDays === 0) {
      setDraggableDates([unix]);
      return;
    }

    const dates = [];
    for (let i = 0; i <= diffDays; i++) {
      dates.push(parseDateTime(unix).plus({ days: i }).toMillis());
    }
    setDraggableDates(dates);
  };

  useAnimatedReaction(
    () => {
      return {
        dragSelectedStartUnix: dragSelectedStartUnix.value,
        dragSelectedStartMinutes: dragSelectedStartMinutes.value,
        dragSelectedDuration: dragSelectedDuration.value,
      };
    },
    (result) => {
      if (
        result.dragSelectedStartUnix >= 0 &&
        result.dragSelectedStartMinutes >= 0 &&
        result.dragSelectedDuration >= 0
      ) {
        runOnJS(_handleDragSelectedEvent)(
          result.dragSelectedStartUnix,
          result.dragSelectedStartMinutes,
          result.dragSelectedDuration
        );
      } else {
        runOnJS(setDraggableDates)([]);
      }
    },
    [startUnix, endUnix]
  );

  return draggableDates.map((date, index) => {
    if (!visibleDates[date]) {
      return null;
    }

    if (renderDraggableEvent) {
      return (
        <React.Fragment key={`${date}-${index}`}>
          {renderDraggableEvent({
            startUnix: date,
            visibleDates,
            index,
            renderEvent,
            resources,
          })}
        </React.Fragment>
      );
    }

    return (
      <DraggableEvent
        key={`${date}-${index}`}
        startUnix={date}
        visibleDates={visibleDates}
        index={index}
        renderEvent={renderEvent}
        resources={resources}
      />
    );
  });
};

export default DraggableEventWrapper;
