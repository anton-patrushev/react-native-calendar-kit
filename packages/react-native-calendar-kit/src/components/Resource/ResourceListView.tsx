import React, { forwardRef, useCallback, useMemo, useRef } from 'react';
import {
  GestureResponderEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  View,
} from 'react-native';
import Animated, { AnimatedRef } from 'react-native-reanimated';
import { ResourceItem } from '../../types';
import { CalendarList, CalendarListRef } from '../../service/CalendarList';

export interface DateResourceItem {
  date: number;
  resource: ResourceItem;
}

export interface ResourceListViewProps {
  animatedRef?: AnimatedRef<Animated.ScrollView>;
  width: number;
  height: number;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollBeginDrag?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onScrollEndDrag?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onMomentumScrollBegin?: (
    event: NativeSyntheticEvent<NativeScrollEvent>
  ) => void;
  onMomentumScrollEnd?: (
    event: NativeSyntheticEvent<NativeScrollEvent>
  ) => void;
  resources?: ResourceItem[];
  items?: DateResourceItem[];
  resourcePerPage: number;
  drawDistance?: number;
  renderItem: (item: {
    items: ResourceItem[];
    index: number;
    isDayEnd?: boolean;
    isDayStart?: boolean;
  }) => React.ReactNode;
  pagingEnabled?: boolean;
  scrollEnabled?: boolean;
  renderOverlay?: (props: {
    totalSize: number;
    resources: ResourceItem[];
  }) => React.ReactNode;
  onTouchStart?: (event: GestureResponderEvent) => void;
  scrollEventThrottle?: number;
  onWheel?: (event: WheelEvent) => void;
  snapToOffsets?: number[];
  onScrollOffsetChange?: (offset: number) => void;
  initialOffset?: number;
}

export interface ResourceListViewRef {
  setVisibleDate: (date: number) => void;
}

const ResourceListView = forwardRef<Animated.ScrollView, ResourceListViewProps>(
  (
    {
      width,
      height,
      onScroll,
      onScrollBeginDrag,
      onScrollEndDrag,
      onMomentumScrollBegin,
      onMomentumScrollEnd,
      resources,
      items,
      resourcePerPage,
      drawDistance,
      renderItem,
      pagingEnabled = false,
      renderOverlay,
      scrollEnabled,
      onTouchStart,
      scrollEventThrottle = 16,
      onWheel,
      snapToOffsets,
      onScrollOffsetChange,
      initialOffset = 0,
    },
    ref
  ) => {
    const calendarListRef = useRef<CalendarListRef>(null);

    const isDualAxisMode = !!items;

    const itemsLength = items?.length ?? resources?.length ?? 0;
    const count = isDualAxisMode
      ? itemsLength
      : Math.ceil(itemsLength / resourcePerPage);

    const itemWidth = width / resourcePerPage;
    const itemSize = isDualAxisMode ? itemWidth : width;
    const totalSize = isDualAxisMode
      ? itemsLength * itemWidth
      : itemsLength * itemWidth;

    const _renderItem = useCallback(
      ({ item: index }: { item: number }) => {
        if (isDualAxisMode && items) {
          const dateResourceItem = items[index];
          if (!dateResourceItem) {
            return null;
          }
          const nextItem = items[index + 1];
          const prevItem = index > 0 ? items[index - 1] : undefined;
          const isDayEnd = !!nextItem && nextItem.date !== dateResourceItem.date;
          const isDayStart = !!prevItem && prevItem.date !== dateResourceItem.date;
          return renderItem({
            items: [dateResourceItem.resource],
            index,
            isDayEnd,
            isDayStart,
          });
        }

        if (!resources) {
          return null;
        }

        const startIndex = index * resourcePerPage;
        const endIndex = Math.min(
          startIndex + resourcePerPage,
          resources.length
        );
        const pageResources = resources.slice(startIndex, endIndex);

        if (pageResources.length === 0) {
          return null;
        }

        return renderItem({
          items: pageResources,
          index,
        });
      },
      [isDualAxisMode, items, resources, resourcePerPage, renderItem]
    );

    const keyExtractor = useCallback(
      (item: number) => {
        if (isDualAxisMode && items) {
          const dateResourceItem = items[item];
          if (!dateResourceItem) {
            return `item-${item}`;
          }
          return `${dateResourceItem.date}-${dateResourceItem.resource.id}`;
        }
        return `page-${item}`;
      },
      [isDualAxisMode, items]
    );

    const handleVisibleColumnChanged = useCallback(
      (props: { offset: number }) => {
        onScrollOffsetChange?.(props.offset);
      },
      [onScrollOffsetChange]
    );

    const snapToInterval = useMemo(() => {
      if (snapToOffsets) {
        return undefined;
      }
      if (isDualAxisMode) {
        return itemWidth;
      }
      if (pagingEnabled) {
        return undefined;
      }
      return itemWidth;
    }, [snapToOffsets, isDualAxisMode, itemWidth, pagingEnabled]);

    const effectiveDrawDistance = drawDistance ?? width * 3;

    // The overlay is routed through the engine's `children` slot so it
    // counter-translates with the horizontal scroll offset (the engine sizes
    // its inner container to `count * itemSize` and applies
    // `translateX(-scrollOffset)`). This keeps content-x → screen-x mapping
    // correct once the list is scrolled (previously the overlay was a static
    // sibling that did NOT track scroll, so absolutely-positioned content like
    // ResourceDraggableEvent rendered off by the scroll offset).
    //
    // Coordinate space: in dual-axis mode (the only mode that uses
    // `renderOverlay`), the engine's totalSize = count * itemSize =
    // itemsLength * itemWidth, which is identical to this component's
    // `totalSize`, so `renderOverlay`'s internal absolute positioning is
    // unchanged.
    //
    // z-order: the grid items live inside the engine's LegendList (rendered at
    // flex:1) and the engine overlay is an absolute-fill sibling painted after
    // it with zIndex:1 — already above the grid in paint order. We additionally
    // wrap the overlay content in a high-zIndex container so the resource
    // draggable event reliably floats above grid cells regardless of platform
    // paint order, matching the previous zIndex:999. This wrapper MUST carry
    // `pointerEvents="box-none"` itself: it stretches to the full content
    // size in front of the grid, and the engine's own `box-none` overlay
    // wrappers only exempt themselves, not this descendant. Without it this
    // `auto` view intercepts empty-slot taps (onPressBackground), event taps
    // (onPressEvent) and tap-feedback in resource mode. With `box-none`, drag
    // touches still reach ResourceDraggableEvent (a receptive child) while
    // taps on empty areas fall through to the grid.
    const overlayChildren = useMemo(() => {
      if (!renderOverlay) {
        return null;
      }
      return (
        <View
          id="overlay-view"
          style={styles.overlayContent}
          pointerEvents="box-none">
          {renderOverlay({ totalSize, resources: resources ?? [] })}
        </View>
      );
    }, [renderOverlay, totalSize, resources]);

    return (
      <CalendarList
        ref={calendarListRef}
        animatedRef={ref as AnimatedRef<Animated.ScrollView>}
        count={count}
        renderItem={_renderItem}
        keyExtractor={keyExtractor}
        itemSize={itemSize}
        drawDistance={effectiveDrawDistance}
        onScroll={onScroll}
        onScrollBeginDrag={onScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onMomentumScrollEnd={onMomentumScrollEnd}
        style={{ height }}
        initialOffset={initialOffset}
        pagingEnabled={isDualAxisMode ? false : pagingEnabled}
        snapToInterval={snapToInterval}
        snapToOffsets={snapToOffsets}
        columnsPerPage={isDualAxisMode ? 1 : resourcePerPage}
        onVisibleColumnChanged={handleVisibleColumnChanged}
        scrollEventThrottle={scrollEventThrottle}
        scrollEnabled={scrollEnabled}
        onTouchStart={onTouchStart}
        onWheel={onWheel}
        decelerationRate="fast">
        {overlayChildren}
      </CalendarList>
    );
  }
);

export default ResourceListView;

const styles = StyleSheet.create({
  // Fills the engine's counter-translating overlay container and stacks the
  // resource draggable event above the grid cells (parity with the previous
  // zIndex:999 static overlay).
  overlayContent: { height: '100%', zIndex: 999 },
});
