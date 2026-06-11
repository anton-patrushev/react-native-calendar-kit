import {
  LegendList,
  type LegendListRef,
  type LegendListRenderItemProps,
} from '@legendapp/list/react-native';
import React, {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView as RNScrollView,
  type ScrollViewProps,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { ScrollView } from 'react-native-gesture-handler';
import Animated, {
  AnimatedRef,
  runOnJS,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollViewOffset,
  useSharedValue,
} from 'react-native-reanimated';
import useLatestCallback from '../../hooks/useLatestCallback';
import {
  computeColumnState,
  getMaxOffset as computeMaxOffset,
  isScrollableOffset,
} from './scrollMath';

const AnimatedScrollView = Animated.createAnimatedComponent(ScrollView);

/**
 * LegendList injects its internal/combined ref into the props it hands to
 * `renderScrollComponent` (`useStableRenderComponent` maps `(props, ref)` to
 * `{...props, ref}`), so spreading is enough to attach it. Keeping the
 * gesture-handler ScrollView wrapped in `createAnimatedComponent` preserves
 * gesture interop under GestureDetector and lets Reanimated register the
 * animated ref for `scrollTo` worklets and tag-based event listeners.
 */
const renderScrollComponent = (props: ScrollViewProps) => (
  <AnimatedScrollView {...props} />
);

interface CalendarListProps {
  count: number;
  renderItem: (item: { item: number; index: number }) => React.ReactNode;
  keyExtractor?: (item: number, index: number) => string;
  itemSize: number;
  drawDistance?: number;
  extraData?: unknown;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  initialScrollIndex?: number;
  pagingEnabled?: boolean;
  snapToInterval?: number;
  initialOffset?: number;
  snapToOffsets?: number[];
  snapToIndices?: number[];
  disableIntervalMomentum?: boolean;
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

  /**
   * Content-coordinate overlay rendered above the list. LegendList cannot
   * host extra children inside its scrolled content, so the overlay is a
   * sibling view pinned over the viewport whose inner container (sized to
   * the full content width) counter-translates with the scroll offset —
   * visually identical to rendering inside the scrolled content.
   */
  children?: React.ReactNode;
}

export interface CalendarListRef {
  scrollToIndex: (index: number, animated?: boolean) => void;
  scrollToOffset: (offset: number, animated?: boolean) => void;
  getMaxOffset: (visibleColumns?: number) => number;
  isScrollable: (offset: number, visibleColumns?: number) => boolean;
}

/** UI-thread sample used to detect page/column boundary crossings. */
interface ColumnSample {
  offset: number;
  pageIndex: number;
  column: number;
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
      extraData,
      onScroll,
      onLayout,
      style,
      contentContainerStyle,
      initialScrollIndex,
      pagingEnabled = false,
      snapToInterval,
      initialOffset,
      snapToOffsets,
      snapToIndices,
      disableIntervalMomentum,
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
      children,
    },
    ref
  ) => {
    const legendListRef = useRef<LegendListRef>(null);
    const isLoaded = useRef(false);

    const totalSize = count * itemSize;

    const internalAnimatedRef = useAnimatedRef<Animated.ScrollView>();
    const scrollAnimatedRef = animatedRef ?? internalAnimatedRef;
    const internalOffset = useSharedValue(initialOffset ?? 0);
    // Binds `internalOffset` to the ScrollView's UI-thread scroll events.
    useScrollViewOffset(scrollAnimatedRef, internalOffset);

    const extraScrollDataRef = useRef(extraScrollData);
    extraScrollDataRef.current = extraScrollData;
    const onVisibleColumnChangedCb = useLatestCallback(onVisibleColumnChanged);

    const data = useMemo(
      () => Array.from({ length: count }, (_, index) => index),
      [count]
    );

    const renderLegendItem = useCallback(
      ({ item, index }: LegendListRenderItemProps<number>) =>
        renderItem({ item, index }),
      [renderItem]
    );

    const getFixedItemSize = useCallback(() => itemSize, [itemSize]);

    const getItemPosition = useCallback(
      (index: number) => {
        return index * itemSize;
      },
      [itemSize]
    );

    const handleColumnChanged = useCallback(
      (offset: number) => {
        const { pageIndex, column } = computeColumnState(
          offset,
          itemSize,
          columnsPerPage
        );

        onVisibleColumnChangedCb?.({
          index: pageIndex,
          column,
          columns: columnsPerPage,
          extraScrollData: extraScrollDataRef.current,
          offset,
        });
      },
      [itemSize, columnsPerPage, onVisibleColumnChangedCb]
    );

    // Decodes the offset into page/column state per scroll frame on the UI
    // thread and only dispatches to JS when the page/column index changes
    // (handleColumnChanged → useSyncedList debounces). Visible-window math
    // lives inside LegendList now (`drawDistance`), so no range bookkeeping
    // happens here.
    const lastColumnSample = useSharedValue<ColumnSample | null>(null);
    useAnimatedReaction(
      () => {
        const offset = internalOffset.value;
        const prev = lastColumnSample.value;
        if (prev !== null && prev.offset === offset) {
          // Offset unchanged (repeated scroll events while settling) —
          // return the previous sample so the reaction sees no change.
          return prev;
        }
        const { columnPageIndex, column } = computeColumnState(
          offset,
          itemSize,
          columnsPerPage
        );
        const next: ColumnSample = {
          offset,
          pageIndex: columnPageIndex,
          column,
        };
        lastColumnSample.value = next;
        return next;
      },
      (curr, prev) => {
        const columnChanged =
          !prev ||
          prev.pageIndex !== curr.pageIndex ||
          prev.column !== curr.column;
        if (columnChanged) {
          runOnJS(handleColumnChanged)(curr.offset);
        }
      }
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToIndex: (index: number, animated: boolean = true) => {
          if (index >= 0 && index < count) {
            // Exact-offset parity with the previous engine — LegendList's
            // own scrollToIndex viewPosition semantics are not used.
            legendListRef.current?.scrollToOffset({
              offset: index * itemSize,
              animated,
            });
          }
        },
        scrollToOffset: (offset: number, animated: boolean = true) => {
          legendListRef.current?.scrollToOffset({ offset, animated });
        },
        getMaxOffset: (visibleColumns?: number) => {
          return computeMaxOffset({
            count,
            itemSize,
            columnsPerPage,
            visibleColumns: visibleColumns ?? 0,
          });
        },
        isScrollable: (offset: number, visibleColumns?: number) => {
          return isScrollableOffset({
            offset,
            currentOffset: internalOffset.value,
            count,
            itemSize,
            columnsPerPage,
            visibleColumns: visibleColumns ?? 0,
          });
        },
      }),
      [columnsPerPage, count, internalOffset, itemSize]
    );

    // Re-seeds the scroll position when count/itemSize/initialOffset change
    // (and applies `initialScrollIndex` on mount), mirroring the previous
    // engine's prop-driven re-application.
    useLayoutEffect(() => {
      if (count > 0) {
        let offset = initialOffset;
        if (typeof initialScrollIndex === 'number') {
          const targetIndex = Math.min(initialScrollIndex, count - 1);
          offset = getItemPosition(targetIndex);
        }
        if (offset !== undefined) {
          const target = offset;
          setTimeout(() => {
            legendListRef.current?.scrollToOffset({
              offset: target,
              animated: false,
            });
          }, 0);
        }
      }
    }, [initialScrollIndex, count, getItemPosition, initialOffset]);

    const handleLoad = useLatestCallback(() => {
      setTimeout(() => {
        if (isLoaded.current) {
          return;
        }
        isLoaded.current = true;
        onLoad?.();
        // Initial-offset hardening: horizontal lists can settle away from
        // `initialScrollOffset` on first render (LegendList issue #458).
        if (
          initialOffset !== undefined &&
          Math.abs(internalOffset.value - initialOffset) > 1
        ) {
          legendListRef.current?.scrollToOffset({
            offset: initialOffset,
            animated: false,
          });
        }
      }, 0);
    });

    const overlayTranslateStyle = useAnimatedStyle(() => ({
      transform: [{ translateX: -internalOffset.value }],
    }));

    const list = (
      <LegendList
        ref={legendListRef}
        data={data}
        renderItem={renderLegendItem}
        keyExtractor={keyExtractor}
        horizontal={true}
        getFixedItemSize={getFixedItemSize}
        estimatedItemSize={itemSize}
        initialScrollOffset={initialOffset}
        recycleItems={true}
        drawDistance={drawDistance}
        extraData={extraData}
        onLoad={handleLoad}
        refScrollView={scrollAnimatedRef as unknown as React.Ref<RNScrollView>}
        renderScrollComponent={renderScrollComponent}
        style={children != null ? styles.fill : style}
        contentContainerStyle={contentContainerStyle}
        onScroll={onScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onLayout={onLayout}
        scrollEventThrottle={scrollEventThrottle}
        scrollEnabled={scrollEnabled}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        pagingEnabled={pagingEnabled}
        disableIntervalMomentum={
          disableIntervalMomentum ?? (!!snapToOffsets || !!snapToInterval)
        }
        snapToInterval={snapToInterval}
        snapToOffsets={snapToOffsets}
        snapToIndices={snapToIndices}
        onTouchStart={onTouchStart}
        decelerationRate={decelerationRate}
        {...{ onWheel }}
      />
    );

    if (children == null) {
      return list;
    }

    return (
      <View style={style}>
        {list}
        <Animated.View pointerEvents="box-none" style={styles.overlay}>
          <Animated.View
            pointerEvents="box-none"
            style={[
              styles.overlayContent,
              { width: totalSize },
              overlayTranslateStyle,
            ]}>
            {children}
          </Animated.View>
        </Animated.View>
      </View>
    );
  }
);

CalendarList.displayName = 'CalendarList';

const styles = StyleSheet.create({
  fill: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  overlayContent: { height: '100%' },
});
