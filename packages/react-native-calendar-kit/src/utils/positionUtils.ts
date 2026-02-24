import type { SharedValue } from 'react-native-reanimated';
import type { CalendarData } from '../context/CalendarProvider';
import { clampValues, findNearestNumber } from './utils';

/**
 * Calculate the day index within visible columns.
 * Used by both DraggingEvent and TappedSlotIndicator.
 */
export const getDayIndex = (
  dayUnix: number,
  calendarData: CalendarData,
  visibleDateUnixAnim: SharedValue<number>,
  columns: number
): number => {
  'worklet';
  let currentIndex = calendarData.visibleDatesArray.indexOf(dayUnix);
  if (currentIndex === -1) {
    const nearestVisibleUnix = findNearestNumber(
      calendarData.visibleDatesArray,
      dayUnix
    );
    const nearestVisibleIndex =
      calendarData.visibleDates[nearestVisibleUnix]?.index;
    if (nearestVisibleIndex === undefined) {
      return 0;
    }
    currentIndex = nearestVisibleIndex;
  }
  let startIndex = calendarData.visibleDatesArray.indexOf(
    visibleDateUnixAnim.value
  );
  if (startIndex === -1) {
    const nearestVisibleUnix = findNearestNumber(
      calendarData.visibleDatesArray,
      visibleDateUnixAnim.value
    );
    const nearestVisibleIndex =
      calendarData.visibleDates[nearestVisibleUnix]?.index;
    if (nearestVisibleIndex === undefined) {
      return 0;
    }
    startIndex = nearestVisibleIndex;
  }
  return clampValues(currentIndex - startIndex, 0, columns - 1);
};

/**
 * Calculate event/indicator width based on column width and resources.
 */
export const getEventWidth = (
  columnWidth: number,
  enableResourceScroll: boolean,
  resourcePerPage: number,
  totalResources: number
): number => {
  return columnWidth / (enableResourceScroll ? resourcePerPage : totalResources);
};

/**
 * Calculate position for event indicator (top, height, left, width).
 * Used by both DraggingEvent and TappedSlotIndicator.
 */
export const getIndicatorPosition = (
  startMinutes: number,
  durationMinutes: number,
  start: number,
  minuteHeight: number,
  hourWidth: number,
  eventWidth: number,
  resourceIndex: number,
  dayIndex: number,
  enableResourceScroll: boolean
): { top: number; height: number; left: number; width: number } => {
  'worklet';
  const dIndex = enableResourceScroll ? 0 : dayIndex;
  const startX = resourceIndex * eventWidth;
  return {
    top: (startMinutes - start) * minuteHeight,
    height: durationMinutes * minuteHeight,
    left: startX + hourWidth + eventWidth * dIndex,
    width: eventWidth - 2,
  };
};
