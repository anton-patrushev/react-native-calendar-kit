import React, { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useDerivedValue,
} from 'react-native-reanimated';
import { useBody } from '../../context/BodyContext';
import { useTapFeedback } from '../../context/TapFeedbackContext';
import type { ResourceItem } from '../../types';
import {
  getDayIndex,
  getEventWidth,
  getIndicatorPosition,
} from '../../utils/positionUtils';

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 999,
  },
  innerBox: {
    flex: 1,
    marginHorizontal: 1,
    borderWidth: 2,
    borderRadius: 4,
    borderStyle: 'solid',
  },
});

/**
 * Get resource index by looking up the resource ID.
 */
const getResourceIndexById = (
  resourceId: string | undefined,
  resources: ResourceItem[] | undefined
): number => {
  if (!resourceId || !resources || resources.length <= 1) return 0;
  const index = resources.findIndex((r) => r.id === resourceId);
  return index >= 0 ? index : 0;
};

interface TappedSlotIndicatorInnerProps {
  resources?: ResourceItem[];
  borderColor: string;
}

const TappedSlotIndicatorInner = memo(
  ({ resources, borderColor }: TappedSlotIndicatorInnerProps) => {
    const { tappedSlot } = useTapFeedback();

    const {
      minuteHeight,
      start,
      hourWidth,
      columnWidth,
      visibleDateUnixAnim,
      calendarData,
      columns,
      enableResourceScroll,
      resourcePerPage,
    } = useBody();

    const { startMinutes, durationMinutes, dateUnix } = tappedSlot!;

    const totalResources =
      resources && resources.length > 1 ? resources.length : 1;

    const resourceIndex = useMemo(
      () => getResourceIndexById(tappedSlot!.resourceId, resources),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [tappedSlot!.resourceId, resources]
    );

    const eventWidth = getEventWidth(
      columnWidth,
      enableResourceScroll,
      resourcePerPage,
      totalResources
    );

    const dayIndex = useDerivedValue(
      () =>
        getDayIndex(dateUnix, calendarData, visibleDateUnixAnim, columns),
      [dateUnix, calendarData, columns]
    );

    const animatedStyle = useAnimatedStyle(() => {
      return getIndicatorPosition(
        startMinutes,
        durationMinutes,
        start,
        minuteHeight.value,
        hourWidth,
        eventWidth,
        resourceIndex,
        dayIndex.value,
        enableResourceScroll
      );
    }, [
      startMinutes,
      durationMinutes,
      start,
      hourWidth,
      eventWidth,
      resourceIndex,
    ]);

    return (
      <Animated.View
        entering={FadeIn.duration(150)}
        exiting={FadeOut.duration(150)}
        style={[styles.container, animatedStyle]}
        pointerEvents="none"
      >
        <View
          style={[
            styles.innerBox,
            {
              backgroundColor: 'transparent',
              borderColor,
            },
          ]}
        />
      </Animated.View>
    );
  }
);

TappedSlotIndicatorInner.displayName = 'TappedSlotIndicatorInner';

interface TappedSlotIndicatorProps {
  resources?: ResourceItem[];
  borderColor?: string;
}

/**
 * Component that reads tapped slot from context and renders the indicator.
 * Auto-hide is handled by TapFeedbackContext.
 */
const TappedSlotIndicator: React.FC<TappedSlotIndicatorProps> = ({
  resources,
  borderColor = 'rgba(0,0,0,0.3)',
}) => {
  const { tappedSlot } = useTapFeedback();

  if (!tappedSlot) {
    return null;
  }

  return (
    <TappedSlotIndicatorInner
      resources={resources}
      borderColor={borderColor}
    />
  );
};

export default memo(TappedSlotIndicator);
