import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { ScrollView } from 'react-native-gesture-handler';
import Animated, {
  AnimatedRef,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useScrollViewOffset,
  useSharedValue,
} from 'react-native-reanimated';
import { HorizontalVirtualizedList } from './HorizontalVirtualizedList';
import useLatestCallback from '../../hooks/useLatestCallback';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

interface CalendarListProps {
  count: number;
  renderItem: (item: { item: number; index: number }) => React.ReactNode;
  keyExtractor?: (item: number, index: number) => string;
  itemSize: number;
  drawDistance?: number;
  /** Number of items to render around the current visible item for small counts
   *  (count <= 20). Default: 1 (renders prev + current + next = 3 items). */
  renderAhead?: number;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  style?: any;
  contentContainerStyle?: any;
  initialScrollIndex?: number;
  pagingEnabled?: boolean;
  snapToInterval?: number;
  initialOffset?: number;
  snapToOffsets?: number[];
  animatedRef?: AnimatedRef<Animated.ScrollView>;
  onVisibleColumnChanged?: (props: {
    index: number;
    column: number;
    columns: number;
    extraScrollData: Record<string, any>;
    offset: number;
  }) => void;
  columnsPerPage: number;
  extraScrollData?: any;
  scrollEventThrottle?: number;
  scrollEnabled?: boolean;
  onLoad?: () => void;
  onTouchStart?: (event: GestureResponderEvent) => void;
  decelerationRate?: 'fast' | 'normal' | number;

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

export interface CalendarListRef {
  scrollToIndex: (index: number, animated?: boolean) => void;
  scrollToOffset: (offset: number, animated?: boolean) => void;
  getMaxOffset: (visibleColumns?: number) => number;
  isScrollable: (offset: number, visibleColumns?: number) => boolean;
}

const DEFAULT_DRAW_DISTANCE = 600; // Larger buffer for horizontal scrolling

export const CalendarList = React.forwardRef<
  CalendarListRef,
  CalendarListProps
>(
  (
    {
      count,
      animatedRef,
      renderItem,
      keyExtractor = (item) => item.toString(),
      itemSize,
      drawDistance = DEFAULT_DRAW_DISTANCE,
      onScroll,
      onLayout,
      style,
      contentContainerStyle,
      initialScrollIndex,
      pagingEnabled = false,
      snapToInterval,
      initialOffset,
      snapToOffsets,
      onVisibleColumnChanged,
      columnsPerPage,
      extraScrollData,
      scrollEventThrottle = 16,
      scrollEnabled = true,
      onLoad,
      onTouchStart,
      onScrollBeginDrag,
      onMomentumScrollBegin,
      onMomentumScrollEnd,
      onScrollEndDrag,
      onWheel,
      decelerationRate,
      renderAhead = 1,
    },
    ref
  ) => {
    const scrollViewRef = useRef<ScrollView>(null);
    const scrollOffsetRef = useRef(initialOffset ?? 0);
    const [visibleRangeTick, setVisibleRangeTick] = React.useState(0);
    const throttleTimerRef = useRef<NodeJS.Timeout | null>(null);
    const isLoaded = useRef(false);

    const totalSize = count * itemSize;

    // With small page counts (e.g. 5-page windowed mode), only render
    // ±renderAhead items around the current page. The rest are empty
    // placeholders (no rendering cost). Re-render only on page change.
    const isSmallCountRef = useRef(count <= 20);
    isSmallCountRef.current = count <= 20;
    const lastPageRef = useRef(-1);
    const itemSizeRef = useRef(itemSize);
    itemSizeRef.current = itemSize;

    // Throttle virtualization updates to reduce JS-thread re-renders during scroll.
    // handleColumnChanged (visible date tracking) still fires every frame.
    const flushScrollOffset = useCallback(() => {
      if (throttleTimerRef.current) {
        clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = null;
      }
      // Sync page tracking so the next animated-reaction update doesn't
      // immediately trigger another visibleRange recalc.
      if (isSmallCountRef.current && itemSizeRef.current > 0) {
        lastPageRef.current = Math.round(
          scrollOffsetRef.current / itemSizeRef.current
        );
      }
      setVisibleRangeTick((n) => n + 1);
    }, []);

    const throttledUpdateVisibleRange = useCallback(() => {
      if (throttleTimerRef.current !== null) return;
      throttleTimerRef.current = setTimeout(() => {
        throttleTimerRef.current = null;
        setVisibleRangeTick((n) => n + 1);
      }, 150);
    }, []);

    const visibleRange = useMemo(() => {
      if (count === 0) {
        return { start: 0, end: 0 };
      }
      // For small page counts (windowed mode), only render ±renderAhead items
      // around the current page. Non-rendered pages are empty placeholders.
      if (count <= 20) {
        const currentPage = Math.round(scrollOffsetRef.current / itemSize);
        return {
          start: Math.max(0, currentPage - renderAhead),
          end: Math.min(count - 1, currentPage + renderAhead),
        };
      }

      const buffer = drawDistance;
      const currentOffset = scrollOffsetRef.current;
      const scrollStart = Math.max(0, currentOffset - buffer);
      const scrollEnd = currentOffset + itemSize + buffer;
      const startIndex = Math.max(0, Math.floor(scrollStart / itemSize));
      const endIndex = Math.min(count - 1, Math.floor(scrollEnd / itemSize));
      return { start: startIndex, end: endIndex };
      // visibleRangeTick forces recalculation on throttled updates
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [count, visibleRangeTick, drawDistance, itemSize, renderAhead]);

    const getItemPosition = useCallback(
      (index: number) => {
        return index * itemSize;
      },
      [itemSize]
    );

    const animScrollRef = useAnimatedRef<Animated.ScrollView>();
    const internalOffset = useSharedValue(initialOffset ?? 0);
    const scrollOffsetAnim = useScrollViewOffset(animScrollRef, internalOffset);

    const extraScrollDataRef = useRef(extraScrollData);
    extraScrollDataRef.current = extraScrollData;
    const onVisibleColumnChangedCb = useLatestCallback(onVisibleColumnChanged);

    const handleColumnChanged = useCallback(
      (offset: number) => {
        const columnWidth = itemSize / columnsPerPage;
        const startIndex = Math.floor(
          Math.round(offset / columnWidth) / columnsPerPage
        );
        const startOffset = startIndex * itemSize;
        const column = Math.round((offset - startOffset) / columnWidth);

        onVisibleColumnChangedCb?.({
          index: startIndex,
          column,
          columns: columnsPerPage,
          extraScrollData: extraScrollDataRef.current,
          offset,
        });
      },
      [itemSize, columnsPerPage, onVisibleColumnChangedCb]
    );

    const updateScrollOffset = useCallback(
      (offset: number) => {
        scrollOffsetRef.current = offset;
        if (isSmallCountRef.current) {
          // Only re-render when the current page changes (not every frame)
          const currentPage = Math.round(offset / itemSizeRef.current);
          if (currentPage !== lastPageRef.current) {
            lastPageRef.current = currentPage;
            setVisibleRangeTick((n) => n + 1);
          }
        } else {
          throttledUpdateVisibleRange();
        }
      },
      [throttledUpdateVisibleRange]
    );

    useAnimatedReaction(
      () => scrollOffsetAnim.value,
      (offset) => {
        runOnJS(handleColumnChanged)(offset);
        runOnJS(updateScrollOffset)(offset);
      }
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToIndex: (index: number, animated: boolean = true) => {
          if (index >= 0 && index < count) {
            const position = getItemPosition(index);
            scrollViewRef.current?.scrollTo({
              x: position,
              animated,
            });
          }
        },
        scrollToOffset: (offset: number, animated: boolean = true) => {
          scrollViewRef.current?.scrollTo({
            x: offset,
            animated,
          });
        },
        getMaxOffset: (visibleColumns?: number) => {
          if (!visibleColumns || !columnsPerPage) {
            return totalSize - itemSize;
          }

          const columnWidth = itemSize / columnsPerPage;
          return totalSize - columnWidth * visibleColumns;
        },
        isScrollable: (offset: number, visibleColumns?: number) => {
          let maxOffset: number;
          if (!visibleColumns || !columnsPerPage) {
            maxOffset = totalSize - itemSize;
          } else {
            const columnWidth = itemSize / columnsPerPage;
            maxOffset = totalSize - columnWidth * visibleColumns;
          }
          return offset >= 0 && offset <= maxOffset && offset !== scrollOffsetRef.current;
        },
      }),
      [
        columnsPerPage,
        count,
        getItemPosition,
        itemSize,
        totalSize,
      ]
    );

    // Flush virtualization range immediately when scroll settles
    const handleMomentumScrollEnd = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        flushScrollOffset();
        onMomentumScrollEnd?.(event);
      },
      [flushScrollOffset, onMomentumScrollEnd]
    );

    const handleScrollEndDrag = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        flushScrollOffset();
        onScrollEndDrag?.(event);
      },
      [flushScrollOffset, onScrollEndDrag]
    );

    useLayoutEffect(() => {
      if (count > 0) {
        let offset = initialOffset;
        if (typeof initialScrollIndex === 'number') {
          const targetIndex = Math.min(initialScrollIndex, count - 1);
          offset = getItemPosition(targetIndex);
        }
        if (offset !== undefined) {
          scrollOffsetRef.current = offset ?? 0;
          flushScrollOffset();
          setTimeout(() => {
            scrollViewRef.current?.scrollTo({
              x: offset,
              animated: false,
            });
          }, 0);
        }
      }
    }, [initialScrollIndex, count, getItemPosition, initialOffset, flushScrollOffset]);

    useEffect(() => {
      setTimeout(() => {
        if (!isLoaded.current) {
          isLoaded.current = true;
          onLoad?.();
        }
      }, 0);
    }, [onLoad]);

    return (
      <AnimatedScrollView
        ref={(node: any) => {
          scrollViewRef.current = node;
          animScrollRef?.(node);
          animatedRef?.(node);
        }}
        horizontal={true}
        style={style}
        contentContainerStyle={[contentContainerStyle, { width: totalSize }]}
        onScroll={onScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onLayout={onLayout}
        contentOffset={{ x: initialOffset ?? 0, y: 0 }}
        scrollEventThrottle={scrollEventThrottle}
        scrollEnabled={scrollEnabled}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        pagingEnabled={pagingEnabled}
        disableIntervalMomentum={!!snapToOffsets || !!snapToInterval}
        snapToInterval={snapToInterval}
        onTouchStart={onTouchStart}
        snapToOffsets={snapToOffsets}
        decelerationRate={decelerationRate}
        {...{ onWheel }}>
        <HorizontalVirtualizedList
          count={count}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          itemSize={itemSize}
          visibleRange={visibleRange}
          totalSize={totalSize}
          getItemPosition={getItemPosition}
        />
      </AnimatedScrollView>
    );
  }
);

CalendarList.displayName = 'CalendarList';
