import React, { useCallback, useMemo } from 'react';
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import { Platform, RefreshControl, StyleSheet, View } from 'react-native';
import {
  Gesture,
  GestureDetector,
  ScrollView,
} from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
} from 'react-native-reanimated';
import BodyItem from './components/BodyItem';
import BodyResourceItem from './components/BodyResourceItem';
import CalendarListView from './components/CalendarListView';
import DragEventPlaceholder from './components/DraggingEvent';
import DraggingHour from './components/DraggingHour';
import TappedSlotIndicator from './components/TappedSlotIndicator';
import { NowIndicatorResource } from './components/NowIndicator';
import ResourceListView from './components/Resource/ResourceListView';
import ResourceOverlay from './components/Resource/ResourceOverlay';
import TimeColumn from './components/TimeColumn';
import HorizontalLine from './components/TimelineBoard/HorizontalLine';
import { EXTRA_HEIGHT, HOUR_SHORT_LINE_WIDTH, ScrollType } from './constants';
import { useTheme } from './context/ThemeProvider';
import { useActions } from './context/ActionsProvider';
import type { BodyContextProps } from './context/BodyContext';
import { BodyContext } from './context/BodyContext';
import { useCalendar } from './context/CalendarProvider';
import { useResources } from './context/EventsProvider';
import { useLocale } from './context/LocaleProvider';
import useDragEventGesture from './hooks/useDragEventGesture';
import useDragToCreateGesture from './hooks/useDragToCreateGesture';
import usePinchToZoom from './hooks/usePinchToZoom';
import useSyncedList from './hooks/useSyncedList';
import type { CalendarBodyProps, ResourceItem } from './types';
import {
  dateTimeToISOString,
  parseDateTime,
  toHourStr,
} from './utils/dateUtils';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);
const IS_ANDROID = Platform.OS === 'android';

const CalendarBody: React.FC<CalendarBodyProps> = ({
  hourFormat = 'HH:mm',
  renderHour,
  showNowIndicator = true,
  showTimeColumnRightLine = true,
  showQuarterHourLines = false,
  tapFeedbackBorderColor = 'rgba(0,0,0,0.3)',
  renderCustomOutOfRange,
  renderCustomUnavailableHour,
  renderEvent,
  renderDraggableEvent,
  renderDraggingEvent,
  renderDraggingHour,
  renderHalfHour,
  renderQuarterHour,
  NowIndicatorComponent,
  renderCustomHorizontalLine,
  dayEndLineStyle: dayEndLineStyleProp,
  showDraggingEndTime = true,
  children,
}) => {
  const {
    calendarLayout,
    hourWidth,
    numberOfDays,
    offsetY,
    minuteHeight,
    maxTimelineHeight,
    maxTimeIntervalHeight,
    minTimeIntervalHeight,
    timeIntervalHeight,
    allowPinchToZoom,
    spaceFromTop,
    spaceFromBottom,
    timelineHeight,
    slots,
    totalSlots,
    start,
    end,
    timeInterval,
    columnWidth,
    scrollVisibleHeight,
    verticalListRef,
    visibleDateUnix,
    gridListRef,
    calendarData,
    calendarGridWidth,
    initialOffset,
    isRTL,
    columns,
    snapToInterval,
    calendarListRef,
    startOffset,
    scrollVisibleHeightAnim,
    visibleDateUnixAnim,
    pagesPerSide,
    rightEdgeSpacing,
    overlapEventsSpacing,
    allowDragToCreate,
    allowDragToEdit,
    firstDay,
    dragToCreateMode,
    allowHorizontalSwipe,
    enableResourceScroll,
    resourcePerPage,
    resourcePagingEnabled,
    linkedScrollGroup,
    dateResourceItems,
    daySnapOffsets,
    handleResourceScrollOffsetChange,
    zoomScale,
  } = useCalendar();
  const {
    onTouchStart,
    onWheel,
    onScrollBeginDrag: linkedOnScrollBeginDrag,
    onMomentumScrollBegin: linkedOnMomentumScrollBegin,
  } = linkedScrollGroup.addAndGet(ScrollType.calendarGrid, gridListRef);

  const locale = useLocale();
  const { onRefresh, onLoad } = useActions();
  const resources = useResources();
  const scrollProps = useSyncedList({
    id: ScrollType.calendarGrid,
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

  // Outer spacer: scales scroll content size with zoomScale
  const outerSpacerStyle = useAnimatedStyle(() => ({
    height: timelineHeight.value * zoomScale.value,
  }));

  // Inner container: GPU-accelerated scaleY transform.
  // The translateY simulates transformOrigin: '0% 0%' (top-left) by
  // compensating for the default center-origin scaling. This is more
  // reliable than transformOrigin across platforms (Android may ignore
  // transformOrigin when it's in a separate style object from transform).
  const innerScaleStyle = useAnimatedStyle(() => ({
    height: timelineHeight.value,
    transform: [
      { translateY: (timelineHeight.value / 2) * (zoomScale.value - 1) },
      { scaleY: zoomScale.value },
    ],
  }));

  // Counter-scale style shared across all children via BodyContext
  const counterScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: 1 / zoomScale.value }],
  }));

  // Sibling-overlay wrapper for horizontal grid lines.
  //
  // Lines used to render inside the scaled inner container with a per-line
  // counter-scale to undo the parent's vertical stretch. That worked but
  // produced N nested-transform native commits per pinch frame, which is the
  // dominant cost of pinch on Fabric. Here, the lines wrapper sits OUTSIDE
  // the scaled inner — it gets no parent `scaleY`, so its child <View>s stay
  // 1px tall naturally. Its top/height come from zoomScale via a single
  // useAnimatedStyle, so all lines reposition together with one commit.
  const horizontalLinesWrapperStyle = useAnimatedStyle(() => ({
    top: spaceFromTop * zoomScale.value,
    height:
      (timelineHeight.value - spaceFromTop - spaceFromBottom) *
      zoomScale.value,
  }));

  const borderColor = useTheme((state) => state.colors.border);
  const cellBorderColor = useTheme(
    (state) => state.hourBorderColor ?? state.colors.border
  );

  const { pinchGesture, pinchGestureRef, isPinching } = usePinchToZoom();
  const dragEventGesture = useDragEventGesture();
  const dragToCreateGesture = useDragToCreateGesture({
    mode: dragToCreateMode,
  });

  const _onLayout = (event: LayoutChangeEvent) => {
    scrollVisibleHeight.current = event.nativeEvent.layout.height;
    scrollVisibleHeightAnim.value = event.nativeEvent.layout.height;
  };

  const _onRefresh = useCallback(() => {
    if (onRefresh) {
      const date = parseDateTime(visibleDateUnix.current);
      onRefresh(dateTimeToISOString(date));
    }
  }, [onRefresh, visibleDateUnix]);

  const extraData = useMemo(() => {
    return {
      firstDay,
      minDate: calendarData.minDateUnix,
      columns,
      visibleDatesArray: calendarData.visibleDatesArray,
      renderDraggableEvent,
      resources,
    };
  }, [
    calendarData.minDateUnix,
    calendarData.visibleDatesArray,
    columns,
    renderDraggableEvent,
    firstDay,
    resources,
  ]);

  const _renderTimeSlots = useCallback(
    (index: number, extra: typeof extraData) => {
      const pageIndex = index * extra.columns;
      const dateUnixByIndex = extra.visibleDatesArray[pageIndex];
      if (!dateUnixByIndex) {
        return null;
      }

      return (
        <BodyItem
          pageIndex={pageIndex}
          startUnix={dateUnixByIndex}
          renderDraggableEvent={extra.renderDraggableEvent}
          resources={extra.resources}
        />
      );
    },
    []
  );

  const _onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // On Android, skip offsetY updates while pinching. The ScrollView may
    // fire onScroll with auto-adjusted offsets (from content size changes or
    // the simultaneous pan gesture) that would overwrite our focal-point
    // computed offset. iOS doesn't have this issue.
    if (IS_ANDROID && isPinching.value) return;
    offsetY.value = e.nativeEvent.contentOffset.y;
  };

  const extraScrollData = useMemo(() => {
    return {
      visibleDates: calendarData.visibleDatesArray,
      visibleColumns: numberOfDays,
    };
  }, [calendarData.visibleDatesArray, numberOfDays]);

  const hours = useMemo(() => {
    return slots.map((slot) => {
      return {
        slot,
        time: toHourStr(slot, hourFormat, locale.meridiem),
      };
    });
  }, [hourFormat, locale.meridiem, slots]);

  const _renderResourceItem = useCallback(
    (item: { items: ResourceItem[]; index: number; isDayEnd?: boolean; isDayStart?: boolean }) => {
      // In dual-axis mode, get the date for this specific item
      const dateUnix = dateResourceItems?.[item.index]?.date;
      return <BodyResourceItem resources={item.items} dateUnix={dateUnix} isDayEnd={item.isDayEnd} isDayStart={item.isDayStart} />;
    },
    [dateResourceItems]
  );

  const value = useMemo<BodyContextProps>(
    () => ({
      renderHour,
      renderHalfHour,
      renderQuarterHour,
      offsetY,
      minuteHeight,
      maxTimelineHeight,
      maxTimeIntervalHeight,
      minTimeIntervalHeight,
      timeIntervalHeight,
      allowPinchToZoom,
      spaceFromTop,
      spaceFromBottom,
      timelineHeight,
      hours,
      hourFormat,
      totalSlots,
      numberOfDays,
      hourWidth,
      start,
      end,
      timeInterval,
      showNowIndicator,
      showTimeColumnRightLine,
      showQuarterHourLines,
      columnWidth,
      calendarLayout,
      isRTL,
      columns,
      calendarData,
      renderCustomOutOfRange,
      renderCustomUnavailableHour,
      renderEvent,
      startOffset,
      rightEdgeSpacing,
      overlapEventsSpacing,
      visibleDateUnixAnim,
      NowIndicatorComponent,
      allowDragToCreate,
      allowDragToEdit,
      renderCustomHorizontalLine,
      dragToCreateMode,
      verticalListRef,
      gridListRef,
      resourcePerPage,
      enableResourceScroll,
      dayEndLineStyle: dayEndLineStyleProp
        ? {
            borderWidth: dayEndLineStyleProp.borderWidth ?? 1,
            borderStyle: dayEndLineStyleProp.borderStyle ?? 'dashed',
            borderColor: dayEndLineStyleProp.borderColor ?? '',
          }
        : undefined,
      zoomScale,
      counterScaleStyle,
    }),
    [
      renderHour,
      renderHalfHour,
      renderQuarterHour,
      offsetY,
      minuteHeight,
      maxTimelineHeight,
      maxTimeIntervalHeight,
      minTimeIntervalHeight,
      timeIntervalHeight,
      allowPinchToZoom,
      spaceFromTop,
      spaceFromBottom,
      timelineHeight,
      hours,
      hourFormat,
      totalSlots,
      numberOfDays,
      hourWidth,
      start,
      end,
      timeInterval,
      showNowIndicator,
      showTimeColumnRightLine,
      showQuarterHourLines,
      columnWidth,
      calendarLayout,
      isRTL,
      columns,
      calendarData,
      renderCustomOutOfRange,
      renderCustomUnavailableHour,
      renderEvent,
      startOffset,
      rightEdgeSpacing,
      overlapEventsSpacing,
      visibleDateUnixAnim,
      NowIndicatorComponent,
      allowDragToCreate,
      allowDragToEdit,
      renderCustomHorizontalLine,
      dragToCreateMode,
      verticalListRef,
      gridListRef,
      resourcePerPage,
      enableResourceScroll,
      dayEndLineStyleProp,
      zoomScale,
      counterScaleStyle,
    ]
  );

  const composedGesture =
    Platform.OS === 'android'
      ? Gesture.Race(
          pinchGesture,
          dragEventGesture.activateAfterLongPress(200),
          dragToCreateGesture.activateAfterLongPress(200)
        )
      : Gesture.Race(pinchGesture, dragEventGesture, dragToCreateGesture);

  const leftSize = numberOfDays > 1 || !!resources ? hourWidth : 0;

  // Build the horizontal-line list once per slot/showQuarterHourLines change.
  // Lines render inside `horizontalLinesWrapperStyle` (sibling of inner scale
  // container) — see comment on the animated style above.
  //
  // Also includes the small hour-tick markers (formerly rendered inside
  // TimeColumn as `shortLine`). They sit at the right edge of the TimeColumn
  // — i.e. just to the left of the lines wrapper's left edge — so we
  // position them with a negative `left` to peek back into the TimeColumn area.
  const horizontalLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    const pushHourTick = (index: number, key: string) => {
      lines.push(
        <View
          key={`tick-${key}`}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: -HOUR_SHORT_LINE_WIDTH,
            width: HOUR_SHORT_LINE_WIDTH,
            height: 1,
            top: `${(index / totalSlots) * 100}%`,
            backgroundColor: cellBorderColor,
          }}
        />
      );
    };
    for (let i = 0; i < totalSlots; i++) {
      lines.push(
        <HorizontalLine
          key={i}
          borderColor={borderColor}
          index={i}
          totalSlots={totalSlots}
          renderCustomHorizontalLine={renderCustomHorizontalLine}
        />
      );
      pushHourTick(i, String(i));
      if (showQuarterHourLines) {
        lines.push(
          <HorizontalLine
            key={`${i}.25`}
            borderColor={borderColor}
            index={i + 0.25}
            totalSlots={totalSlots}
            renderCustomHorizontalLine={renderCustomHorizontalLine}
          />
        );
      }
      lines.push(
        <HorizontalLine
          key={`${i}.5`}
          borderColor={borderColor}
          index={i + 0.5}
          totalSlots={totalSlots}
          renderCustomHorizontalLine={renderCustomHorizontalLine}
        />
      );
      if (showQuarterHourLines) {
        lines.push(
          <HorizontalLine
            key={`${i}.75`}
            borderColor={borderColor}
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
        borderColor={borderColor}
        index={totalSlots}
        totalSlots={totalSlots}
        renderCustomHorizontalLine={renderCustomHorizontalLine}
      />
    );
    pushHourTick(totalSlots, String(totalSlots));
    return lines;
  }, [
    totalSlots,
    borderColor,
    cellBorderColor,
    renderCustomHorizontalLine,
    showQuarterHourLines,
  ]);

  const _renderResourceOverlay = useCallback(
    (props: { totalSize: number; resources: ResourceItem[] }) => {
      return (
        <ResourceOverlay
          {...props}
          renderDraggableEvent={renderDraggableEvent}
        />
      );
    },
    [renderDraggableEvent]
  );

  return (
    <View style={styles.container}>
      <GestureDetector gesture={composedGesture}>
        <AnimatedScrollView
          ref={verticalListRef}
          scrollEventThrottle={16}
          pinchGestureEnabled={false}
          showsVerticalScrollIndicator={false}
          onLayout={_onLayout}
          onScroll={_onScroll}
          refreshControl={
            onRefresh ? (
              <RefreshControl refreshing={false} onRefresh={_onRefresh} />
            ) : undefined
          }
          simultaneousHandlers={pinchGestureRef}>
          <BodyContext.Provider value={value}>
            {/* Outer spacer: height = timelineHeight * zoomScale (drives ScrollView content size) */}
            <Animated.View
              style={[
                {
                  width: calendarLayout.width,
                  overflow: Platform.select({
                    web: 'hidden',
                    default: 'visible',
                  }),
                },
                outerSpacerStyle,
              ]}>
              {/* Horizontal grid lines overlay — sibling of innerScaleStyle so
                  it receives NO parent scaleY. Lines stay 1px regardless of
                  zoom; their positions track zoom via the wrapper's animated
                  top/height. Rendered before the scaled container so events
                  paint on top. */}
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.absolute,
                  {
                    left: hourWidth,
                    width: calendarLayout.width - hourWidth,
                  },
                  horizontalLinesWrapperStyle,
                ]}>
                {horizontalLines}
              </Animated.View>
              {/* Inner scale container: GPU-accelerated scaleY transform */}
              <Animated.View
                style={[
                  { width: calendarLayout.width },
                  innerScaleStyle,
                ]}>
              <View
                style={[
                  styles.absolute,
                  { top: -EXTRA_HEIGHT, width: calendarLayout.width },
                ]}>
                {(numberOfDays > 1 || !!resources) && <TimeColumn />}
                <View
                  style={[
                    styles.absolute,
                    {
                      left: Math.max(0, leftSize - 1),
                      width: calendarLayout.width - leftSize,
                    },
                  ]}>
                  {enableResourceScroll ? (
                    <ResourceListView
                      ref={gridListRef}
                      resources={resources}
                      items={dateResourceItems}
                      width={calendarGridWidth}
                      height={maxTimelineHeight + EXTRA_HEIGHT * 2}
                      resourcePerPage={resourcePerPage}
                      renderItem={_renderResourceItem}
                      pagingEnabled={resourcePagingEnabled}
                      renderOverlay={_renderResourceOverlay}
                      scrollEnabled={allowHorizontalSwipe}
                      onScrollBeginDrag={onScrollBeginDrag}
                      onMomentumScrollBegin={onMomentumScrollBegin}
                      onTouchStart={onTouchStart}
                      onWheel={onWheel}
                      snapToOffsets={daySnapOffsets}
                      onScrollOffsetChange={handleResourceScrollOffsetChange}
                      initialOffset={initialOffset}
                    />
                  ) : (
                    <CalendarListView
                      ref={calendarListRef}
                      animatedRef={gridListRef}
                      count={calendarData.count}
                      scrollEnabled={allowHorizontalSwipe}
                      width={calendarGridWidth}
                      height={maxTimelineHeight + EXTRA_HEIGHT * 2}
                      renderItem={_renderTimeSlots}
                      extraData={extraData}
                      inverted={isRTL}
                      snapToInterval={snapToInterval}
                      initialOffset={initialOffset}
                      columnsPerPage={columns}
                      renderAheadItem={pagesPerSide}
                      extraScrollData={extraScrollData}
                      {...scrollProps}
                      onScrollBeginDrag={onScrollBeginDrag}
                      onMomentumScrollBegin={onMomentumScrollBegin}
                      onLoad={onLoad}
                      onTouchStart={onTouchStart}
                      onWheel={onWheel}
                    />
                  )}
                </View>
                <View
                  pointerEvents="box-none"
                  style={[
                    styles.absolute,
                    { top: EXTRA_HEIGHT + spaceFromTop },
                    styles.dragContainer,
                  ]}>
                  {enableResourceScroll && <NowIndicatorResource />}
                  <DragEventPlaceholder
                    renderDraggingEvent={renderDraggingEvent}
                    resources={resources}
                  />
                  <DraggingHour renderHour={renderDraggingHour} showEndTime={showDraggingEndTime} />
                  <TappedSlotIndicator
                    resources={resources}
                    borderColor={tapFeedbackBorderColor}
                  />
                </View>
              </View>
              </Animated.View>
            </Animated.View>

            {/* Headless children — side-effect components that need BodyContext
                (e.g. SharedValue capture, zoom persistence). Must return null. */}
            {children}
          </BodyContext.Provider>
        </AnimatedScrollView>
      </GestureDetector>
    </View>
  );
};

export default React.memo(CalendarBody);

const styles = StyleSheet.create({
  container: { flex: 1 },
  absolute: { position: 'absolute' },
  dragContainer: { zIndex: 99999 },
});
