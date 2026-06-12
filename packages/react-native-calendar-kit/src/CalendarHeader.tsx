import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import CalendarListView from './components/CalendarListView';
import ExpandButton from './components/ExpandButton';
import MultiDayBarItem from './components/MultiDayBarItem';
import ResourceListView from './components/Resource/ResourceListView';
import ResourceHeaderItem from './components/ResourceHeaderItem';
import SingleDayBarItem from './components/SingleDayBarItem';
import WeekNumber from './components/WeekNumber';
import {
  COLLAPSED_ITEMS,
  DAY_BAR_HEIGHT,
  DEFAULT_ALL_DAY_MINUTES,
  HEADER_BOTTOM_HEIGHT,
  MAX_ALL_DAY_MINUTES,
  MIN_ALL_DAY_MINUTES,
  ScrollType,
} from './constants';
import { useCalendar } from './context/CalendarProvider';
import type { HeaderContextProps } from './context/DayBarContext';
import { HeaderContext } from './context/DayBarContext';
import { useEventCountsByWeek } from './context/EventsProvider';
import { useTheme } from './context/ThemeProvider';
import useSyncedList from './hooks/useSyncedList';
import type { CalendarHeaderProps, ResourceItem } from './types';
import { clampValues } from './utils/utils';

const CalendarHeader: React.FC<CalendarHeaderProps> = ({
  dayBarHeight = DAY_BAR_HEIGHT,
  renderHeaderItem,
  renderExpandIcon,
  LeftAreaComponent,
  headerBottomHeight = HEADER_BOTTOM_HEIGHT,
  collapsedItems = COLLAPSED_ITEMS,
  renderEvent,
  eventMinMinutes = MIN_ALL_DAY_MINUTES,
  eventMaxMinutes = MAX_ALL_DAY_MINUTES,
  eventInitialMinutes = DEFAULT_ALL_DAY_MINUTES,
  renderDayItem,
  insetBottom = 100,
  dayBarScrollEnabled,
}) => {
  const {
    calendarLayout,
    numberOfDays,
    minuteHeight,
    hourWidth,
    dayBarListRef,
    calendarData,
    calendarGridWidth,
    isRTL,
    snapToInterval,
    scrollByDay,
    initialOffset,
    columns,
    showWeekNumber,
    visibleDateUnixAnim,
    visibleWeeks,
    columnWidth,
    useAllDayEvent,
    rightEdgeSpacing,
    overlapEventsSpacing,
    firstDay,
    allowHorizontalSwipe,
    enableResourceScroll,
    resourcePerPage,
    resourcePagingEnabled,
    linkedScrollGroup,
    dateResourceItems,
    // Prop-synced resources (from CalendarProvider), NOT the EventsProvider
    // store. The store's `resources` is written inside `notifyDataChanged` (an
    // effect), so `useResources()` lags the `resources` prop by a commit. On a
    // single -> multi transition that lag renders the resource header empty for
    // a frame; reading the prop-synced value here keeps the header content in
    // step with the layout that depends on it.
    resources,
  } = useCalendar();

  const effectiveDayBarScrollEnabled =
    dayBarScrollEnabled ?? allowHorizontalSwipe;
  const {
    onTouchStart,
    onWheel,
    onScrollBeginDrag: linkedOnScrollBeginDrag,
    onMomentumScrollBegin: linkedOnMomentumScrollBegin,
  } = linkedScrollGroup.addAndGet(ScrollType.dayBar, dayBarListRef);

  const headerStyles = useTheme(
    useCallback(
      (state) => ({
        headerBackgroundColor:
          state.headerBackgroundColor || state.colors.background,
        borderColor: state.headerBorderColor ?? state.colors.border,
        headerContainer: state.headerContainer,
      }),
      []
    )
  );

  const scrollProps = useSyncedList({
    id: ScrollType.dayBar,
  });
  const onScrollBeginDrag = useCallback(
    (event: any) => {
      linkedOnScrollBeginDrag?.(event);
      scrollProps.onScrollBeginDrag?.();
    },
    [linkedOnScrollBeginDrag, scrollProps]
  );

  const onMomentumScrollBegin = useCallback(
    (event: any) => {
      linkedOnMomentumScrollBegin?.(event);
      scrollProps.onMomentumScrollBegin?.();
    },
    [linkedOnMomentumScrollBegin, scrollProps]
  );

  const isExpanded = useSharedValue(false);
  const eventHeight = useDerivedValue(
    () =>
      clampValues(
        eventInitialMinutes * minuteHeight.value,
        eventMinMinutes * minuteHeight.value,
        eventMaxMinutes * minuteHeight.value
      ),
    [eventInitialMinutes, eventMinMinutes, eventMaxMinutes]
  );
  const eventCounts = useEventCountsByWeek(columns === 1 ? 'day' : 'week');
  const maxEventRows = useDerivedValue(() => {
    const currentStartWeek = visibleWeeks.value[0];
    const nextStartWeek = visibleWeeks.value[1];
    let count = currentStartWeek ? (eventCounts[currentStartWeek] ?? 0) : 0;
    if (nextStartWeek) {
      const countNextWeek = eventCounts[nextStartWeek] ?? 0;
      count = Math.max(count, countNextWeek);
    }
    return count;
  }, [eventCounts]);

  const isShowExpandButton = useDerivedValue(
    () => maxEventRows.value > collapsedItems,
    [maxEventRows, collapsedItems]
  );

  const visibleRows = useDerivedValue(() => {
    const minRows = Math.min(maxEventRows.value, collapsedItems);
    if (isExpanded.value) {
      return withTiming(maxEventRows.value, { duration: 250 });
    }
    return withTiming(minRows, { duration: 250 });
  }, [maxEventRows, collapsedItems]);

  const allDayEventsHeight = useDerivedValue(() => {
    const extraHeight = numberOfDays > 1 ? headerBottomHeight : 0;
    let nextHeight = 0;
    if (visibleRows.value) {
      nextHeight = visibleRows.value * eventHeight.value + extraHeight;
    }
    return nextHeight;
  }, [numberOfDays, headerBottomHeight]);

  const contentHeight = useDerivedValue(() => {
    if (!useAllDayEvent) {
      return dayBarHeight;
    }

    if (numberOfDays === 1) {
      const bottomHeight = isExpanded.value ? 10 : headerBottomHeight + 10;
      return clampValues(
        allDayEventsHeight.value + bottomHeight,
        dayBarHeight,
        calendarLayout.height - insetBottom
      );
    }

    return clampValues(
      dayBarHeight + allDayEventsHeight.value,
      0,
      calendarLayout.height - insetBottom
    );
  }, [numberOfDays, dayBarHeight, headerBottomHeight, insetBottom]);

  const headerContainerStyle = useAnimatedStyle(() => ({
    height: contentHeight.value,
  }));

  const value = useMemo<HeaderContextProps>(
    () => ({
      dayBarHeight,
      numberOfDays,
      calendarLayout,
      hourWidth,
      minuteHeight,
      isRTL,
      scrollByDay,
      columns,
      calendarData,
      eventHeight,
      isExpanded,
      allDayEventsHeight,
      columnWidth,
      useAllDayEvent,
      isShowExpandButton,
      collapsedItems,
      headerBottomHeight,
      rightEdgeSpacing,
      overlapEventsSpacing,
      firstDay,
      resourcePerPage,
      enableResourceScroll,
    }),
    [
      dayBarHeight,
      numberOfDays,
      calendarLayout,
      hourWidth,
      minuteHeight,
      isRTL,
      scrollByDay,
      columns,
      calendarData,
      eventHeight,
      isExpanded,
      allDayEventsHeight,
      columnWidth,
      useAllDayEvent,
      isShowExpandButton,
      headerBottomHeight,
      collapsedItems,
      rightEdgeSpacing,
      overlapEventsSpacing,
      firstDay,
      resourcePerPage,
      enableResourceScroll,
    ]
  );

  const extraData = useMemo(
    () => ({
      minDate: calendarData.minDateUnix,
      visibleDatesArray: calendarData.visibleDatesArray,
      columns,
      renderHeaderItem,
      renderEvent,
      renderExpandIcon,
      resources,
      renderDayItem,
    }),
    [
      calendarData.minDateUnix,
      calendarData.visibleDatesArray,
      columns,
      renderHeaderItem,
      renderEvent,
      renderExpandIcon,
      resources,
      renderDayItem,
    ]
  );

  const _renderHeaderItem = (index: number, extra: typeof extraData) => {
    const dateUnixByIndex = extra.visibleDatesArray[index * extra.columns];
    if (!dateUnixByIndex) {
      return null;
    }

    if (extra.renderHeaderItem) {
      return extra.renderHeaderItem({
        startUnix: dateUnixByIndex,
        index,
        extra,
      });
    }

    if (extra.resources) {
      return (
        <ResourceHeaderItem
          resources={extra.resources}
          startUnix={dateUnixByIndex}
        />
      );
    }

    if (extra.columns === 1) {
      return (
        <SingleDayBarItem
          startUnix={dateUnixByIndex}
          renderExpandIcon={extra.renderExpandIcon}
          renderEvent={extra.renderEvent}
          pageIndex={index}
          renderDayItem={extra.renderDayItem}
        />
      );
    }

    return (
      <MultiDayBarItem
        pageIndex={index * extra.columns}
        startUnix={dateUnixByIndex}
        renderEvent={extra.renderEvent}
        renderDayItem={extra.renderDayItem}
      />
    );
  };

  const extraScrollData = useMemo(() => {
    return {
      visibleDates: calendarData.visibleDatesArray,
      visibleColumns: numberOfDays,
    };
  }, [calendarData.visibleDatesArray, numberOfDays]);

  // Match CalendarBody — TimeColumn always renders at body level, so the
  // header's left area always reserves `hourWidth` and the day list to its
  // right is `calendarGridWidth` (= calendarLayout.width - hourWidth) wide
  // in every mode. Previously this was 0 in single-day mode, which made the
  // day-list viewport `calendarLayout.width` wide while each item was only
  // `calendarGridWidth` wide — two header days were visible at once.
  const leftSize = hourWidth;

  const _renderLeftArea = () => {
    if (LeftAreaComponent) {
      return (
        <View style={[styles.leftArea, { width: hourWidth }]}>
          {LeftAreaComponent}
        </View>
      );
    }

    return (
      <Pressable
        onPress={() => {
          if (isShowExpandButton.value) {
            isExpanded.value = !isExpanded.value;
          }
        }}
        style={[styles.leftArea, { width: hourWidth }]}>
        {showWeekNumber && <WeekNumber date={visibleDateUnixAnim} />}
        {useAllDayEvent && (
          <ExpandButton
            isExpanded={isExpanded}
            isShowExpandButton={isShowExpandButton}
            renderExpandIcon={renderExpandIcon}
          />
        )}
        <View
          style={[styles.border, { backgroundColor: headerStyles.borderColor }]}
        />
      </Pressable>
    );
  };

  const _renderResourceHeaderItem = useCallback(
    (item: { items: ResourceItem[]; index: number }) => {
      if (renderHeaderItem) {
        return renderHeaderItem({
          startUnix: visibleDateUnixAnim.value,
          index: 0,
          extra: { resources: item.items },
        });
      }

      return (
        <ResourceHeaderItem
          resources={item.items}
          startUnix={visibleDateUnixAnim.value}
        />
      );
    },
    [visibleDateUnixAnim, renderHeaderItem]
  );

  const height = useDerivedValue(() => {
    return numberOfDays === 1
      ? Math.max(
          dayBarHeight,
          allDayEventsHeight.value +
            (isExpanded.value ? 10 : headerBottomHeight + 10)
        )
      : dayBarHeight + allDayEventsHeight.value;
  }, [dayBarHeight, headerBottomHeight, calendarLayout.height, numberOfDays]);

  const headerContentStyle = useAnimatedStyle(() => ({
    height: height.value,
  }));

  // When `useAllDayEvent` is false (no expandable all-day row) the header
  // heights are constant per render, so drive them with PLAIN static values
  // instead of Reanimated animated heights.
  // `headerContainerStyle`/`headerContentStyle` are `useDerivedValue`s that read
  // the `dayBarHeight` prop; on Fabric, when `dayBarHeight` flips 0 -> N
  // (single -> multi provider) during the post-load re-render storm, the
  // animated height can fail to re-commit and the header ScrollView stays
  // clipped at the stale 0 — the avatar cells lay out (Yoga measures ~24px) but
  // are clipped to invisible: a blank white band. A static height updates
  // synchronously with the prop on the React commit, so nothing can strand. The
  // animated hooks stay (rules of hooks) and are still applied when
  // `useAllDayEvent` is true, where the expand/collapse animation needs them.
  const staticContainerHeight = dayBarHeight;
  const staticContentHeight =
    numberOfDays === 1
      ? Math.max(dayBarHeight, headerBottomHeight + 10)
      : dayBarHeight;

  return (
    <View
      style={[
        styles.headerContainer,
        {
          backgroundColor: headerStyles.headerBackgroundColor,
          borderBottomColor: headerStyles.borderColor,
        },
        headerStyles.headerContainer,
        { width: calendarLayout.width },
      ]}>
      <Animated.ScrollView
        style={useAllDayEvent ? headerContainerStyle : { height: staticContainerHeight }}
        alwaysBounceVertical={false}
        bounces={false}
        overScrollMode="never">
        <HeaderContext.Provider value={value}>
          <Animated.View
            style={[
              { width: calendarLayout.width },
              useAllDayEvent ? headerContentStyle : { height: staticContentHeight },
            ]}>
            {/* Left area (week-number / expand button placeholder) always
                renders so the header's day list starts at x=hourWidth in
                every mode — matches the body-level TimeColumn position. */}
            {_renderLeftArea()}
            <Animated.View
              style={[
                styles.absolute,
                {
                  left: Math.max(0, leftSize - 1),
                  width: calendarLayout.width - leftSize,
                  height: '100%',
                },
              ]}>
              {enableResourceScroll ? (
                <ResourceListView
                  ref={dayBarListRef}
                  resources={resources}
                  items={dateResourceItems}
                  width={calendarGridWidth}
                  height={dayBarHeight}
                  resourcePerPage={resourcePerPage}
                  renderItem={_renderResourceHeaderItem}
                  pagingEnabled={resourcePagingEnabled}
                  scrollEnabled={effectiveDayBarScrollEnabled}
                  onScrollBeginDrag={onScrollBeginDrag}
                  onMomentumScrollBegin={onMomentumScrollBegin}
                  onTouchStart={
                    effectiveDayBarScrollEnabled ? onTouchStart : undefined
                  }
                  onWheel={effectiveDayBarScrollEnabled ? onWheel : undefined}
                  initialOffset={initialOffset}
                />
              ) : (
                <CalendarListView
                  animatedRef={dayBarListRef}
                  // Match the ResourceListView branch: without an explicit
                  // height the inner ScrollView collapses to 0 and the header
                  // cells (height: '100%') resolve to 0px — rendered but
                  // invisible in byDay mode.
                  height={dayBarHeight}
                  count={calendarData.count}
                  width={calendarGridWidth}
                  renderItem={_renderHeaderItem}
                  extraData={extraData}
                  inverted={isRTL}
                  snapToInterval={snapToInterval}
                  initialOffset={initialOffset}
                  columnsPerPage={columns}
                  extraScrollData={extraScrollData}
                  scrollEnabled={effectiveDayBarScrollEnabled}
                  {...scrollProps}
                  onScrollBeginDrag={onScrollBeginDrag}
                  onMomentumScrollBegin={onMomentumScrollBegin}
                  onTouchStart={
                    effectiveDayBarScrollEnabled ? onTouchStart : undefined
                  }
                  onWheel={effectiveDayBarScrollEnabled ? onWheel : undefined}
                />
              )}
            </Animated.View>
          </Animated.View>
        </HeaderContext.Provider>
      </Animated.ScrollView>
    </View>
  );
};

export default React.memo(CalendarHeader);

const styles = StyleSheet.create({
  headerContainer: {
    zIndex: 999,
    borderBottomWidth: 0,
  },
  absolute: { position: 'absolute' },
  leftArea: { height: '100%' },
  border: { right: 0, height: '100%', position: 'absolute', width: 1 },
});
