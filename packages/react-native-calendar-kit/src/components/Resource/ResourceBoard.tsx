import React, { memo, useMemo } from 'react';
import { GestureResponderEvent, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { EXTRA_HEIGHT } from '../../constants';
import { useActions } from '../../context/ActionsProvider';
import { useBody } from '../../context/BodyContext';
import { useDragEventActions } from '../../context/DragEventProvider';
import { useTheme } from '../../context/ThemeProvider';
import { useTimezone } from '../../context/TimeZoneProvider';
import { ResourceItem } from '../../types';
import {
  dateTimeToISOString,
  forceUpdateZone,
  parseDateTime,
} from '../../utils/dateUtils';
import HorizontalLine from '../TimelineBoard/HorizontalLine';
import VerticalLine from '../TimelineBoard/VerticalLine';
import Touchable from '../Touchable';
import UnavailableHoursByResource from './UnavailableHoursByResource';

interface ResourceBoardProps {
  resources: ResourceItem[];
  visibleDates: Record<string, { diffDays: number; unix: number }>;
  isDayEnd?: boolean;
  isDayStart?: boolean;
}

const ResourceBoard = ({ resources, visibleDates, isDayEnd, isDayStart }: ResourceBoardProps) => {
  const colors = useTheme((state) => state.colors);

  const {
    spaceFromTop,
    totalSlots,
    columnWidth,
    minuteHeight,
    visibleDateUnixAnim,
    start,
    resourcePerPage,
    spaceFromBottom,
    timelineHeight,
    dayEndLineStyle: dayEndLineStyleFromContext,
    zoomScale,
    showQuarterHourLines,
    renderCustomHorizontalLine,
  } = useBody();
  const { timeZone } = useTimezone();
  const { onPressBackground, onLongPressBackground } = useActions();
  const { triggerDragCreateEvent } = useDragEventActions();

  const contentView = useAnimatedStyle(() => ({
    height: timelineHeight.value - spaceFromTop - spaceFromBottom,
  }));

  // Mirror TimelineBoard's horizontal-line layer for resource mode. Lines
  // were relocated from a body-level overlay into TimelineBoard (to paint
  // over opaque UnavailableHours), but ResourceBoard never received them,
  // so multi-provider grids lost their hour rows. Single counter-scale
  // wrapper keeps each line at 1px and zoom-positioned with one
  // useAnimatedStyle per board (vs per-line).
  const horizontalLinesWrapperStyle = useAnimatedStyle(() => {
    const totalH = timelineHeight.value - spaceFromTop - spaceFromBottom;
    const z = zoomScale.value;
    return {
      height: totalH * z,
      transform: [{ translateY: (totalH * (1 - z)) / 2 }, { scaleY: 1 / z }],
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

  const onPress = (event: GestureResponderEvent) => {
    const dayUnix = visibleDateUnixAnim.value;
    const minutes = event.nativeEvent.locationY / minuteHeight.value + start;
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const baseDateTime = parseDateTime(dayUnix).set({ hour, minute });
    const dateObj = forceUpdateZone(baseDateTime, timeZone);
    const newProps: { dateTime: string; resourceId?: string } = {
      dateTime: dateTimeToISOString(dateObj),
    };
    if (resources) {
      if (resources.length === 1) {
        newProps.resourceId = resources[0]?.id;
      } else {
        const colWidth = columnWidth / resourcePerPage;
        const resourceIdx = Math.floor(event.nativeEvent.locationX / colWidth);
        newProps.resourceId = resources[resourceIdx]?.id;
      }
    }
    onPressBackground?.(newProps, event);
  };

  const onLongPress = (event: GestureResponderEvent) => {
    const dayUnix = visibleDateUnixAnim.value;
    const minutes = event.nativeEvent.locationY / minuteHeight.value + start;
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const baseDateTime = parseDateTime(dayUnix).set({ hour, minute });
    const dateObj = forceUpdateZone(baseDateTime, timeZone);
    const dateString = dateTimeToISOString(dateObj);
    const newProps: { dateTime: string; resourceId?: string } = {
      dateTime: dateString,
    };
    if (resources) {
      if (resources.length === 1) {
        newProps.resourceId = resources[0]?.id;
      } else {
        const colWidth = columnWidth / resourcePerPage;
        const resourceIdx = Math.floor(event.nativeEvent.locationX / colWidth);
        newProps.resourceId = resources[resourceIdx]?.id;
      }
    }
    onLongPressBackground?.(newProps, event);
    if (triggerDragCreateEvent) {
      triggerDragCreateEvent?.(newProps, event);
    }
  };

  // Resolve the day-end line style with theme border color as default
  const resolvedDayEndLineStyle = useMemo(() => {
    if (!dayEndLineStyleFromContext) return undefined;
    return {
      ...dayEndLineStyleFromContext,
      borderColor: dayEndLineStyleFromContext.borderColor || colors.border,
    };
  }, [dayEndLineStyleFromContext, colors.border]);

  const _renderVerticalLines = useMemo(() => {
    const lines: React.ReactNode[] = [];

    for (let i = 0; i <= resources.length; i++) {
      // Skip the left border on the first resource of a new day
      // to avoid overlapping the dashed day-end line from the previous item
      if (isDayStart && i === 0) {
        continue;
      }

      // When isDayEnd, render the rightmost line with the day-end style
      const isRightEdge = i === resources.length;
      const isDayBoundary = isRightEdge && isDayEnd && !!resolvedDayEndLineStyle;

      lines.push(
        <VerticalLine
          key={i}
          borderColor={colors.border}
          index={i}
          columnWidth={columnWidth}
          childColumns={resourcePerPage}
          dayEndLineStyle={isDayBoundary ? resolvedDayEndLineStyle : undefined}
        />
      );
    }
    return lines;
  }, [resources.length, colors.border, columnWidth, resourcePerPage, isDayEnd, isDayStart, resolvedDayEndLineStyle]);

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.calendarGrid,
          { marginTop: EXTRA_HEIGHT + spaceFromTop },
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
        <UnavailableHoursByResource
          resources={resources}
          visibleDates={visibleDates}
        />
      </Animated.View>
      {/* Sibling of the grid (not child) — paints over the opaque
          UnavailableHours bgs, below events (rendered later in BodyResourceItem). */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.horizontalLines,
          { top: EXTRA_HEIGHT + spaceFromTop },
          horizontalLinesWrapperStyle,
        ]}>
        {horizontalLines}
      </Animated.View>
      {!!resources?.length && _renderVerticalLines}
    </View>
  );
};

export default memo(ResourceBoard);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginLeft: -0.5,
  },
  calendarGrid: { width: '100%' },
  horizontalLines: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  touchable: { flex: 1 },
});
