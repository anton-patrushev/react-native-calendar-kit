import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
} from 'react-native-reanimated';
import BodyItem from './components/BodyItem';
import BodyResourceItem from './components/BodyResourceItem';
import CalendarListView from './components/CalendarListView';
import DragEventPlaceholder from './components/DraggingEvent';
import DraggingHour from './components/DraggingHour';
import TappedSlotIndicator from './components/TappedSlotIndicator';
import NowIndicator, { NowIndicatorResource } from './components/NowIndicator';
import ResourceListView from './components/Resource/ResourceListView';
import ResourceOverlay from './components/Resource/ResourceOverlay';
import TimeColumn from './components/TimeColumn';
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

  // usePinchToZoom owns the pinch SharedValues read by innerScaleStyle
  // below. It must be called BEFORE the animated styles that capture
  // them — closures resolve `undefined` and crash with "Cannot read
  // property 'value' of undefined" if the hook is below.
  const {
    pinchGesture,
    pinchGestureRef,
    isPinching,
    pinchScrollDelta,
    scrollOffsetLive,
    pinchStartOffsetY,
    pinchEndTarget,
  } = usePinchToZoom();

  // Lock vertical ScrollView during pinch so finger movement that the
  // OS routes to the underlying pan-gesture (alongside the pinch)
  // doesn't sneak in as native scroll. Without this, scrollOffsetLive
  // drifts mid-pinch — on Android especially, where
  // `simultaneousHandlers={pinchGestureRef}` lets the native scroll fire
  // concurrently with the pinch — which throws off the focal-anchor
  // math and leaves a residual offset at gesture end.
  //
  // An earlier version of this lock toggled `scrollEnabled` directly
  // off `isPinching` in a useAnimatedReaction, but flipping it from
  // false→true mid-touch on Android wedged the ScrollView's touch
  // dispatcher (vertical scroll dead until next fresh ACTION_DOWN). To
  // unwedge: re-enable on a `setTimeout(0)` post-pinch so the
  // re-enable lands AFTER the touch event lifecycle has completed on
  // Android, giving the native dispatcher a clean boundary.
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const scrollReEnableTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  useEffect(
    () => () => {
      if (scrollReEnableTimer.current !== null) {
        clearTimeout(scrollReEnableTimer.current);
      }
    },
    []
  );
  const enableScrollAfterPinch = useCallback(() => {
    if (scrollReEnableTimer.current !== null) {
      clearTimeout(scrollReEnableTimer.current);
    }
    // Defer past the touch event boundary so Android doesn't wedge.
    // On iOS the timeout is harmless and the lock works either way.
    scrollReEnableTimer.current = setTimeout(() => {
      scrollReEnableTimer.current = null;
      setScrollEnabled(true);
    }, 0);
  }, []);
  const disableScrollDuringPinch = useCallback(() => {
    if (scrollReEnableTimer.current !== null) {
      clearTimeout(scrollReEnableTimer.current);
      scrollReEnableTimer.current = null;
    }
    setScrollEnabled(false);
  }, []);
  useAnimatedReaction(
    () => isPinching.value,
    (current, previous) => {
      if (current === previous || previous === null) return;
      if (current) {
        runOnJS(disableScrollDuringPinch)();
      } else {
        runOnJS(enableScrollAfterPinch)();
      }
    }
  );

  // Outer spacer: scales scroll content size with zoomScale
  const outerSpacerStyle = useAnimatedStyle(() => ({
    height: timelineHeight.value * zoomScale.value,
  }));

  // Inner container's transform composes two pieces of vertical motion
  // into a single commit per pinch frame:
  //  1) `(timelineHeight/2)*(Z-1)` — simulates top-origin scaleY (so the
  //     content scales from the top instead of the default center).
  //     More reliable than transformOrigin across platforms (Android may
  //     ignore transformOrigin when it's in a separate style object).
  //  2) `pinchScrollDelta` plus a transition residual — the focal-anchor
  //     scroll movement applied as translateY instead of a per-frame
  //     scrollTo. During pinch, `scrollOffsetLive` equals
  //     `pinchStartOffsetY` (no scroll moved) so the residual is 0 and
  //     the translateY term is just `pinchScrollDelta`. At gesture end
  //     `pinchEndTarget` is armed and we call scrollTo — as the native
  //     scroll catches up to `startOffsetY - delta`, the residual
  //     `(scrollOffsetLive - pinchStartOffsetY)` auto-decreases the
  //     translateY contribution synchronously with the scroll commit,
  //     so visual position stays constant through the transition.
  //     The residual only applies while `pinchEndTarget` is armed
  //     (i.e., during the settle window); after the settle reaction in
  //     usePinchToZoom re-baselines pinchStartOffsetY + clears the
  //     delta + clears pinchEndTarget, the residual collapses to 0 so
  //     subsequent vertical scrolls don't keep auto-compensating.
  const innerScaleStyle = useAnimatedStyle(() => ({
    height: timelineHeight.value,
    transform: [
      {
        translateY:
          (timelineHeight.value / 2) * (zoomScale.value - 1) +
          pinchScrollDelta.value +
          (Number.isNaN(pinchEndTarget.value)
            ? 0
            : scrollOffsetLive.value - pinchStartOffsetY.value),
      },
      { scaleY: zoomScale.value },
    ],
  }));

  // Stepped counter-scale source. `counterScaleStyle` is consumed by 100+
  // nodes during a pinch — every hour/half/quarter label in TimeColumn,
  // every event title, NowIndicator, drag overlays. If the style reads
  // `zoomScale.value` directly, EVERY consumer's transform commits on
  // every pinch frame (~60 Hz × ~100 nodes = thousands of native
  // commits/sec on UI thread).
  //
  // Route through a stepped useDerivedValue so the value only changes at
  // ~0.1 zoom increments. Consumers' useAnimatedStyle worklets are
  // dep-tracked on this SV — they re-fire ONLY when the stepped value
  // changes, not every frame. Counter-scale "steps" through the zoom
  // range in 10% increments (visually imperceptible during pinch).
  const counterScaleSteppedSV = useDerivedValue(() => {
    return Math.round(zoomScale.value * 10) / 10;
  });
  const counterScaleStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: 1 / counterScaleSteppedSV.value }],
  }));

  // Hour-tick overlay positioning — outside scaled subtree so 1px ticks
  // stay 1px; one animated style drives all tick positions.
  //
  // Uses the stepped counter-scale SV (10% increments) instead of raw
  // zoomScale.value. On Fabric Android, layout-prop animated styles
  // (top/height) commit via Yoga, while the inner-scale's transform
  // commits via the render thread — two parallel commits per pinch
  // frame can land out of order, producing a one-frame visual mismatch.
  // Stepping cuts this commit ~10x and keeps it visually identical
  // (10% steps in tick position are invisible during smooth pinch).
  const horizontalLinesWrapperStyle = useAnimatedStyle(() => ({
    top: spaceFromTop * counterScaleSteppedSV.value,
    height:
      (timelineHeight.value - spaceFromTop - spaceFromBottom) *
      counterScaleSteppedSV.value,
  }));

  const cellBorderColor = useTheme(
    (state) => state.hourBorderColor ?? state.colors.border
  );
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
    (item: {
      items: ResourceItem[];
      index: number;
      isDayEnd?: boolean;
      isDayStart?: boolean;
    }) => {
      // In dual-axis mode, get the date for this specific item
      const dateUnix = dateResourceItems?.[item.index]?.date;
      return (
        <BodyResourceItem
          resources={item.items}
          dateUnix={dateUnix}
          isDayEnd={item.isDayEnd}
          isDayStart={item.isDayStart}
        />
      );
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

  // TimeColumn always renders at body level (was conditional on multi-day or
  // resources before — in single-day mode it lived inside each cell and slid
  // horizontally on day-swipe, desyncing visually from the body-level lines
  // overlay).
  const leftSize = hourWidth;

  // Hour-tick markers at the TimeColumn/grid boundary. Negative `left`
  // peeks back into the TimeColumn area. Gated on showTimeColumnRightLine.
  const hourTicks = useMemo(() => {
    if (!showTimeColumnRightLine) return null;
    const ticks: React.ReactNode[] = [];
    for (let i = 0; i <= totalSlots; i++) {
      ticks.push(
        <View
          key={`tick-${i}`}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: -HOUR_SHORT_LINE_WIDTH,
            width: HOUR_SHORT_LINE_WIDTH,
            height: 1,
            top: `${(i / totalSlots) * 100}%`,
            backgroundColor: cellBorderColor,
          }}
        />
      );
    }
    return ticks;
  }, [totalSlots, cellBorderColor, showTimeColumnRightLine]);

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
          scrollEnabled={scrollEnabled}
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
              {/* Hour-tick overlay (body-level, outside scaled subtree).
                  Grid lines themselves moved into TimelineBoard to paint
                  over UnavailableHours. */}
              {hourTicks && (
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
                  {hourTicks}
                </Animated.View>
              )}
              {/* Inner scale container: GPU-accelerated scaleY transform */}
              <Animated.View
                style={[{ width: calendarLayout.width }, innerScaleStyle]}>
                <View
                  style={[
                    styles.absolute,
                    { top: -EXTRA_HEIGHT, width: calendarLayout.width },
                  ]}>
                  <TimeColumn />
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
                    {enableResourceScroll ? (
                      <NowIndicatorResource />
                    ) : (
                      <NowIndicator />
                    )}
                    <DragEventPlaceholder
                      renderDraggingEvent={renderDraggingEvent}
                      resources={resources}
                    />
                    <DraggingHour
                      renderHour={renderDraggingHour}
                      showEndTime={showDraggingEndTime}
                    />
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
