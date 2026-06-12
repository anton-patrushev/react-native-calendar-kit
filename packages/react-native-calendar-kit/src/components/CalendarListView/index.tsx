import React, { forwardRef, useCallback, useMemo } from 'react';
import type Animated from 'react-native-reanimated';
import type { AnimatedRef } from 'react-native-reanimated';
import { CalendarList, CalendarListRef } from '../../service/CalendarList';
import {
  DimensionValue,
  GestureResponderEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
} from 'react-native';

const MAX_OFFSETS = 180537;

interface CalendarListViewProps {
  count: number;
  width: number;
  height?: DimensionValue;
  extraData?: any;
  renderItem: (
    index: number,
    extraData?: any
  ) => JSX.Element | JSX.Element[] | null;
  initialOffset?: number;
  renderAheadItem?: number;
  animatedRef?: AnimatedRef<Animated.ScrollView>;
  scrollEventThrottle?: number;
  scrollEnabled?: boolean;
  onScroll?: any;
  snapToInterval?: number;
  inverted?: boolean;
  onVisibleColumnChanged?: (props: {
    index: number;
    column: number;
    columns: number;
    extraScrollData: Record<string, any>;
    offset: number;
  }) => void;
  extraScrollData?: any;
  columnsPerPage: number;
  onLoad?: () => void;
  onTouchStart?: (event: GestureResponderEvent) => void;

  /**
   * Fires if a user initiates a scroll gesture.
   */
  onScrollBeginDrag?:
    | ((event: NativeSyntheticEvent<NativeScrollEvent>) => void)
    | undefined;

  /**
   * Fires when a user has finished scrolling.
   */
  onScrollEndDrag?:
    | ((event: NativeSyntheticEvent<NativeScrollEvent>) => void)
    | undefined;

  /**
   * Fires when scroll view has finished moving
   */
  onMomentumScrollEnd?:
    | ((event: NativeSyntheticEvent<NativeScrollEvent>) => void)
    | undefined;

  /**
   * Fires when scroll view has begun moving
   */
  onMomentumScrollBegin?:
    | ((event: NativeSyntheticEvent<NativeScrollEvent>) => void)
    | undefined;

  onWheel?: (event: WheelEvent) => void;
}

export type CalendarListViewHandle = {
  scrollToIndex: (index: number, animated?: boolean) => void;
  scrollToOffset: (offset: number, animated?: boolean) => void;
  getMaxOffset: (visibleColumns?: number) => number;
  isScrollable: (offset: number, visibleColumns?: number) => boolean;
};

const CalendarListView = forwardRef<CalendarListRef, CalendarListViewProps>(
  (props, ref) => {
    const {
      count,
      width,
      height,
      extraData,
      renderItem,
      initialOffset = 0,
      renderAheadItem = 2,
      scrollEventThrottle = 16,
      scrollEnabled,
      animatedRef,
      onScroll,
      snapToInterval,
      // inverted,
      columnsPerPage,
      ...rest
    } = props;

    const _renderItem = useCallback(
      ({ item }: { item: number }) => renderItem(item, extraData),
      [renderItem, extraData]
    );

    const baseOffsets = useMemo(() => {
      if (!snapToInterval || !width) {
        return undefined;
      }

      return Array.from(
        { length: columnsPerPage },
        (_, col) => col * snapToInterval
      );
    }, [columnsPerPage, snapToInterval, width]);

    const _snapToOffsets = useMemo(() => {
      if (baseOffsets) {
        // Per-column snapping (scrollByDay / resource day-scroll): one snap
        // point per visible column.
        const offsets = [];
        for (let page = 0; page < count; page++) {
          offsets.push(...baseOffsets.map((offset) => offset + page * width));
        }
        if (offsets.length > MAX_OFFSETS) {
          console.warn('The number of days to display is too large');
        }
        return offsets;
      }

      // Plain day/week paging (no per-column snapToInterval): snap to one page
      // (itemSize === one day in day view, one week in week view) per swipe.
      // Without explicit snap offsets the grid relies solely on `pagingEnabled`,
      // which does NOT constrain momentum on the New-Architecture ScrollView
      // wrapping the virtualized list — a fast flick free-flings across the
      // entire date range and lands on an arbitrary far date (observed jumps to
      // 2031 / 2022). Enumerating page offsets makes `disableIntervalMomentum`
      // engage downstream, capping a flick at exactly one page.
      //
      // iOS ONLY. On Android the multi-thousand-entry offsets array froze the
      // grid and bled the now-line onto non-current pages, and Android did not
      // show the far-jump anyway. Returning undefined here keeps Android on its
      // original behavior: native `pagingEnabled` (the pre-fix `!snapToInterval`),
      // no offsets array, default deceleration.
      if (Platform.OS !== 'ios') {
        return undefined;
      }
      if (!width || count <= 0) {
        return undefined;
      }
      const pageOffsets = [];
      for (let page = 0; page < count; page++) {
        pageOffsets.push(page * width);
      }
      if (pageOffsets.length > MAX_OFFSETS) {
        // Range too large to enumerate; fall back to pagingEnabled.
        return undefined;
      }
      return pageOffsets;
    }, [baseOffsets, count, width]);

    const keyExtractor = useCallback((item: number) => item.toString(), []);

    return (
      <CalendarList
        ref={ref}
        animatedRef={animatedRef}
        count={count}
        renderItem={_renderItem}
        itemSize={width}
        style={{ height }}
        pagingEnabled={!snapToInterval && !_snapToOffsets}
        decelerationRate={_snapToOffsets ? 'fast' : undefined}
        initialOffset={initialOffset}
        snapToOffsets={_snapToOffsets}
        drawDistance={width * renderAheadItem}
        columnsPerPage={columnsPerPage}
        keyExtractor={keyExtractor}
        onScroll={onScroll}
        scrollEventThrottle={scrollEventThrottle}
        scrollEnabled={scrollEnabled}
        {...rest}
      />
    );
  }
);

export default React.memo(CalendarListView);
