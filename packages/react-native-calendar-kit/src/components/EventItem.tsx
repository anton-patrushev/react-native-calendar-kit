import type { FC } from 'react';
import React, { useCallback, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Pressable,
  type GestureResponderEvent,
} from 'react-native';
import Animated, { useDerivedValue } from 'react-native-reanimated';
import { MILLISECONDS_IN_DAY } from '../constants';
import { useBody } from '../context/BodyContext';
import { useTheme } from '../context/ThemeProvider';
import type { OnEventResponse, PackedEvent, SizeAnimation } from '../types';
import { parseDateTime } from '../utils/dateUtils';
import Text from './Text';

interface EventItemProps {
  event: PackedEvent;
  startUnix: number;
  renderEvent?: (event: PackedEvent, size: SizeAnimation) => React.ReactNode;
  onPressEvent?: (event: OnEventResponse) => void;
  onLongPressEvent?: (
    event: PackedEvent,
    resEvent: GestureResponderEvent
  ) => void;
  isDragging?: boolean;
  visibleDates: Record<string, { diffDays: number; unix: number }>;
  totalResources?: number;
}

const EventItem: FC<EventItemProps> = ({
  event: eventInput,
  startUnix,
  renderEvent,
  onPressEvent,
  onLongPressEvent,
  isDragging,
  visibleDates,
  totalResources,
}) => {
  const theme = useTheme(
    useCallback((state) => {
      return {
        eventContainerStyle: state.eventContainerStyle,
        eventTitleStyle: state.eventTitleStyle,
        overlapEventBorderColor: state.overlapEventBorderColor,
        overlapEventBorderWidth: state.overlapEventBorderWidth,
      };
    }, [])
  );

  const {
    minuteHeight,
    start,
    end,
    rightEdgeSpacing,
    overlapEventsSpacing,
    columnWidth,
    resourcePerPage,
    enableResourceScroll,
    zoomScale,
    counterScaleStyle,
  } = useBody();
  const { _internal, ...event } = eventInput;
  const timeRange = end - start;
  const {
    duration,
    startMinutes = 0,
    total,
    index,
    columnSpan,
    startUnix: eventStartUnix,
    widthPercentage,
    xOffsetPercentage,
    resourceIndex,
    zIndex,
    stackLevel,
  } = _internal;

  const data = useMemo(() => {
    const maxDuration = end - start;
    let newStart = startMinutes - start;
    let totalDuration = Math.min(duration, maxDuration);
    if (newStart < 0) {
      totalDuration += newStart;
      newStart = 0;
    }

    // Get the event's day start (not the event time, but the start of that day)
    const eventDayStart = parseDateTime(eventStartUnix)
      .startOf('day')
      .toMillis();

    // Use the diffDays from visibleDates if available, otherwise calculate it
    let diffDays = 0;
    if (visibleDates[eventDayStart]) {
      diffDays = visibleDates[eventDayStart].diffDays;
    } else {
      // Fallback: calculate based on day difference
      const referenceDayStart = parseDateTime(startUnix)
        .startOf('day')
        .toMillis();
      diffDays = Math.floor(
        (eventDayStart - referenceDayStart) / MILLISECONDS_IN_DAY
      );

      // Adjust for hidden days
      if (eventStartUnix < startUnix) {
        for (
          let dayUnix = eventStartUnix;
          dayUnix < startUnix;
          dayUnix = parseDateTime(dayUnix).plus({ days: 1 }).toMillis()
        ) {
          const dayStartUnix = parseDateTime(dayUnix).startOf('day').toMillis();
          if (!visibleDates[dayStartUnix]) {
            diffDays++;
          }
        }
      } else {
        for (
          let dayUnix = startUnix;
          dayUnix < eventStartUnix;
          dayUnix = parseDateTime(dayUnix).plus({ days: 1 }).toMillis()
        ) {
          const dayStartUnix = parseDateTime(dayUnix).startOf('day').toMillis();
          if (!visibleDates[dayStartUnix]) {
            diffDays--;
          }
        }
      }
    }

    return {
      totalDuration,
      startMinutes: newStart,
      diffDays,
    };
  }, [
    duration,
    end,
    eventStartUnix,
    start,
    startMinutes,
    startUnix,
    visibleDates,
  ]);

  // Calculate childColumns based on mode:
  // - Dual-axis resource mode: totalResources === 1, use resourcePerPage
  // - Grouped resource mode: totalResources > 1, use resourcePerPage
  // - Regular resource mode (no scroll): use totalResources
  // - Week view (no resources): use 1 (diffDays handles day positioning)
  const isDualAxisMode = enableResourceScroll && totalResources === 1;
  const childColumns = enableResourceScroll
    ? resourcePerPage
    : totalResources && totalResources > 0
      ? totalResources
      : 1;

  const eventHeight = useDerivedValue(
    () => data.totalDuration * minuteHeight.value - 1,
    [data.totalDuration]
  );

  const widthPercent = useMemo(() => {
    if (total && columnSpan) {
      const availableWidth = columnWidth / childColumns - rightEdgeSpacing;
      const totalColumns = total - columnSpan;
      const overlapSpacing = (totalColumns * overlapEventsSpacing) / total;
      const eventWidth = (availableWidth / total) * columnSpan - overlapSpacing;
      const percent = eventWidth / availableWidth;
      return percent;
    }

    const basePercent = widthPercentage ? widthPercentage / 100 : 1;
    return basePercent;
  }, [
    widthPercentage,
    columnSpan,
    rightEdgeSpacing,
    overlapEventsSpacing,
    total,
    columnWidth,
    childColumns,
  ]);

  const availableWidth = columnWidth / childColumns - rightEdgeSpacing;
  const eventWidth = widthPercent * availableWidth;
  const eventPosX = useMemo(() => {
    const colWidth = columnWidth / childColumns;

    // In dual-axis mode, each container has only 1 resource, so position is always 0
    // In grouped mode, calculate visual column position
    let startOffset = 0;
    if (!isDualAxisMode) {
      const visualColumn =
        resourceIndex !== undefined && enableResourceScroll
          ? resourceIndex % resourcePerPage
          : resourceIndex || 0;
      startOffset = visualColumn * colWidth;
    }

    let left = data.diffDays * colWidth + startOffset;

    if (xOffsetPercentage) {
      left += availableWidth * (xOffsetPercentage / 100);
    } else if (columnSpan && index) {
      left += (eventWidth + overlapEventsSpacing) * (index / columnSpan);
    }

    return left;
  }, [
    availableWidth,
    childColumns,
    columnSpan,
    columnWidth,
    data.diffDays,
    enableResourceScroll,
    eventWidth,
    index,
    isDualAxisMode,
    overlapEventsSpacing,
    resourceIndex,
    resourcePerPage,
    xOffsetPercentage,
  ]);

  const _onPressEvent = () => {
    if (onPressEvent) {
      onPressEvent(eventInput);
    }
  };

  const _onLongPressEvent = (resEvent: GestureResponderEvent) => {
    if (eventInput.draggable === false) {
      return;
    }
    onLongPressEvent!(eventInput, resEvent);
  };

  const opacity = isDragging ? 0.5 : 1;

  const eventWidthAnim = useDerivedValue(() => eventWidth, [eventWidth]);

  // Compute overlap border style
  const overlapBorderStyle = useMemo(() => {
    // Show border only for stacked events (stackLevel > 0)
    const isStacked = (stackLevel ?? 0) > 0;
    if (!isStacked) {
      return undefined;
    }

    const borderColor =
      theme.overlapEventBorderColor === null
        ? undefined
        : theme.overlapEventBorderColor ?? '#FFF';

    const borderWidth =
      theme.overlapEventBorderWidth !== undefined
        ? theme.overlapEventBorderWidth
        : 1;

    if (borderColor === undefined || borderWidth === 0) {
      return undefined;
    }

    return {
      borderWidth,
      borderColor,
    };
  }, [
    stackLevel,
    theme.overlapEventBorderColor,
    theme.overlapEventBorderWidth,
  ]);

  return (
    <View
      style={[
        styles.container,
        {
          width: eventWidth,
          left: eventPosX,
          height: `${((data.totalDuration - 1) / timeRange) * 100}%`,
          top: `${((data.startMinutes + 1) / timeRange) * 100}%`,
          zIndex,
        },
      ]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        disabled={!onPressEvent && !onLongPressEvent}
        onPress={onPressEvent ? _onPressEvent : undefined}
        onLongPress={onLongPressEvent ? _onLongPressEvent : undefined}>
        {({ pressed }) => (
          <View
            style={[
              styles.contentContainer,
              { backgroundColor: event.color },
              theme.eventContainerStyle,
              overlapBorderStyle,
              { opacity },
            ]}>
            {renderEvent ? (
              renderEvent(eventInput, {
                width: eventWidthAnim,
                height: eventHeight,
                zoomScale,
              })
            ) : (
              <Animated.View style={counterScaleStyle}>
                <Text
                  style={[
                    styles.title,
                    theme.eventTitleStyle,
                    { color: event.titleColor },
                  ]}>
                  {event.title}
                </Text>
              </Animated.View>
            )}
            {/* Dark overlay for pressed state - darkens card without transparency */}
            {pressed && <View style={styles.pressedOverlay} />}
          </View>
        )}
      </Pressable>
    </View>
  );
};

// Field-level comparison instead of lodash.isEqual deep comparison.
// For 100 events, this saves 100 deep object traversals per store update.
const areEventsEqual = (a: PackedEvent, b: PackedEvent) => {
  if (a === b) return true;
  const ai = a._internal;
  const bi = b._internal;
  return (
    a.localId === b.localId &&
    a.color === b.color &&
    a.titleColor === b.titleColor &&
    a.title === b.title &&
    a.draggable === b.draggable &&
    ai.startUnix === bi.startUnix &&
    ai.endUnix === bi.endUnix &&
    ai.duration === bi.duration &&
    ai.startMinutes === bi.startMinutes &&
    ai.widthPercentage === bi.widthPercentage &&
    ai.xOffsetPercentage === bi.xOffsetPercentage &&
    ai.index === bi.index &&
    ai.total === bi.total &&
    ai.columnSpan === bi.columnSpan &&
    ai.resourceIndex === bi.resourceIndex &&
    ai.zIndex === bi.zIndex &&
    ai.stackLevel === bi.stackLevel
  );
};

export default React.memo(EventItem, (prev, next) => {
  return (
    areEventsEqual(prev.event, next.event) &&
    prev.visibleDates === next.visibleDates &&
    prev.startUnix === next.startUnix &&
    prev.renderEvent === next.renderEvent &&
    prev.isDragging === next.isDragging &&
    prev.onPressEvent === next.onPressEvent &&
    prev.onLongPressEvent === next.onLongPressEvent
  );
});

const styles = StyleSheet.create({
  container: { position: 'absolute', overflow: 'hidden' },
  title: { fontSize: 12, paddingHorizontal: 2 },
  contentContainer: {
    borderRadius: 2,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  pressedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    borderRadius: 2,
  },
});
