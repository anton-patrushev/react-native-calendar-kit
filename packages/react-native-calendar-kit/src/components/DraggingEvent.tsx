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

    // Default (center) transformOrigin so counter-scale shrinks the dot
    // around its own center. The dot is already positioned by layout
    // (top: -12) so its visual center sits exactly on the event's top
    // edge — center-origin scale keeps it there at any zoom.
    return (
      <Animated.View
        style={[
          styles.dot,
          styles.dotLeft,
          numberOfDays === 1 && styles.dotLeftSingle,
          counterScaleStyle,
        ]}>
        {TopEdgeComponent || <DragDot />}
      </Animated.View>
    );
  };

  const renderBottomEdgeComponent = () => {
    if (!isShowDot) {
      return null;
    }

    return (
      <Animated.View
        style={[
          styles.dot,
          styles.dotRight,
          numberOfDays === 1 && styles.dotRightSingle,
          counterScaleStyle,
        ]}>
        {BottomEdgeComponent || <DragDot />}
      </Animated.View>
    );
  };

  // Base border width / radius — sourced from consumer's containerStyle
  // first, then theme.eventContainerStyle, then library defaults. Always
  // zoom-compensate so the consumer's static value doesn't visibly stretch
  // at high zoom.
  const consumerBorderWidth =
    typeof (containerStyle as { borderWidth?: number } | undefined)
      ?.borderWidth === 'number'
      ? (containerStyle as { borderWidth: number }).borderWidth
      : undefined;
  const consumerBorderRadius =
    typeof (containerStyle as { borderRadius?: number } | undefined)
      ?.borderRadius === 'number'
      ? (containerStyle as { borderRadius: number }).borderRadius
      : undefined;
  const themeBorderRadius =
    typeof (theme.eventContainerStyle as { borderRadius?: number } | undefined)
      ?.borderRadius === 'number'
      ? (theme.eventContainerStyle as { borderRadius: number }).borderRadius
      : undefined;
  const baseDraggingWidth = consumerBorderWidth ?? 3;
  const baseDraggingRadius =
    consumerBorderRadius ?? themeBorderRadius ?? 4;

  // Left/right border width is static (X axis not scaled by zoom) —
  // mirrors baseDraggingWidth so all four sides match at any zoom.
  const sideBordersStyle = {
    borderLeftWidth: baseDraggingWidth,
    borderRightWidth: baseDraggingWidth,
  };
  // Top/bottom widths + borderRadius animate with zoom so their visual
  // values stay constant. Drag is mutually exclusive with pinch, so
  // zoomScale is constant during drag — this animated layout prop fires
  // at most once per drag mount.
  const outlineBorderStyle = useAnimatedStyle(() => ({
    borderTopWidth: baseDraggingWidth / zoomScale.value,
    borderBottomWidth: baseDraggingWidth / zoomScale.value,
    // RN has no asymmetric X/Y radii, so horizontal radius flattens at
    // high zoom — accepted trade-off vs the alternative of unbounded
    // vertical curve eating into content.
    borderRadius: baseDraggingRadius / zoomScale.value,
  }));

  return (
    <Animated.View style={[styles.container, { width: eventWidth }, animView]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          theme.eventContainerStyle,
          // Backgrounds + library default borderColor — consumer's
          // containerStyle.borderColor (if any) overrides via the array
          // order below.
          {
            backgroundColor: draggingEvent?.color ?? 'transparent',
            borderColor: theme.primaryColor,
            overflow: 'hidden',
          },
          containerStyle,
          // Apply our computed border widths/radius LAST so they always
          // win over consumer's static shorthand `borderWidth` — RN's
          // per-side border merging makes side-specific properties
          // override the shorthand, which is exactly what we want here.
          sideBordersStyle,
          outlineBorderStyle,
        ]}>
        {renderEvent ? (
          renderEvent(draggingEvent, {
            width: eventWidthAnim,
            height: eventHeight,
          })
        ) : (
          <Animated.View
            style={[{ transformOrigin: 'top' }, counterScaleStyle]}>
            {!!draggingEvent?.title && (
              <Text style={[styles.eventTitle, theme.eventTitleStyle]}>
                {draggingEvent.title}
              </Text>
            )}
          </Animated.View>
        )}
      </Animated.View>
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
    borderLeftWidth: 3,
    borderRightWidth: 3,
    // borderRadius supplied by outlineBorderStyle (animated by zoom).
    overflow: 'hidden',
  },
  dotLeft: { top: -12, left: -12 },
  dotRight: { bottom: -12, right: -12 },
  eventTitle: { fontSize: 12, paddingHorizontal: 2 },
  dotLeftSingle: { left: 0 },
  dotRightSingle: { right: 0 },
});
