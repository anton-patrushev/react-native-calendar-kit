import type { FC } from 'react';
import React, { useCallback } from 'react';
import type { ViewStyle } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
} from 'react-native-reanimated';
import { useBody } from '../context/BodyContext';
import { useDragEvent } from '../context/DragEventProvider';
import { useTheme } from '../context/ThemeProvider';
import type { ResourceItem, SelectedEventType } from '../types';
import { getDayIndex, getEventWidth } from '../utils/positionUtils';
import { clampValues } from '../utils/utils';
import DragDot from './DragDot';

export interface DraggingEventProps {
  renderEvent?: (
    event: SelectedEventType | undefined,
    options: {
      width: SharedValue<number>;
      height: SharedValue<number>;
    }
  ) => React.ReactElement | null;
  TopEdgeComponent?: React.ReactElement | null;
  BottomEdgeComponent?: React.ReactElement | null;
  containerStyle?: ViewStyle;
  resources?: ResourceItem[];
}

/**
 * Get resource index by calculating from drag X position.
 */
const getResourceIndexByPosition = (
  dragX: number,
  hourWidth: number,
  eventWidth: number,
  totalResources: number
): number => {
  'worklet';
  if (totalResources === 1) {
    return 0;
  }
  const xWithoutHourWidth = dragX - hourWidth;
  const columnIndex = Math.floor(xWithoutHourWidth / eventWidth);
  return clampValues(columnIndex, 0, totalResources - 1);
};

export const DraggingEvent: FC<DraggingEventProps> = ({
  renderEvent,
  TopEdgeComponent,
  BottomEdgeComponent,
  containerStyle,
  resources,
}) => {
  const theme = useTheme(
    useCallback((state) => {
      return {
        primaryColor: state.colors.primary,
        eventContainerStyle: state.eventContainerStyle,
        eventTitleStyle: state.eventTitleStyle,
      };
    }, [])
  );

  const {
    minuteHeight,
    columnWidth,
    start,
    hourWidth,
    visibleDateUnixAnim,
    calendarData,
    columns,
    numberOfDays,
    dragToCreateMode,
    enableResourceScroll,
    resourcePerPage,
    counterScaleStyle,
    zoomScale,
  } = useBody();
  const {
    dragDuration,
    dragStartMinutes,
    dragStartUnix,
    draggingEvent,
    dragX,
    selectedEvent,
  } = useDragEvent();
  const isCreate = !selectedEvent;
  const isShowDot = (dragToCreateMode !== 'date-time' && isCreate) || !isCreate;

  const totalResources =
    resources && resources.length > 1 ? resources.length : 1;

  const eventWidth = getEventWidth(
    columnWidth,
    enableResourceScroll,
    resourcePerPage,
    totalResources
  );
  const eventWidthAnim = useDerivedValue(() => eventWidth, [eventWidth]);

  const resourceIndex = useDerivedValue(() => {
    return getResourceIndexByPosition(
      dragX.value,
      hourWidth,
      eventWidth,
      totalResources
    );
  }, [totalResources, hourWidth]);

  const internalDayIndex = useSharedValue(
    getDayIndex(dragStartUnix.value, calendarData, visibleDateUnixAnim, columns)
  );

  useAnimatedReaction(
    () => dragStartUnix.value,
    (dayUnix) => {
      if (dayUnix !== -1) {
        const dayIndex = getDayIndex(
          dayUnix,
          calendarData,
          visibleDateUnixAnim,
          columns
        );
        // Update immediately without animation to avoid position lag after drag ends
        internalDayIndex.value = dayIndex;
      }
    }
  );

  const eventHeight = useDerivedValue(() => {
    return dragDuration.value * minuteHeight.value;
  });

  const animView = useAnimatedStyle(() => {
    const startX = resourceIndex.value * eventWidth;
    const dIndex = enableResourceScroll ? 0 : internalDayIndex.value;

    return {
      top: (dragStartMinutes.value - start) * minuteHeight.value,
      height: dragDuration.value * minuteHeight.value,
      left: startX + hourWidth + eventWidth * dIndex - 1,
    };
  }, [totalResources, hourWidth]);

  const renderTopEdgeComponent = () => {
    if (!isShowDot) {
      return null;
    }

    if (TopEdgeComponent) {
      return TopEdgeComponent;
    }

    return (
      <Animated.View
        style={[
          styles.dot,
          styles.dotLeft,
          numberOfDays === 1 && styles.dotLeftSingle,
          counterScaleStyle,
        ]}>
        <DragDot />
      </Animated.View>
    );
  };

  const renderBottomEdgeComponent = () => {
    if (!isShowDot) {
      return null;
    }

    if (BottomEdgeComponent) {
      return BottomEdgeComponent;
    }

    return (
      <Animated.View
        style={[
          styles.dot,
          styles.dotRight,
          numberOfDays === 1 && styles.dotRightSingle,
          counterScaleStyle,
        ]}>
        <DragDot />
      </Animated.View>
    );
  };

  return (
    <Animated.View style={[styles.container, { width: eventWidth }, animView]}>
      <View
        style={[
          StyleSheet.absoluteFill,
          theme.eventContainerStyle,
          styles.event,
          {
            backgroundColor: draggingEvent?.color ?? 'transparent',
            borderColor: theme.primaryColor,
          },
          containerStyle,
        ]}>
        {renderEvent ? (
          renderEvent(draggingEvent, {
            width: eventWidthAnim,
            height: eventHeight,
          })
        ) : (
          <Animated.View style={counterScaleStyle}>
            {!!draggingEvent?.title && (
              <Text style={[styles.eventTitle, theme.eventTitleStyle]}>
                {draggingEvent.title}
              </Text>
            )}
          </Animated.View>
        )}
      </View>
      {isShowDot && renderTopEdgeComponent()}
      {isShowDot && renderBottomEdgeComponent()}
    </Animated.View>
  );
};

interface DraggingEventWrapperProps {
  renderEvent?: (
    event: SelectedEventType | undefined,
    options: {
      width: SharedValue<number>;
      height: SharedValue<number>;
    }
  ) => React.ReactElement | null;
  renderDraggingEvent?: (props: {
    renderEvent?: (
      event: SelectedEventType | undefined,
      options: {
        width: SharedValue<number>;
        height: SharedValue<number>;
      }
    ) => React.ReactElement | null;
    resources?: ResourceItem[];
  }) => React.ReactElement | null;
  resources?: ResourceItem[];
}

const DraggingEventWrapper = ({
  renderDraggingEvent,
  renderEvent,
  resources,
}: DraggingEventWrapperProps) => {
  const { isDragging } = useDragEvent();
  const { isPendingConfirmation } = useDragEvent();
  const [isVisible, setIsVisible] = React.useState(false);

  // Keep dragging event visible during drag or pending confirmation
  useAnimatedReaction(
    () => isPendingConfirmation.value,
    (pending) => {
      runOnJS(setIsVisible)(isDragging || pending);
    },
    [isDragging]
  );

  React.useEffect(() => {
    setIsVisible(isDragging || isPendingConfirmation.value);
  }, [isDragging, isPendingConfirmation]);

  if (!isVisible) {
    return null;
  }

  if (renderDraggingEvent) {
    return renderDraggingEvent({
      renderEvent,
      resources,
    });
  }

  return <DraggingEvent renderEvent={renderEvent} resources={resources} />;
};

export default DraggingEventWrapper;

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
  },
  dot: {
    position: 'absolute',
    borderRadius: 12,
    width: 24,
    height: 24,
  },
  event: {
    borderWidth: 3,
    borderRadius: 4,
    overflow: 'hidden',
  },
  dotLeft: { top: -12, left: -12 },
  dotRight: { bottom: -12, right: -12 },
  eventTitle: { fontSize: 12, paddingHorizontal: 2 },
  dotLeftSingle: { left: 0 },
  dotRightSingle: { right: 0 },
});
