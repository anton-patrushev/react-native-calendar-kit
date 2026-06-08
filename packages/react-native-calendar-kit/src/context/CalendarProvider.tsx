import type { WeekdayNumbers } from 'luxon';
import type { FC, PropsWithChildren } from 'react';
import React from 'react';
import type { AnimatedRef, SharedValue } from 'react-native-reanimated';
import type Animated from 'react-native-reanimated';
import type HapticService from '../service/HapticService';
import type { DataByMode } from '../utils/utils';
import { CalendarListRef } from '../service/CalendarList';
import { LinkedScrollGroup } from '../hooks/useLinkedScrollGroup';
import { DateResourceItem } from '../components/Resource/ResourceListView';
import type { ResourceItem } from '../types';

export interface CalendarContextProps {
  calendarData: DataByMode;
  calendarLayout: { width: number; height: number };
  visibleDateUnix: React.RefObject<number>;
  hourWidth: number;
  numberOfDays: number;
  verticalListRef: AnimatedRef<Animated.ScrollView>;
  dayBarListRef: AnimatedRef<Animated.ScrollView>;
  gridListRef: AnimatedRef<Animated.ScrollView>;
  firstDay: WeekdayNumbers;
  offsetY: SharedValue<number>;
  minuteHeight: Readonly<SharedValue<number>>;
  maxTimelineHeight: number;
  maxTimeIntervalHeight: number;
  minTimeIntervalHeight: number;
  timeIntervalHeight: SharedValue<number>;
  allowPinchToZoom: boolean;
  spaceFromTop: number;
  spaceFromBottom: number;
  slots: number[];
  timelineHeight: Readonly<SharedValue<number>>;
  totalSlots: number;
  start: number;
  end: number;
  timeInterval: number;
  scrollVisibleHeight: React.RefObject<number>;
  offsetX: SharedValue<number>;
  showWeekNumber: boolean;
  calendarGridWidth: number;
  columnWidth: number;
  scrollByDay: boolean;
  initialOffset: number;
  isRTL: boolean;
  snapToInterval?: number;
  columns: number;
  triggerDateChanged: React.RefObject<number | undefined>;
  visibleDateUnixAnim: SharedValue<number>;
  visibleWeeks: SharedValue<number[]>;
  calendarListRef: React.RefObject<CalendarListRef | null>;
  startOffset: Readonly<SharedValue<number>>;
  scrollVisibleHeightAnim: SharedValue<number>;
  pagesPerSide: number;
  rightEdgeSpacing: number;
  overlapEventsSpacing: number;
  hideWeekDays: WeekdayNumbers[];
  useAllDayEvent: boolean;
  hapticService: HapticService;
  allowDragToCreate: boolean;
  allowDragToEdit: boolean;
  dragToCreateMode: 'duration' | 'date-time';
  allowHorizontalSwipe: boolean;
  enableResourceScroll: boolean;
  resourcePerPage: number;
  resourcePagingEnabled: boolean;
  linkedScrollGroup: LinkedScrollGroup;
  dateResourceItems?: DateResourceItem[];
  /**
   * The resources prop, threaded through context so consumers (e.g. the
   * header) read a value in step with the `resources` prop instead of the
   * EventsProvider store, which is written in an effect and lags by a commit.
   */
  resources?: ResourceItem[];
  daySnapOffsets?: number[];
  handleResourceScrollOffsetChange?: (offset: number) => void;
  /** Current zoom scale. Writable — changes during pinch, persists after. */
  zoomScale: SharedValue<number>;
  /** Minimum zoom scale: minTimeIntervalHeight / initialTimeIntervalHeight. */
  minZoomScale: number;
  /** Maximum zoom scale: maxTimeIntervalHeight / initialTimeIntervalHeight. */
  maxZoomScale: number;
  /**
   * `true` while a pinch gesture is in progress. Written by usePinchToZoom,
   * read by CalendarContainer (to gate `onZoomChange` emissions) and by
   * CalendarBody (to skip vertical scroll-offset overwrites on Android).
   */
  isPinching: SharedValue<boolean>;
  /**
   * `true` while the post-pinch overscroll spring is animating. Written by
   * usePinchToZoom around the `withSpring(...)` call. The onZoomChange
   * reaction in CalendarContainer waits for BOTH `isPinching` and
   * `isSettling` to be false before emitting.
   */
  isSettling: SharedValue<boolean>;
}

export const CalendarContext = React.createContext<
  CalendarContextProps | undefined
>(undefined);

const CalendarProvider: FC<
  PropsWithChildren<{ value: CalendarContextProps }>
> = ({ value, children }) => {
  return (
    <CalendarContext.Provider value={value}>
      {children}
    </CalendarContext.Provider>
  );
};

export default CalendarProvider;

export const useCalendar = () => {
  const context = React.useContext(CalendarContext);
  if (context === undefined) {
    throw new Error('useCalendar must be used within a CalendarProvider');
  }
  return context;
};
