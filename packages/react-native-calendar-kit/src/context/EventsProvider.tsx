import type { WeekdayNumbers } from 'luxon';
import type { ForwardRefRenderFunction, PropsWithChildren } from 'react';
import React, {
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { DEFAULT_MIN_START_DIFFERENCE } from '../constants';
import useLazyRef from '../hooks/useLazyRef';
import { useSyncExternalStoreWithSelector } from '../hooks/useSyncExternalStoreWithSelector';
import type { Store } from '../storeBuilder';
import { createStore } from '../storeBuilder';
import type {
  EventItem,
  EventItemInternal,
  PackedAllDayEvent,
  PackedEvent,
  ResourceItem,
} from '../types';
import { forceUpdateZone, parseDateTime } from '../utils/dateUtils';
import {
  divideAllDayEvents,
  divideEvents,
  filterEvents,
  populateEvents,
  processAllDayEventMap,
  processEventOccurrences,
} from '../utils/eventUtils';
import { useDateChangedListener } from './VisibleDateProvider';

interface EventsState {
  allDayEvents: Record<string, PackedAllDayEvent[]>;
  allDayEventsByDay: Record<string, PackedAllDayEvent[]>;
  regularEvents: Record<string, PackedEvent[]>;
  eventCountsByDay: Record<string, number>;
  eventCountsByWeek: Record<string, number>;
  resources?: ResourceItem[];
}

const EventsContext = React.createContext<Store<EventsState> | undefined>(
  undefined
);

interface EventsProviderProps {
  firstDay: WeekdayNumbers;
  events?: EventItem[];
  timeZone: string;
  useAllDayEvent?: boolean;
  pagesPerSide: number;
  hideWeekDays: WeekdayNumbers[];
  defaultOffset?: number;
  minRegularEventMinutes?: number;
  overlapType?: 'no-overlap' | 'overlap';
  minStartDifference?: number;
  resources?: ResourceItem[];
  overlappingConfig?: {
    minStartDifferenceForStack?: number;
    durationDiffThreshold?: number;
    stackOffset?: number | string;
    containedOffset?: number | string;
    maxStackOffsetPercentage?: number;
    sideBySideGap?: number;
  };
  columnWidth?: number;
}

export interface EventsRef {
  getEventsByDate: (date: string) => PackedEvent[];
}

const EventsProvider: ForwardRefRenderFunction<
  EventsRef,
  PropsWithChildren<EventsProviderProps>
> = (
  {
    pagesPerSide,
    events = [],
    children,
    timeZone,
    firstDay,
    useAllDayEvent: showAllDay,
    hideWeekDays,
    defaultOffset = 7,
    minRegularEventMinutes = 1,
    overlapType = 'no-overlap',
    minStartDifference = DEFAULT_MIN_START_DIFFERENCE,
    resources,
    overlappingConfig,
    columnWidth,
  },
  ref
) => {
  const eventStore = useLazyRef(() =>
    createStore<EventsState>({
      allDayEvents: {},
      allDayEventsByDay: {},
      regularEvents: {},
      eventCountsByDay: {},
      eventCountsByWeek: {},
      resources: undefined,
    })
  ).current;
  const currentStartDate = useDateChangedListener();

  // Tracks the input set the cached event store was built against. When
  // a date-change-only useEffect re-runs with a new center date but the
  // events prop reference, timezone and other range-shape inputs haven't
  // changed AND the new center is still inside the cached window minus
  // a one-page margin, we skip the heavy recompute. notifyDataChanged is
  // O(events * processing) — when a consumer has hundreds of events the
  // recompute alone can block JS for ~50-100ms, which compounds during a
  // fast horizontal swipe and drops JS FPS toward 0.
  const lastProcessed = useRef<{
    events: EventItem[] | undefined;
    timeZone: string | undefined;
    pagesPerSide: number | undefined;
    resources: ResourceItem[] | undefined;
    minUnix: number;
    maxUnix: number;
  }>({
    events: undefined,
    timeZone: undefined,
    pagesPerSide: undefined,
    resources: undefined,
    minUnix: 0,
    maxUnix: 0,
  });

  const notifyDataChanged = useCallback(
    (date: number, offset: number = defaultOffset) => {
      const zonedDate = forceUpdateZone(date, timeZone);
      const minUnix = zonedDate
        .minus({ days: offset * pagesPerSide })
        .toMillis();
      const maxUnix = zonedDate
        .plus({ days: offset * (pagesPerSide + 1) })
        .toMillis();

      // Skip the heavy recompute when nothing relevant changed AND the
      // new center is still inside the cached window with at least one
      // page of margin on each side. Without this gate, swiping across
      // adjacent days re-runs the full event-processing pipeline (event
      // filter + occurrence expansion + overlap packing for every day in
      // the window) — easily 50-100ms per call on a typical core-mobile
      // event load, which compounds with each column boundary and tanks
      // JS FPS during fast scroll.
      const cached = lastProcessed.current;
      const eventsSame = cached.events === events;
      const tzSame = cached.timeZone === timeZone;
      const ppsSame = cached.pagesPerSide === pagesPerSide;
      // `resources` is both written into the store below and fed to
      // `populateEvents` (it decides which column an event packs into), so a
      // change to it MUST force a recompute. Omitting it here strands the
      // store at a stale resource set: on a single -> multi provider switch
      // (events ref unchanged) the gate would skip, the store would keep its
      // old `resources`, and the body's ResourceListView — which reads the
      // store — would render `count: 0` columns (blank/white) while the
      // layout still thinks it is in resource mode. Identity compare is enough:
      // the `resources` prop is memoized upstream and only changes reference
      // when its contents change, so steady-state swipes still hit the skip.
      const resourcesSame = cached.resources === resources;
      const offsetMs = offset * 86400000;
      const marginMs = offsetMs; // one page of margin on each side
      if (
        eventsSame &&
        tzSame &&
        ppsSame &&
        resourcesSame &&
        minUnix + marginMs >= cached.minUnix &&
        maxUnix - marginMs <= cached.maxUnix
      ) {
        return;
      }
      lastProcessed.current = {
        events,
        timeZone,
        pagesPerSide,
        resources,
        minUnix,
        maxUnix,
      };

      const { regular: regularEvents, allDays: allDayEvents } = filterEvents(
        events,
        minUnix,
        maxUnix,
        showAllDay
      );

      // Process regular events
      const regularEventMap = new Map<number, EventItemInternal[]>();
      regularEvents.forEach((event) => {
        const processedEvents = processEventOccurrences(
          event,
          minUnix,
          maxUnix,
          timeZone,
          (e, tz) => divideEvents(e, tz, minRegularEventMinutes)
        );
        processedEvents.forEach((evt) => {
          const dayStart = parseDateTime(evt._internal.startUnix)
            .startOf('day')
            .toMillis();
          if (!regularEventMap.has(dayStart)) {
            regularEventMap.set(dayStart, []);
          }
          regularEventMap.get(dayStart)!.push(evt);
        });
      });
      const packedRegularEvents: Record<string, PackedEvent[]> = {};
      regularEventMap.forEach((rEvents, day) => {
        packedRegularEvents[day] = populateEvents(rEvents, {
          overlap: overlapType === 'overlap',
          minStartDifference,
          resources,
          overlappingConfig,
          availableWidth: columnWidth,
        });
      });

      // Process all-day events
      const allDayEventMap = new Map<number, EventItemInternal[]>();
      allDayEvents.forEach((event) => {
        const processedEvents = processEventOccurrences(
          event,
          minUnix,
          maxUnix,
          timeZone,
          (e, tz) => divideAllDayEvents(e, tz, firstDay, hideWeekDays)
        );
        processedEvents.forEach((evt) => {
          const weekStart = evt._internal.weekStart;
          if (!weekStart) {
            return;
          }
          if (!allDayEventMap.has(weekStart)) {
            allDayEventMap.set(weekStart, []);
          }
          allDayEventMap.get(weekStart)!.push(evt);
        });
      });

      const {
        packedAllDayEvents,
        packedAllDayEventsByDay,
        eventCountsByWeek,
        eventCountsByDay,
      } = processAllDayEventMap(allDayEventMap, timeZone, hideWeekDays);

      eventStore.setState({
        regularEvents: packedRegularEvents,
        allDayEvents: packedAllDayEvents,
        allDayEventsByDay: packedAllDayEventsByDay,
        eventCountsByDay,
        eventCountsByWeek,
        resources,
      });
    },
    [
      defaultOffset,
      timeZone,
      pagesPerSide,
      events,
      showAllDay,
      hideWeekDays,
      eventStore,
      resources,
      minRegularEventMinutes,
      overlapType,
      minStartDifference,
      firstDay,
      overlappingConfig,
      columnWidth,
    ]
  );

  useImperativeHandle(ref, () => ({
    getEventsByDate: (date: string) => {
      const dateObj = parseDateTime(date);
      const dateUnix = dateObj.startOf('day').toMillis();
      const regularEvents = eventStore.getState().regularEvents[dateUnix];
      if (!regularEvents) {
        return [];
      }
      const targetUnix = forceUpdateZone(dateObj, timeZone).toMillis();
      const filteredEvents = regularEvents.filter((event) => {
        const eventStart = parseDateTime(event.start.dateTime).toMillis();
        const eventEnd = parseDateTime(event.end.dateTime).toMillis();
        return eventStart <= targetUnix && eventEnd >= targetUnix;
      });
      return filteredEvents;
    },
  }));

  useEffect(() => {
    notifyDataChanged(currentStartDate);
  }, [events, notifyDataChanged, currentStartDate]);

  return (
    <EventsContext.Provider value={eventStore}>
      {children}
    </EventsContext.Provider>
  );
};

export default forwardRef(EventsProvider);

export const useAllDayEvents = (
  date: number,
  numberOfDays: number,
  visibleDays: Record<number, { unix: number }>
) => {
  const eventsContext = useContext(EventsContext);

  const selectorByDate = useCallback(
    (state: EventsState) => {
      const data: PackedAllDayEvent[] = [];
      const eventCounts: Record<string, number> = {};
      const totalDays = numberOfDays === 1 ? 1 : 7;
      for (let i = 0; i < totalDays; i++) {
        const dateUnix = parseDateTime(date).plus({ days: i }).toMillis();
        if (visibleDays[dateUnix]) {
          const events = state.allDayEvents[dateUnix];
          const count = state.eventCountsByDay[dateUnix];
          if (count) {
            eventCounts[dateUnix] = count;
          }
          if (events) {
            data.push(...events);
          }
        }
      }

      return { data, eventCounts };
    },
    [date, numberOfDays, visibleDays]
  );

  if (!eventsContext) {
    throw new Error('useAllDayEvents must be used within a EventsProvider');
  }

  const state = useSyncExternalStoreWithSelector(
    eventsContext.subscribe,
    eventsContext.getState,
    selectorByDate
  );
  return state;
};

export const useAllDayEventsByDay = (date: number) => {
  const eventsContext = useContext(EventsContext);

  const selectorByDate = useCallback(
    (state: EventsState) => {
      const events = state.allDayEventsByDay[date] ?? [];
      const eventCounts = state.eventCountsByDay[date] ?? 0;

      return { data: events, eventCounts };
    },
    [date]
  );

  if (!eventsContext) {
    throw new Error('useAllDayEvents must be used within a EventsProvider');
  }

  const state = useSyncExternalStoreWithSelector(
    eventsContext.subscribe,
    eventsContext.getState,
    selectorByDate
  );
  return state;
};

// Equality fn for the `useRegularEvents` selection. The selector rebuilds the
// `data` array on every store read (it spreads per-day event arrays into a
// fresh array), so an unchanged store still yields a new array reference —
// which would otherwise force a re-map of every page's events on any store
// notification. A shallow compare (same length, same element references) lets
// `useSyncExternalStoreWithSelector` keep the previous selection when nothing
// actually changed. Element references are stable across reads because the
// store only allocates new PackedEvent objects when it recomputes.
const regularEventsSelectionIsEqual = (
  a: { data: PackedEvent[] },
  b: { data: PackedEvent[] }
): boolean => {
  if (a === b) {
    return true;
  }
  const aData = a.data;
  const bData = b.data;
  if (aData === bData) {
    return true;
  }
  if (aData.length !== bData.length) {
    return false;
  }
  for (let i = 0; i < aData.length; i++) {
    if (aData[i] !== bData[i]) {
      return false;
    }
  }
  return true;
};

export const useRegularEvents = (
  date: number,
  numberOfDays: number,
  visibleDays: Record<string, { diffDays: number; unix: number }>
) => {
  const eventsContext = useContext(EventsContext);

  const selectorByDate = useCallback(
    (state: EventsState) => {
      const data: PackedEvent[] = [];
      const visibleDaysKeys = Object.keys(visibleDays);

      // If we have explicit visible days, use them directly
      if (visibleDaysKeys.length > 0) {
        visibleDaysKeys.forEach((dateUnixStr) => {
          const events = state.regularEvents[Number(dateUnixStr)];
          if (events) {
            data.push(...events);
          }
        });
      } else {
        // Fallback to original sequential logic
        const totalDays = numberOfDays === 1 ? 1 : 7;
        for (let i = 0; i < totalDays; i++) {
          const dateUnix = parseDateTime(date).plus({ days: i }).toMillis();
          const events = state.regularEvents[dateUnix];
          if (events) {
            data.push(...events);
          }
        }
      }

      return { data };
    },
    [date, numberOfDays, visibleDays]
  );

  if (!eventsContext) {
    throw new Error('useRegularEvents must be used within a EventsProvider');
  }

  const state = useSyncExternalStoreWithSelector(
    eventsContext.subscribe,
    eventsContext.getState,
    selectorByDate,
    regularEventsSelectionIsEqual
  );
  return state;
};

export const useEventCountsByWeek = (type: 'week' | 'day') => {
  const eventsContext = useContext(EventsContext);

  const selectEventCountByWeek = useCallback(
    () =>
      type === 'week'
        ? (eventsContext?.getState().eventCountsByWeek ?? {})
        : (eventsContext?.getState().eventCountsByDay ?? {}),
    [eventsContext, type]
  );

  if (!eventsContext) {
    throw new Error('useRegularEvents must be used within a EventsProvider');
  }

  const state = useSyncExternalStoreWithSelector(
    eventsContext.subscribe,
    eventsContext.getState,
    selectEventCountByWeek
  );
  return state;
};

export const useResources = () => {
  const eventsContext = useContext(EventsContext);
  const selectResources = useCallback(
    () => eventsContext?.getState().resources,
    [eventsContext]
  );

  if (!eventsContext) {
    throw new Error('useResources must be used within a EventsProvider');
  }

  const state = useSyncExternalStoreWithSelector(
    eventsContext.subscribe,
    eventsContext.getState,
    selectResources
  );
  return state;
};

export const useMonthEvents = (
  date: number,
  numberOfDays: number,
  visibleDays: number[]
) => {
  const eventsContext = useContext(EventsContext);

  const selectorByDate = useCallback(
    (state: EventsState) => {
      const data: Record<string, PackedEvent[]> = {};
      for (let i = 0; i < numberOfDays; i++) {
        const dateUnix = parseDateTime(date).plus({ days: i }).toMillis();
        if (visibleDays.includes(dateUnix)) {
          const events = state.regularEvents[dateUnix];
          if (events) {
            data[dateUnix] = events;
          }
        }
      }

      return { data };
    },
    [date, numberOfDays, visibleDays]
  );

  if (!eventsContext) {
    throw new Error('useRegularEvents must be used within a EventsProvider');
  }

  const state = useSyncExternalStoreWithSelector(
    eventsContext.subscribe,
    eventsContext.getState,
    selectorByDate
  );
  return state;
};
