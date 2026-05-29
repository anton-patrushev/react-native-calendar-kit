import type { FC } from 'react';
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
} from 'react-native-reanimated';
import { useBody } from '../context/BodyContext';
import { useNowIndicator } from '../context/NowIndicatorProvider';
import { useTheme } from '../context/ThemeProvider';
import { useDateChangedListener } from '../context/VisibleDateProvider';

interface NowIndicatorProps {
  dayIndex: number;
  currentTime: SharedValue<number>;
  showDot?: boolean;
  width?: number;
  startLeft?: number;
}

const NowIndicatorInner = ({
  dayIndex,
  currentTime,
  showDot = true,
  width,
  startLeft = 0,
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
    return currentTime.value >= start && currentTime.value <= end ? 1 : 0;
  }, [start, end]);

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

const NowIndicator: FC<{
  visibleDates: Record<string, { diffDays: number; unix: number }>;
  showDot?: boolean;
}> = ({ visibleDates, showDot = true }) => {
  const { showNowIndicator } = useBody();
  const { currentDateUnix, currentTime } = useNowIndicator();
  // Track the currently-visible day so the indicator hides on BodyItems
  // that virtualization keeps mounted in the drawDistance buffer. Without
  // this, scrolling to a previous day in single-day mode left today's
  // (off-active-page) BodyItem rendering the indicator, which leaked
  // into view during/after the horizontal swipe.
  const activeDayUnix = useDateChangedListener();

  const visibleDate = visibleDates[currentDateUnix];
  // Show only when this BodyItem's visibleDates contains BOTH today AND
  // the active day. For single-day mode this collapses to "activeDay ===
  // today". For multi-day mode it means "today is in the active week".
  const isShowNowIndicator =
    showNowIndicator && !!visibleDate && !!visibleDates[activeDayUnix];

  if (!isShowNowIndicator) {
    return null;
  }

  return (
    <NowIndicatorInner
      currentTime={currentTime}
      dayIndex={visibleDate.diffDays}
      showDot={showDot}
    />
  );
};

export const NowIndicatorResource = () => {
  const { showNowIndicator, hourWidth } = useBody();
  const { currentDateUnix, currentTime } = useNowIndicator();
  const startUnix = useDateChangedListener();

  const isShowNowIndicator = showNowIndicator && startUnix === currentDateUnix;

  if (!isShowNowIndicator) {
    return null;
  }
  return (
    <NowIndicatorInner
      currentTime={currentTime}
      dayIndex={0}
      startLeft={hourWidth}
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
