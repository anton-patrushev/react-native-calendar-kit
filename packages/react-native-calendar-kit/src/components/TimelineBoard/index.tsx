import React, { useMemo } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { EXTRA_HEIGHT, MILLISECONDS_IN_DAY } from '../../constants';
import { useActions } from '../../context/ActionsProvider';
import { useBody } from '../../context/BodyContext';
import { useDragEvent, useDragEventActions } from '../../context/DragEventProvider';
import { useTapFeedback } from '../../context/TapFeedbackContext';
import { useTheme } from '../../context/ThemeProvider';
import { useTimezone } from '../../context/TimeZoneProvider';
import {
  dateTimeToISOString,
  forceUpdateZone,
  parseDateTime,
} from '../../utils/dateUtils';
import Touchable from '../Touchable';
import HorizontalLine from './HorizontalLine';
import OutOfRangeView from './OutOfRangeView';
import UnavailableHours from './UnavailableHours';
import VerticalLine from './VerticalLine';
import { ResourceItem } from '../../types';

interface TimelineBoardProps {
  pageIndex: number;
  dateUnix: number;
  visibleDates: Record<number, { diffDays: number; unix: number }>;
  resources?: ResourceItem[];
}

const TimelineBoard = ({
  pageIndex,
  dateUnix,
  visibleDates,
  resources,
}: TimelineBoardProps) => {
  const {
    totalSlots,
    minuteHeight,
    spaceFromTop,
    start,
    columnWidth,
    numberOfDays,
    calendarData,
    columns,
    timelineHeight,
    spaceFromBottom,
    showQuarterHourLines,
    renderCustomHorizontalLine,
    zoomScale,
  } = useBody();
  const { timeZone } = useTimezone();
  const colors = useTheme((state) => state.colors);
  const { onPressBackground, onLongPressBackground } = useActions();
  const { triggerDragCreateEvent } = useDragEventActions();
  const { defaultDuration } = useDragEvent();
  const { showTapFeedback, snapInterval } = useTapFeedback();

  const _renderVerticalLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    const cols = resources?.length ? resources.length : columns;

    for (let i = 0; i < cols; i++) {
      lines.push(
        <VerticalLine
          key={i}
          borderColor={colors.border}
          index={i}
          columnWidth={columnWidth}
          childColumns={resources?.length ? resources.length : 1}
        />
      );
    }
    return lines;
  }, [resources, columns, colors.border, columnWidth]);

  const onPress = (event: GestureResponderEvent) => {
    const columnIndex = Math.floor(event.nativeEvent.locationX / columnWidth);
    const dayIndex = pageIndex + columnIndex;
    const dayUnix = calendarData.visibleDatesArray[dayIndex];
    const minutes = event.nativeEvent.locationY / minuteHeight.value + start;
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    if (dayUnix) {
      const baseDateTime = parseDateTime(dayUnix).set({ hour, minute });
      const dateObj = forceUpdateZone(baseDateTime, timeZone);
      const newProps: { dateTime: string; resourceId?: string } = {
        dateTime: dateTimeToISOString(dateObj),
      };
      if (resources) {
        const colWidth = columnWidth / resources.length;
        const resourceIdx = Math.floor(event.nativeEvent.locationX / colWidth);
        newProps.resourceId = resources[resourceIdx]?.id;
      }

      const roundedStartMinutes = Math.floor(minutes / snapInterval) * snapInterval;
      showTapFeedback({
        startMinutes: roundedStartMinutes,
        durationMinutes: defaultDuration,
        dateUnix: dayUnix,
        resourceId: newProps.resourceId,
      });

      onPressBackground?.(newProps, event);
    }
  };

  const onLongPress = (event: GestureResponderEvent) => {
    const columnIndex = Math.floor(event.nativeEvent.locationX / columnWidth);
    const dayIndex = pageIndex + columnIndex;
    const dayUnix = calendarData.visibleDatesArray[dayIndex];
    const minutes = event.nativeEvent.locationY / minuteHeight.value + start;
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;

    if (dayUnix) {
      const baseDateTime = parseDateTime(dayUnix).set({ hour, minute });
      const dateObj = forceUpdateZone(baseDateTime, timeZone);
      const dateString = dateTimeToISOString(dateObj);
      const newProps: { dateTime: string; resourceId?: string } = {
        dateTime: dateString,
      };
      if (resources) {
        const colWidth = columnWidth / resources.length;
        const resourceIdx = Math.floor(event.nativeEvent.locationX / colWidth);
        newProps.resourceId = resources[resourceIdx]?.id;
      }
      onLongPressBackground?.(newProps, event);
      if (triggerDragCreateEvent) {
        triggerDragCreateEvent?.(newProps, event);
      }
    }
  };

  const contentView = useAnimatedStyle(() => ({
    height: timelineHeight.value - spaceFromTop - spaceFromBottom,
  }));

  // Single counter-scale wrapper (vs per-line animated styles) — keeps
  // ~96 lines at 1px and zoom-positioned with one useAnimatedStyle per
  // BodyItem. translateY simulates scaleY top-origin.
  const horizontalLinesWrapperStyle = useAnimatedStyle(() => {
    const totalH = timelineHeight.value - spaceFromTop - spaceFromBottom;
    const z = zoomScale.value;
    return {
      height: totalH * z,
      transform: [
        { translateY: (totalH * (1 - z)) / 2 },
        { scaleY: 1 / z },
      ],
    };
  });

  const horizontalLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    for (let i = 0; i < totalSlots; i++) {
      lines.push(
        <HorizontalLine
          key={i}
          borderColor={colors.border}
          index={i}
          totalSlots={totalSlots}
          renderCustomHorizontalLine={renderCustomHorizontalLine}
        />
      );
      if (showQuarterHourLines) {
        lines.push(
          <HorizontalLine
            key={`${i}.25`}
            borderColor={colors.border}
            index={i + 0.25}
            totalSlots={totalSlots}
            renderCustomHorizontalLine={renderCustomHorizontalLine}
          />
        );
      }
      lines.push(
        <HorizontalLine
          key={`${i}.5`}
          borderColor={colors.border}
          index={i + 0.5}
          totalSlots={totalSlots}
          renderCustomHorizontalLine={renderCustomHorizontalLine}
        />
      );
      if (showQuarterHourLines) {
        lines.push(
          <HorizontalLine
            key={`${i}.75`}
            borderColor={colors.border}
            index={i + 0.75}
            totalSlots={totalSlots}
            renderCustomHorizontalLine={renderCustomHorizontalLine}
          />
        );
      }
    }
    lines.push(
      <HorizontalLine
        key={totalSlots}
        borderColor={colors.border}
        index={totalSlots}
        totalSlots={totalSlots}
        renderCustomHorizontalLine={renderCustomHorizontalLine}
      />
    );
    return lines;
  }, [totalSlots, colors.border, renderCustomHorizontalLine, showQuarterHourLines]);

  const _renderOutOfRangeView = () => {
    const diffMinDays = Math.floor(
      (calendarData.originalMinDateUnix - dateUnix) / MILLISECONDS_IN_DAY
    );
    if (diffMinDays > 0) {
      return (
        <OutOfRangeView position="left" diffDays={calendarData.diffMinDays} />
      );
    }

    const diffMaxDays = Math.floor(
      (calendarData.originalMaxDateUnix - dateUnix) / MILLISECONDS_IN_DAY
    );
    if (diffMaxDays < 7) {
      return (
        <OutOfRangeView position="right" diffDays={calendarData.diffMaxDays} />
      );
    }

    return null;
  };

  const _renderUnavailableHours = () => {
    return (
      <UnavailableHours visibleDates={visibleDates} resources={resources} />
    );
  };

  return (
    <View style={styles.container}>
      {/* TimeColumn moved to body level (CalendarBody) in every mode so it
          doesn't slide horizontally on day-swipe in single-day mode. */}
      <Animated.View
        style={[
          {
            marginTop: EXTRA_HEIGHT + spaceFromTop,
            width: '100%',
          },
          contentView,
        ]}>
        <Touchable
          style={styles.touchable}
          onPress={onPressBackground ? onPress : undefined}
          onLongPress={
            triggerDragCreateEvent || onLongPressBackground
              ? onLongPress
              : undefined
          }
          disabled={
            !onPressBackground &&
            !triggerDragCreateEvent &&
            !onLongPressBackground
          }
        />
        {_renderUnavailableHours()}
        {_renderOutOfRangeView()}
      </Animated.View>
      {/* Sibling of contentView (not child) — avoids layout clipping when
          scaled wrapper height exceeds totalH. Paint order at this depth:
          Unavailable (in contentView) → Lines → Events (in BodyItem). */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.horizontalLines,
          { top: EXTRA_HEIGHT + spaceFromTop },
          horizontalLinesWrapperStyle,
        ]}>
        {horizontalLines}
      </Animated.View>
      {(numberOfDays > 1 || !!resources?.length) && _renderVerticalLines}
    </View>
  );
};

export default React.memo(TimelineBoard);

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row' },
  horizontalLines: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  calendarGrid: { width: '100%' },
  separator: {
    backgroundColor: '#2D2D2D',
    borderRightWidth: 1,
    borderLeftWidth: 1,
    borderLeftColor: '#626266',
    borderRightColor: '#626266',
    position: 'absolute',
  },
  touchableContainer: { flex: 1, flexDirection: 'row' },
  touchable: { flex: 1 },
});
