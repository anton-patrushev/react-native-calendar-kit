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

  const visibleDate = visibleDates[currentDateUnix];
  const isShowNowIndicator = showNowIndicator && visibleDate;

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
  container: { position: 'absolute', zIndex: 1 },
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
