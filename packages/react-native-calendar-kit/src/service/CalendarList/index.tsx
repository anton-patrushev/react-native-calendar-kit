import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
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
    },
    ref
  ) => {
    const scrollViewRef = useRef<ScrollView>(null);
    const isLoaded = useRef(false);

    const totalSize = count * itemSize;

    const animScrollRef = useAnimatedRef<Animated.ScrollView>();
    const internalOffset = useSharedValue(initialOffset ?? 0);
    const scrollOffsetAnim = useScrollViewOffset(animScrollRef, internalOffset);

    const extraScrollDataRef = useRef(extraScrollData);
    extraScrollDataRef.current = extraScrollData;
    const onVisibleColumnChangedCb = useLatestCallback(onVisibleColumnChanged);

    // Visible range lives in state directly (not derived from a per-frame
    // scrollOffset state). The animated reaction below computes it on the
    // UI thread and only commits to JS when start/end actually change —
    // intra-range scroll movements no longer re-render this list.
    const computeRange = useCallback(
      (offset: number) => {
        if (count === 0) {
          return { start: 0, end: 0 };
        }
        const buffer = drawDistance;
        const scrollStart = Math.max(0, offset - buffer);
        const scrollEnd = offset + itemSize + buffer;
        const startIndex = Math.max(0, Math.floor(scrollStart / itemSize));
        const endIndex = Math.min(
          count - 1,
          Math.floor(scrollEnd / itemSize)
        );
        return { start: startIndex, end: endIndex };
      },
      [count, drawDistance, itemSize]
    );

    const [visibleRange, setVisibleRange] = useState(() =>
      computeRange(initialOffset ?? 0)
    );

    // Recompute when count/itemSize/drawDistance change (props-driven).
    useEffect(() => {
      setVisibleRange((prev) => {
        const next = computeRange(internalOffset.value);
        return prev.start === next.start && prev.end === next.end
          ? prev
          : next;
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [computeRange]);

    const updateVisibleRange = useCallback(
      (start: number, end: number) => {
        setVisibleRange((prev) =>
          prev.start === start && prev.end === end ? prev : { start, end }
        );
      },
      []
    );

    const getItemPosition = useCallback(
      (index: number) => {
        return index * itemSize;
      },
      [itemSize]
    );

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

    // Computes column+range on the UI thread per scroll frame and only
    // dispatches to JS when (a) page/column index changes (for
    // handleColumnChanged → useSyncedList debounces) or (b) visible
    // window start/end changes (for virtualization). Prior implementation
    // fired runOnJS(setScrollOffset) every frame which made the list
    // re-render at ~60 Hz — expensive when the body subtree is scaled
    // post-pinch on Fabric.
    useAnimatedReaction(
      () => {
        const offset = scrollOffsetAnim.value;
        const colWidth = columnsPerPage > 0 ? itemSize / columnsPerPage : itemSize;
        const colPageIdx = Math.floor(
          Math.round(offset / colWidth) / columnsPerPage
        );
        const colOff = colPageIdx * itemSize;
        const col = Math.round((offset - colOff) / colWidth);
        const buffer = drawDistance;
        const scrollStart = Math.max(0, offset - buffer);
        const scrollEnd = offset + itemSize + buffer;
        const startIndex = Math.max(0, Math.floor(scrollStart / itemSize));
        const endIndex = Math.min(
          count - 1,
          Math.floor(scrollEnd / itemSize)
        );
        return { offset, colPageIdx, col, startIndex, endIndex };
      },
      (curr, prev) => {
        if (!curr) return;
        const columnChanged =
          !prev || prev.colPageIdx !== curr.colPageIdx || prev.col !== curr.col;
        const rangeChanged =
          !prev ||
          prev.startIndex !== curr.startIndex ||
          prev.endIndex !== curr.endIndex;
        if (columnChanged) {
          runOnJS(handleColumnChanged)(curr.offset);
        }
        if (rangeChanged) {
          runOnJS(updateVisibleRange)(curr.startIndex, curr.endIndex);
        }
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
          return (
            offset >= 0 && offset <= maxOffset && offset !== internalOffset.value
          );
        },
      }),
      [
        columnsPerPage,
        count,
        getItemPosition,
        internalOffset,
        itemSize,
        totalSize,
      ]
    );

    useLayoutEffect(() => {
      if (count > 0) {
        let offset = initialOffset;
        if (typeof initialScrollIndex === 'number') {
          const targetIndex = Math.min(initialScrollIndex, count - 1);
          offset = getItemPosition(targetIndex);
        }
        if (offset !== undefined) {
          setTimeout(() => {
            scrollViewRef.current?.scrollTo({
              x: offset,
              animated: false,
            });
          }, 0);
        }
      }
    }, [initialScrollIndex, count, getItemPosition, initialOffset]);

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
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onMomentumScrollEnd={onMomentumScrollEnd}
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
