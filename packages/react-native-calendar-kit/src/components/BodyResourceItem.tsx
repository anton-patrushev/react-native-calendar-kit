import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
} from 'react-native-reanimated';
import { EXTRA_HEIGHT } from '../constants';
import { useBody } from '../context/BodyContext';
import { useDateChangedListener } from '../context/VisibleDateProvider';
import { ResourceItem } from '../types';
import Events from './Events';
import LoadingOverlay from './Loading/Overlay';
import ResourceBoard from './Resource/ResourceBoard';

interface BodyResourceItemProps {
  resources: ResourceItem[];
  dateUnix?: number;
}

const BodyResourceItem = ({ resources, dateUnix }: BodyResourceItemProps) => {
  const { spaceFromTop, hourWidth, timelineHeight, spaceFromBottom, calendarData } =
    useBody();
  const globalVisibleDateUnix = useDateChangedListener();

  // Use provided dateUnix (dual-axis mode) or global visibleDateUnix (regular resource mode)
  const visibleDateUnix = dateUnix ?? globalVisibleDateUnix;

  // Build visibleDates for prev, current, next days
  const visibleDates = useMemo(() => {
    const visibleDatesArray = calendarData.visibleDatesArray;
    const currentIndex = visibleDatesArray.indexOf(visibleDateUnix);

    const data: Record<string, { diffDays: number; unix: number }> = {};
    let diffDays = 1;

    // Show prev, current, next days
    for (let i = -1; i <= 1; i++) {
      const index = currentIndex + i;
      if (index >= 0 && index < visibleDatesArray.length) {
        const unix = visibleDatesArray[index];
        data[unix] = {
          unix,
          diffDays,
        };
        diffDays += 1;
      }
    }

    return data;
  }, [visibleDateUnix, calendarData.visibleDatesArray]);

  const height = useDerivedValue(() => {
    return timelineHeight.value - spaceFromTop - spaceFromBottom;
  }, [spaceFromTop, spaceFromBottom]);

  const animView = useAnimatedStyle(() => ({
    height: height.value,
  }));

  return (
    <View style={styles.container}>
      <ResourceBoard resources={resources} />
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.content,
          {
            left: resources ? 0 : Math.max(0, hourWidth - 1),
            top: EXTRA_HEIGHT + spaceFromTop,
          },
          animView,
        ]}>
        <Events
          startUnix={visibleDateUnix}
          visibleDates={visibleDates}
          resources={resources}
        />
      </Animated.View>
      <LoadingOverlay />
    </View>
  );
};

export default BodyResourceItem;

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { position: 'absolute', width: '100%' },
});
