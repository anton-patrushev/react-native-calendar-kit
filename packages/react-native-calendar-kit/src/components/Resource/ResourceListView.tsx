import React, { forwardRef, useCallback, useMemo, useRef } from 'react';
import {
  GestureResponderEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
  resources?: ResourceItem[];
  items?: DateResourceItem[];
  resourcePerPage: number;
  drawDistance?: number;
  renderItem: (item: {
    items: ResourceItem[];
    index: number;
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
          return renderItem({
            items: [dateResourceItem.resource],
            index,
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

    const effectiveDrawDistance = drawDistance ?? width * 2;

    const overlayElement = useMemo(() => {
      if (!renderOverlay) {
        return null;
      }
      return (
        <View
          id="overlay-view"
          style={{
            position: 'absolute',
            height,
            width: totalSize,
            zIndex: 999,
          }}
          pointerEvents="box-none">
          {renderOverlay({ totalSize, resources: resources ?? [] })}
        </View>
      );
    }, [renderOverlay, height, totalSize, resources]);

    return (
      <View style={{ height, position: 'relative' }}>
        <CalendarList
          ref={calendarListRef}
          animatedRef={ref as AnimatedRef<Animated.ScrollView>}
          count={count}
          renderItem={_renderItem}
          keyExtractor={keyExtractor}
          itemSize={itemSize}
          drawDistance={effectiveDrawDistance}
          onScroll={onScroll}
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
        />
        {overlayElement}
      </View>
    );
  }
);

export default ResourceListView;
