import type { FC } from 'react';
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
} from 'react-native-reanimated';
import { useBody } from '../context/BodyContext';
import { useCalendar } from '../context/CalendarProvider';
import { useNowIndicator } from '../context/NowIndicatorProvider';
import { useTheme } from '../context/ThemeProvider';
import { useDateChangedListener } from '../context/VisibleDateProvider';

interface NowIndicatorProps {
  dayIndex: number;
  currentTime: SharedValue<number>;
  showDot?: boolean;
  width?: number;
  startLeft?: number;
  inRange?: SharedValue<boolean>;
}

const NowIndicatorInner = ({
  dayIndex,
  currentTime,
  showDot = true,
  width,
  startLeft = 0,
  inRange,
}: NowIndicatorProps) => {
  const {
    minuteHeight,
    start,
    end,
    startOffset,
    columnWidth,
    NowIndicatorComponent,
    counterScaleStyle,
  } = useBody();
  const nowIndicatorColor = useTheme(
    useCallback((state) => state.nowIndicatorColor || state.colors.primary, [])
  );

  const opacity = useDerivedValue(() => {
    const timeInRange = currentTime.value >= start && currentTime.value <= end;
    const dayVisible = inRange ? inRange.value : true;
    return timeInRange && dayVisible ? 1 : 0;
  }, [start, end, inRange]);

  const animView = useAnimatedStyle(() => {
    return {
      top: currentTime.value * minuteHeight.value - startOffset.value,
      opacity: opacity.value,
    };
  }, [width]);

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.container,
        {
          width: width ?? columnWidth,
          left: dayIndex * columnWidth + startLeft,
        },
        animView,
      ]}>
      {/*
        Counter-scale wrapper applies to BOTH the default line+dot AND any
        consumer-provided NowIndicatorComponent so it doesn't stretch
        vertically at non-1 zoom. transformOrigin: 'top' anchors the
        indicator at the current-time row; without it, default center-origin
        would pull the line off-row at zoom > 1.
      */}
      <Animated.View style={[{ transformOrigin: 'top' }, counterScaleStyle]}>
        {NowIndicatorComponent || (
          <View style={styles.lineContainer}>
            <View style={[styles.line, { backgroundColor: nowIndicatorColor }]} />
            {showDot && (
              <View
                style={[styles.dot, { backgroundColor: nowIndicatorColor }]}
              />
            )}
          </View>
        )}
      </Animated.View>
    </Animated.View>
  );
};

// Body-level indicator: renders as a sibling of the horizontal CalendarList
// but inside the vertical body scroll. It scrolls vertically with the
// timeline and stays static during horizontal page swipes (chip won't ride
// off across days). Hidden when the active page does not contain today.
const NowIndicator: FC<{ showDot?: boolean }> = ({ showDot = true }) => {
  const { showNowIndicator, hourWidth, columnWidth, columns } = useBody();
  const { currentDateUnix, currentTime } = useNowIndicator();
  // visibleDateUnixAnim is updated immediately on the UI thread when a column
  // boundary is crossed (no debounce). Using it here eliminates the ~200 ms
  // double-debounce (150 ms useSyncedList + 50 ms VisibleDateProvider) that
  // previously delayed show/hide when swiping between weeks.
  // This mirrors the approach used by useVisibleDayUnix for week-header chips.
  const { visibleDateUnixAnim } = useCalendar();

  // Today's column index derived on the UI thread — updates per scroll frame.
  // Negative or >= columns means today is outside the visible page.
  const dayIndexSV = useDerivedValue(() => {
    'worklet';
    const dayMs = 86400000;
    return Math.round((currentDateUnix - visibleDateUnixAnim.value) / dayMs);
  }, [currentDateUnix]);

  const inRangeSV = useDerivedValue(() => {
    'worklet';
    return dayIndexSV.value >= 0 && dayIndexSV.value < columns;
  }, [columns]);

  if (!showNowIndicator) {
    return null;
  }

  // Container spans the full body width: chip lands over the TimeColumn
  // area (x=0..hourWidth) and the consumer's flex:1 line extends across
  // the entire visible row. Splitting chip vs line into separate slots so
  // the line only covers today's column would require the consumer to
  // render them as two components — we keep the single-component contract.
  // inRangeSV drives opacity to 0 on the UI thread instantly when today
  // leaves the visible page — no React re-render needed for show/hide.
  return (
    <NowIndicatorInner
      currentTime={currentTime}
      dayIndex={0}
      startLeft={0}
      width={hourWidth + columns * columnWidth}
      showDot={showDot}
      inRange={inRangeSV}
    />
  );
};

export const NowIndicatorResource = () => {
  const { showNowIndicator, hourWidth, columnWidth, columns } = useBody();
  const { currentDateUnix, currentTime } = useNowIndicator();
  const startUnix = useDateChangedListener();

  const isShowNowIndicator = showNowIndicator && startUnix === currentDateUnix;

  if (!isShowNowIndicator) {
    return null;
  }
  // Match the body-level NowIndicator geometry: span the full row from x=0
  // so the consumer chip lands over the TimeColumn (x=0..hourWidth) and the
  // flex:1 line extends across the whole visible width. Previously this
  // started at startLeft=hourWidth with a single columnWidth, so the chip+line
  // only covered the body and never reached the time column.
  return (
    <NowIndicatorInner
      currentTime={currentTime}
      dayIndex={0}
      startLeft={0}
      width={hourWidth + columns * columnWidth}
    />
  );
};

export default React.memo(NowIndicator);

const styles = StyleSheet.create({
  // zIndex above TimeColumn (998) so the indicator paints over the hour
  // labels — consumers commonly want the line/dot to draw across the
  // time-label column rather than be obscured by it.
  container: { position: 'absolute', zIndex: 999 },
  line: {
    position: 'absolute',
    height: 2,
    backgroundColor: '#007aff',
    width: '100%',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#007aff',
    position: 'absolute',
    left: -4,
  },
  lineContainer: {
    justifyContent: 'center',
  },
});
