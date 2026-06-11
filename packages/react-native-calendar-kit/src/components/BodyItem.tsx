import React, { useEffect, useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
} from 'react-native-reanimated';
import { EXTRA_HEIGHT } from '../constants';
import { useBody } from '../context/BodyContext';
import type { DraggableEventProps } from './DraggableEvent';
import DraggableEvent from './DraggableEvent';
import Events from './Events';
import LoadingOverlay from './Loading/Overlay';
import TimelineBoard from './TimelineBoard';
import { ResourceItem } from '../types';

interface MultipleBodyItemProps {
  pageIndex: number;
  startUnix: number;
  renderDraggableEvent?: (
    props: DraggableEventProps
  ) => React.ReactElement | null;
  resources?: ResourceItem[];
}

const BodyItem = ({
  pageIndex,
  startUnix,
  renderDraggableEvent,
  resources,
}: MultipleBodyItemProps) => {
  const {
    spaceFromTop,
    timelineHeight,
    spaceFromBottom,
    calendarData,
    columns,
    zoomScale,
    commitTick,
  } = useBody();

  // APP-5422: a page bound fresh while zoomed can be left un-composited by
  // Fabric (blank until a manual pinch). Bump commitTick to force the zoom
  // transform to re-commit. Gated on zoom≠1 (no transform to miss at identity).
  //
  // iOS-only (D1): this is the Fabric re-composite poke that only iOS needs.
  // On Android it is pure overhead and is the suspected zoomed-scroll
  // regression, so skip it entirely there.
  //
  // Recycle-aware (D1): under LegendList `recycleItems`, a single BodyItem
  // instance is rebound to different dates as you scroll — it is NOT
  // remounted. A mount-only effect would only fire for the date the instance
  // first rendered, leaving a recycled-while-zoomed page blank. Keying the
  // effect on `startUnix` re-runs the poke every time the instance is bound to
  // a new page. `zoomScale.value` is read at run time (not a dep) so the poke
  // reflects the live zoom when the rebind happens.
  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }
    if (Math.abs(zoomScale.value - 1) > 1e-3) {
      commitTick.value += 1;
    }
    // Re-run on rebind to a new page (recycle-aware); zoomScale/commitTick are
    // stable shared-value refs read imperatively.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startUnix]);

  const visibleDates = useMemo(() => {
    const data: Record<string, { diffDays: number; unix: number }> = {};
    for (let i = 0; i < columns; i++) {
      const currentUnix = calendarData.visibleDatesArray[pageIndex + i];
      if (currentUnix) {
        data[currentUnix] = {
          unix: currentUnix,
          diffDays: i,  // Use i directly: 0 for first column, 1 for second, etc.
        };
      }
    }

    return data;
  }, [calendarData.visibleDatesArray, columns, pageIndex]);

  // TimeColumn now lives at body level in every mode, so day cells no
  // longer carry it — events content starts at x=0 of the cell regardless
  // of single-day vs multi-day.
  const leftSpacing = 0;

  const height = useDerivedValue(() => {
    return timelineHeight.value - spaceFromTop - spaceFromBottom;
  }, [spaceFromTop, spaceFromBottom]);

  const animView = useAnimatedStyle(() => ({
    height: height.value,
  }));

  return (
    <View style={styles.container}>
      <TimelineBoard
        pageIndex={pageIndex}
        dateUnix={startUnix}
        visibleDates={visibleDates}
        resources={resources}
      />
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.content,
          {
            left: resources ? 0 : Math.max(0, leftSpacing - 1),
            top: EXTRA_HEIGHT + spaceFromTop,
          },
          animView,
        ]}>
        <Events
          startUnix={startUnix}
          visibleDates={visibleDates}
          resources={resources}
        />
        <DraggableEvent
          startUnix={startUnix}
          visibleDates={visibleDates}
          renderDraggableEvent={renderDraggableEvent}
          resources={resources}
        />
      </Animated.View>
      <LoadingOverlay />
    </View>
  );
};

// Memoized: under LegendList `recycleItems` a parent re-render (e.g. a drag
// frame or zoom tick) would otherwise re-render every resident page. The
// render is a pure function of these props — pageIndex/startUnix identify the
// page, renderDraggableEvent/resources arrive from the parent's stable
// `extraData`, so reference-equality is the correct (and cheapest) comparison.
// There is no captured non-prop state that would go stale across a rebind:
// `visibleDates` is recomputed from pageIndex, and the commitTick effect is
// keyed on startUnix.
export default React.memo(BodyItem);

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { position: 'absolute', width: '100%' },
});
