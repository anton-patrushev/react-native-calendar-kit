import type { DateTime, WeekdayNumbers } from 'luxon';
import {
  DEFAULT_MIN_START_DIFFERENCE,
  MILLISECONDS_IN_DAY,
  MILLISECONDS_IN_MINUTE,
  MINUTES_IN_DAY,
} from '../constants';
import { RRuleGenerator } from '../service/rrule';
import type {
  EventItem,
  EventItemInternal,
  NoOverlapEvent,
  OverlapEvent,
  PackedAllDayEvent,
  PackedEvent,
  ResourceItem,
} from '../types';
import { forceUpdateZone, parseDateTime, startOfWeek } from './dateUtils';

const isValidEventDates = (event: EventItem): boolean => {
  return (
    !!(event.start.date && event.end.date) ||
    !!(event.start.dateTime && event.end.dateTime)
  );
};

const getEventTimes = (
  event: EventItem
): { eventStartUnix: number; eventEndUnix: number; isAllDay: boolean } => {
  const isAllDay = Boolean(event.start.date && event.end.date);

  if (isAllDay) {
    const eventStartUnix = parseDateTime(event.start.date).toMillis();
    const eventEndUnix = parseDateTime(event.end.date).endOf('day').toMillis();
    return { eventStartUnix, eventEndUnix, isAllDay };
  } else {
    const eventStartUnix = parseDateTime(event.start.dateTime, {
      zone: event.start.timeZone,
    }).toMillis();
    const eventEndUnix = parseDateTime(event.end.dateTime, {
      zone: event.end.timeZone,
    }).toMillis();
    return { eventStartUnix, eventEndUnix, isAllDay };
  }
};

const isValidEventRange = (
  eventStartUnix: number,
  eventEndUnix: number,
  minUnix: number,
  maxUnix: number
): boolean => {
  return (
    eventEndUnix > eventStartUnix &&
    eventEndUnix > minUnix &&
    eventStartUnix < maxUnix
  );
};

const createInternalEvent = (
  event: EventItem,
  startUnix: number,
  endUnix: number,
  duration: number
): EventItemInternal => {
  return {
    ...event,
    localId: event.id,
    _internal: {
      startUnix,
      endUnix,
      duration,
    },
  };
};

export type FilteredEvents = {
  allDays: EventItemInternal[];
  regular: EventItemInternal[];
};

export const filterEvents = (
  events: EventItem[],
  minUnix: number,
  maxUnix: number,
  useAllDayEvent?: boolean
): FilteredEvents => {
  const allDays: EventItemInternal[] = [];
  const regular: EventItemInternal[] = [];

  for (const event of events) {
    if (!isValidEventDates(event)) {
      console.warn('Event has invalid date or dateTime', event);
      continue;
    }

    const { eventStartUnix, eventEndUnix, isAllDay } = getEventTimes(event);
    if (
      !isValidEventRange(eventStartUnix, eventEndUnix, minUnix, maxUnix) &&
      !event.recurrence
    ) {
      continue;
    }

    const duration = (eventEndUnix - eventStartUnix) / MILLISECONDS_IN_MINUTE;
    const customEvent: EventItemInternal = createInternalEvent(
      event,
      eventStartUnix,
      eventEndUnix,
      duration
    );

    if (useAllDayEvent && (isAllDay || duration >= MINUTES_IN_DAY)) {
      allDays.push(customEvent);
    } else {
      regular.push(customEvent);
    }
  }

  return { allDays, regular };
};

export const buildInstanceId = (id: string, date: DateTime) => {
  return `${id}_${date.toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'")}`;
};

export const divideEvents = (
  event: EventItemInternal,
  timeZone?: string,
  minRegularEventMinutes?: number
) => {
  const events: EventItemInternal[] = [];
  const eventStart = parseDateTime(event.start.dateTime, {
    zone: event.start.timeZone,
  }).setZone(timeZone);
  const eventEnd = parseDateTime(event.end.dateTime, {
    zone: event.end.timeZone,
  }).setZone(timeZone);

  const startDayOfEventStart = eventStart.startOf('day');
  const startDayOfEventEnd = eventEnd.startOf('day');
  const days = startDayOfEventEnd.diff(startDayOfEventStart, 'days').days + 1;
  for (let i = 0; i < days; i++) {
    let startUnix = forceUpdateZone(eventStart).toMillis();
    let endUnix = forceUpdateZone(eventEnd).toMillis();
    let startMinutes = eventStart.hour * 60 + eventStart.minute;

    const dateObj = parseDateTime(startUnix).plus({ days: i });
    let id = event.localId;
    if (days > 1) {
      if (i === 0) {
        id = `${event.localId}_${startUnix}`;
        endUnix = dateObj.endOf('day').toMillis();
      } else {
        startUnix = dateObj.startOf('day').toMillis();
        startMinutes = 0;
        if (i !== days - 1) {
          endUnix = dateObj.endOf('day').toMillis();
        }
        id = `${event.localId}_${startUnix}`;
      }
    }
    let duration = (endUnix - startUnix) / MILLISECONDS_IN_MINUTE;
    if (minRegularEventMinutes && duration < minRegularEventMinutes) {
      duration = minRegularEventMinutes;
      endUnix = startUnix + duration * MILLISECONDS_IN_MINUTE;
    }
    const nextEvent: EventItemInternal = {
      ...event,
      localId: id,
      _internal: {
        ...event._internal,
        startUnix,
        endUnix,
        duration,
        startMinutes,
      },
    };
    events.push(nextEvent);
  }

  return events;
};

const calculateVisibleDuration = (
  startUnix: number,
  endUnix: number,
  timeZone: string,
  hideWeekDays: WeekdayNumbers[]
) => {
  let duration = 0;
  let currentUnix = startUnix;

  while (currentUnix <= endUnix) {
    const dateTime = parseDateTime(currentUnix, { zone: timeZone });
    const weekday = dateTime.weekday;
    if (!hideWeekDays.includes(weekday)) {
      duration++;
    }
    currentUnix = dateTime.plus({ days: 1 }).toMillis();
  }
  return duration;
};

export const divideAllDayEvents = (
  event: EventItemInternal,
  timeZone: string,
  firstDay: WeekdayNumbers,
  hideWeekDays: WeekdayNumbers[]
) => {
  const events: EventItemInternal[] = [];
  let eventStart = parseDateTime(event._internal.startUnix);
  let eventEnd = parseDateTime(event._internal.endUnix);
  if (event.start.dateTime) {
    eventStart = parseDateTime(event._internal.startUnix, {
      zone: event.start.timeZone,
    }).setZone(timeZone);
  }
  if (event.end.dateTime) {
    eventEnd = parseDateTime(event._internal.endUnix, {
      zone: event.end.timeZone,
    }).setZone(timeZone);
  }

  eventStart = forceUpdateZone(eventStart);
  eventEnd = forceUpdateZone(eventEnd);

  const weekStartUnix = startOfWeek(
    eventStart.toISODate(),
    firstDay
  ).toMillis();
  const weekEndUnix = startOfWeek(eventEnd.toISODate(), firstDay).toMillis();

  const diffWeeks =
    Math.floor((weekEndUnix - weekStartUnix) / (7 * MILLISECONDS_IN_DAY)) + 1;
  const isSameDay = event._internal.startUnix === event._internal.endUnix;
  let eventStartUnix = eventStart.startOf('day').toMillis();
  const eventEndUnix = isSameDay
    ? eventStart.endOf('day').toMillis()
    : parseDateTime(eventEnd.toMillis() - 1)
        .endOf('day')
        .toMillis();

  if (diffWeeks <= 1) {
    // Adjust duration to exclude hidden days
    const duration = calculateVisibleDuration(
      eventStartUnix,
      eventEndUnix,
      timeZone,
      hideWeekDays
    );

    if (duration > 0) {
      events.push({
        ...event,
        _internal: {
          ...event._internal,
          startUnix: eventStartUnix,
          endUnix: eventEndUnix,
          duration,
          weekStart: weekStartUnix,
        },
      });
    }
    return events;
  }

  for (let i = 0; i < diffWeeks; i++) {
    const weekStartDateTime = parseDateTime(weekStartUnix).plus({
      days: 7 * i,
    });
    const weekStart = weekStartDateTime.toMillis();
    let weekEnd = weekStartDateTime.plus({ days: 6 }).endOf('day').toMillis();
    if (eventEndUnix < weekEnd) {
      weekEnd = eventEndUnix;
    }
    const duration = calculateVisibleDuration(
      eventStartUnix,
      weekEnd,
      timeZone,
      hideWeekDays
    );

    if (duration > 0) {
      const newEvent = {
        ...event,
        localId: `${event.localId}_${weekStart}`,
        _internal: {
          ...event._internal,
          startUnix: eventStartUnix,
          endUnix: weekEnd,
          duration,
          weekStart,
        },
      };
      events.push(newEvent);
    }
    eventStartUnix = weekEnd + 1;
  }

  return events;
};

// Helper function to process event occurrences
export function processEventOccurrences(
  event: EventItemInternal,
  minUnix: number,
  maxUnix: number,
  timeZone: string,
  divideFunction: (
    event: EventItemInternal,
    timeZone: string
  ) => EventItemInternal[]
): EventItemInternal[] {
  if (event.recurrence) {
    const rrule = new RRuleGenerator(
      event.recurrence,
      parseDateTime(event.start.dateTime || event.start.date, {
        zone: event.start.timeZone,
      }),
      event.excludeDates
    );

    const occurrences = rrule.generateOccurrences(
      parseDateTime(minUnix, { zone: timeZone }),
      parseDateTime(maxUnix, { zone: timeZone })
    );
    const firstOccurrence = rrule.firstOccurrence(event.start.timeZone);

    const duration = event._internal.duration;
    const {
      recurrence: originalRrule,
      excludeDates,
      _internal,
      ...rest
    } = event;
    return occurrences.flatMap((occurrence) => {
      let eventStart = occurrence;
      if (event.start.dateTime) {
        eventStart = parseDateTime(occurrence, {
          zone: event.start.timeZone,
        });
      }
      const eventEnd = eventStart
        .plus({ minutes: duration })
        .setZone(event.end.timeZone);
      const instanceId = buildInstanceId(event.id, eventStart.toUTC());
      const recurringEvent: EventItemInternal = {
        ...rest,
        start: event.start.dateTime
          ? { dateTime: eventStart.toISO(), timeZone: eventStart.zoneName }
          : { date: eventStart.toISODate() },
        end: event.end.dateTime
          ? {
              dateTime: eventEnd.toISO(),
              timeZone: eventEnd.zoneName,
            }
          : { date: eventEnd.toISODate() },
        id: instanceId,
        localId: instanceId,
        originalStartTime: event.start.dateTime
          ? { dateTime: eventStart.toISO(), timeZone: eventStart.zoneName }
          : { date: eventStart.toISODate() },
        isFirstOccurrence:
          firstOccurrence?.toMillis() === eventStart.toMillis(),
        _internal: {
          ..._internal,
          startUnix: eventStart.toMillis(),
          endUnix: eventEnd.toMillis(),
        },
        originalRecurringEvent: {
          ...rest,
          recurrence: originalRrule,
          excludeDates: [...(excludeDates || []), eventStart.toUTC().toISO()],
        },
      };
      return divideFunction(recurringEvent, timeZone);
    });
  } else {
    return divideFunction(event, timeZone);
  }
}

// Helper function to process all-day events
export function processAllDayEventMap(
  allDayEventMap: Map<number, EventItemInternal[]>,
  timeZone: string,
  hideWeekDays: WeekdayNumbers[]
) {
  const packedAllDayEvents: Record<string, PackedAllDayEvent[]> = {};
  const packedAllDayEventsByDay: Record<string, PackedAllDayEvent[]> = {};
  const eventCountsByWeek: Record<string, number> = {};
  const eventCountsByDay: Record<string, number> = {};

  allDayEventMap.forEach((eventsForWeek, weekStart) => {
    const visibleDays: number[] = getVisibleDays(
      weekStart,
      timeZone,
      hideWeekDays
    );

    const { packedEvents, maxRowCount } = populateAllDayEvents(eventsForWeek, {
      startDate: weekStart,
      endDate: parseDateTime(weekStart)
        .plus({ days: 6 })
        .endOf('day')
        .toMillis(),
      timeZone,
      visibleDays,
    });

    packedAllDayEvents[weekStart] = packedEvents;
    eventCountsByWeek[weekStart] = maxRowCount;

    packedEvents.forEach((event) => {
      const eventStart = event._internal.startUnix;
      const eventEnd = event._internal.endUnix;
      for (
        let dayUnix = eventStart;
        dayUnix <= eventEnd;
        dayUnix = parseDateTime(dayUnix).plus({ days: 1 }).toMillis()
      ) {
        const dayStartUnix = parseDateTime(dayUnix).startOf('day').toMillis();
        if (visibleDays.includes(dayStartUnix)) {
          eventCountsByDay[dayStartUnix] =
            (eventCountsByDay[dayStartUnix] || 0) + 1;
          if (!packedAllDayEventsByDay[dayStartUnix]) {
            packedAllDayEventsByDay[dayStartUnix] = [];
          }
          packedAllDayEventsByDay[dayStartUnix].push(event);
        }
      }
    });
  });

  return {
    packedAllDayEvents,
    packedAllDayEventsByDay,
    eventCountsByWeek,
    eventCountsByDay,
  };
}

// Helper function to get visible days
export function getVisibleDays(
  weekStart: number,
  timeZone: string,
  hideWeekDays: WeekdayNumbers[]
): number[] {
  const visibleDays: number[] = [];
  let currentDayUnix = weekStart;

  for (let i = 0; i < 7; i++) {
    const dateTime = parseDateTime(currentDayUnix, { zone: timeZone });
    const weekday = dateTime.weekday;
    if (!hideWeekDays.includes(weekday)) {
      visibleDays.push(dateTime.toMillis());
    }
    currentDayUnix = dateTime.plus({ days: 1 }).toMillis();
  }
  return visibleDays;
}

const hasCollision = (a: EventItemInternal, b: EventItemInternal) => {
  // Two events overlap if one starts before the other ends AND vice versa
  // a overlaps b if: a.start < b.end AND b.start < a.end
  return (
    a._internal.startUnix < b._internal.endUnix &&
    b._internal.startUnix < a._internal.endUnix
  );
};

export const sortEvents = (
  events: EventItemInternal[]
): EventItemInternal[] => {
  return events.slice().sort((a, b) => {
    // Compare by start time
    if (a._internal.startUnix !== b._internal.startUnix) {
      return a._internal.startUnix - b._internal.startUnix;
    }

    // Compare by title
    const titleA = a.title || '';
    const titleB = b.title || '';
    const titleComparison = titleA.localeCompare(titleB);
    if (titleComparison !== 0) {
      return titleComparison;
    }

    // Compare by duration (longer duration comes first)
    const durationA = a._internal.endUnix - a._internal.startUnix;
    const durationB = b._internal.endUnix - b._internal.startUnix;
    return durationB - durationA;
  });
};

const calcColumnSpan = (
  event: EventItemInternal,
  columnIndex: number,
  columns: EventItemInternal[][]
) => {
  let colSpan = 1;
  for (let i = columnIndex + 1; i < columns.length; i++) {
    const column = columns[i];
    const foundCollision = column.find((ev) => hasCollision(event, ev));
    if (foundCollision) {
      return colSpan;
    }
    colSpan++;
  }
  return colSpan;
};

const packOverlappingEventGroup = (
  columns: EventItemInternal[][],
  calculatedEvents: PackedEvent[],
  populateOptions: {
    resourceIndex?: number;
  }
) => {
  const { resourceIndex } = populateOptions;

  columns.forEach((column, columnIndex) => {
    column.forEach((event) => {
      const columnSpan = calcColumnSpan(event, columnIndex, columns);
      calculatedEvents.push({
        ...event,
        _internal: {
          ...event._internal,
          resourceIndex,
          index: columnIndex,
          columnSpan,
          total: columns.length,
        },
      });
    });
  });
};

const handleNoOverlap = (
  events: EventItemInternal[],
  resourceIndex?: number
) => {
  const options = { resourceIndex };
  let lastEnd: number | null = null;
  let eventColumns: EventItemInternal[][] = [];
  const packedEvents: PackedEvent[] = [];

  const sortedEvents = sortEvents(events) as NoOverlapEvent[];
  for (const event of sortedEvents) {
    if (lastEnd !== null && event._internal.startUnix >= lastEnd) {
      packOverlappingEventGroup(eventColumns, packedEvents, options);
      eventColumns = [];
      lastEnd = null;
    }
    let placed = false;
    for (const column of eventColumns) {
      if (!hasCollision(column[column.length - 1], event)) {
        column.push(event);
        placed = true;
        break;
      }
    }

    if (!placed) {
      eventColumns.push([event]);
    }

    if (lastEnd === null || event._internal.endUnix > lastEnd) {
      lastEnd = event._internal.endUnix;
    }
  }

  if (eventColumns.length > 0) {
    packOverlappingEventGroup(eventColumns, packedEvents, options);
  }

  return packedEvents;
};

function overlapSort(events: EventItemInternal[]): EventItemInternal[] {
  const sortedByTime = events.slice().sort((a, b) => {
    if (a._internal.startUnix !== b._internal.startUnix) {
      return a._internal.startUnix - b._internal.startUnix;
    }
    return b._internal.endUnix - a._internal.endUnix;
  });

  // Use a flag array instead of shift() (O(n)) and splice() (O(n)).
  // Both operations move all subsequent elements; the flag array avoids this.
  const used = new Uint8Array(sortedByTime.length);
  const sorted: EventItemInternal[] = [];

  for (let i = 0; i < sortedByTime.length; i++) {
    if (used[i]) continue;

    const event = sortedByTime[i];
    sorted.push(event);
    used[i] = 1;

    // Find the first non-overlapping, unused event after this one
    for (let j = i + 1; j < sortedByTime.length; j++) {
      if (used[j]) continue;
      if (event._internal.endUnix > sortedByTime[j]._internal.startUnix) {
        continue;
      }
      sorted.push(sortedByTime[j]);
      used[j] = 1;
      break;
    }
  }

  return sorted;
}

const onSameRow = (
  a: OverlapEvent,
  b: OverlapEvent,
  minimumStartDifference: number
) => {
  return (
    Math.abs(b._internal.startUnix - a._internal.startUnix) <
      minimumStartDifference ||
    (b._internal.startUnix > a._internal.startUnix &&
      b._internal.startUnix < a._internal.endUnix)
  );
};

const computeStylesForEvents = (containerEvents: OverlapEvent[]) => {
  for (const containerEvent of containerEvents) {
    // Pre-compute max columns once instead of inside reduce
    const rows = containerEvent._internal.rows!;
    let maxLeaves = 0;
    for (let r = 0; r < rows.length; r++) {
      const leafCount = rows[r]._internal.leaves?.length ?? 0;
      if (leafCount > maxLeaves) maxLeaves = leafCount;
    }
    const columns = maxLeaves + 2; // +1 for row itself, +1 for container

    containerEvent._internal._width = 100 / columns;

    const noOverlap = containerEvent._internal._width;
    const overlap = Math.min(100, containerEvent._internal._width * 1.7);
    containerEvent._internal.width = rows.length > 0 ? overlap : noOverlap;
    containerEvent._internal.xOffset = 0;

    const containerWidth = containerEvent._internal._width;

    for (let r = 0; r < rows.length; r++) {
      const rowEvent = rows[r];
      const leaves = rowEvent._internal.leaves;
      const leafCount = leaves?.length ?? 0;
      const availableWidth = 100 - containerWidth;

      rowEvent._internal._width = availableWidth / (leafCount + 1);

      const noOverlapRow = rowEvent._internal._width;
      const overlapRow = Math.min(100, rowEvent._internal._width * 1.7);
      rowEvent._internal.width = leafCount > 0 ? overlapRow : noOverlapRow;
      rowEvent._internal.xOffset = containerWidth;

      if (leaves && leafCount > 0) {
        const leafWidth = rowEvent._internal._width;
        const rowXOffset = rowEvent._internal.xOffset;
        const lastIndex = leafCount - 1;

        // Use index-based loop instead of for-of + indexOf (O(n) per leaf)
        for (let li = 0; li < leafCount; li++) {
          const leafEvent = leaves[li];

          leafEvent._internal._width = leafWidth;
          leafEvent._internal.width =
            li === lastIndex
              ? leafWidth // no overlap for last leaf
              : Math.min(100, leafWidth * 1.7);
          leafEvent._internal.xOffset = rowXOffset + (li + 1) * leafWidth;
        }
      }
    }
  }
};

const handleOverlap = (
  events: EventItemInternal[],
  minimumStartDifference: number,
  resourceIndex?: number
) => {
  const sortedEvents = overlapSort(events) as OverlapEvent[];
  const containerEvents: OverlapEvent[] = [];
  for (let i = 0; i < sortedEvents.length; i++) {
    const event = sortedEvents[i];
    const container = containerEvents.find(
      (c) =>
        c._internal.endUnix > event._internal.startUnix ||
        Math.abs(event._internal.startUnix - c._internal.startUnix) <
          minimumStartDifference
    );

    if (!container) {
      event._internal.rows = [];
      containerEvents.push(event);
      continue;
    }
    event._internal.container = container;
    let row: OverlapEvent | null = null;
    for (let j = container._internal.rows!.length - 1; !row && j >= 0; j--) {
      if (
        onSameRow(container._internal.rows![j], event, minimumStartDifference)
      ) {
        row = container._internal.rows![j]!;
      }
    }

    if (row) {
      row._internal.leaves = row._internal.leaves || [];
      row._internal.leaves.push(event);
      event._internal.row = row;
    } else {
      event._internal.leaves = [];
      container._internal.rows!.push(event);
    }
  }

  computeStylesForEvents(containerEvents);
  const packedEvents = sortedEvents.map((event) => {
    return {
      ...event,
      _internal: {
        startMinutes: event._internal.startMinutes,
        weekStart: event._internal.weekStart,
        duration: event._internal.duration,
        startUnix: event._internal.startUnix,
        endUnix: event._internal.endUnix,
        widthPercentage: event._internal.width,
        xOffsetPercentage: event._internal.xOffset,
        resourceIndex,
      },
    } as PackedEvent;
  });
  return packedEvents;
};

/**
 * Normalizes offset value to pixels.
 * Accepts either a number (pixels) or a percentage string (e.g., "10%").
 */
const normalizeOffset = (
  offset: number | string,
  availableWidth: number
): number => {
  if (typeof offset === 'string') {
    const percentMatch = offset.match(/^(\d+(?:\.\d+)?)%$/);
    if (percentMatch) {
      const percentage = parseFloat(percentMatch[1]);
      return (availableWidth * percentage) / 100;
    }
    // If it's a string but not a valid percentage, try to parse as number
    const parsed = parseFloat(offset);
    return isNaN(parsed) ? 0 : parsed;
  }
  return offset;
};

interface EnhancedOverlapConfig {
  minStartDifferenceForStack: number;
  durationDiffThreshold: number;
  stackOffset: number;
  containedOffset: number;
  maxStackOffsetPercentage: number;
  sideBySideGap: number;
}

const assignStackLevels = (
  events: EventItemInternal[],
  minDiffMinutes: number,
  collisionCache: Map<string, boolean>
): Map<EventItemInternal, number> => {
  const levels = new Map<EventItemInternal, number>();
  if (events.length === 0) {
    return levels;
  }

  const sorted = [...events].sort((a, b) => {
    if (a._internal.startUnix !== b._internal.startUnix) {
      return a._internal.startUnix - b._internal.startUnix;
    }
    return b._internal.duration - a._internal.duration;
  });

  const cachedHasCollision = (a: EventItemInternal, b: EventItemInternal): boolean => {
    const key = a.localId < b.localId ? `${a.localId}-${b.localId}` : `${b.localId}-${a.localId}`;
    let result = collisionCache.get(key);
    if (result === undefined) {
      result = hasCollision(a, b);
      collisionCache.set(key, result);
    }
    return result;
  };

  const levelEvents = new Map<number, EventItemInternal[]>();
  levelEvents.set(0, [sorted[0]]);
  levels.set(sorted[0], 0);

  for (let i = 1; i < sorted.length; i++) {
    const event = sorted[i];
    let assignedLevel = -1;

    let highestOverlapLevel = -1;
    for (let level = 0; level < levelEvents.size; level++) {
      const eventsInLevel = levelEvents.get(level);
      if (eventsInLevel) {
        for (const levelEvent of eventsInLevel) {
          if (cachedHasCollision(levelEvent, event)) {
            highestOverlapLevel = level;
            break;
          }
        }
      }
    }

    if (highestOverlapLevel !== -1) {
      const eventsInHighestLevel = levelEvents.get(highestOverlapLevel)!;
      let minStartDiff = Infinity;

      for (const levelEvent of eventsInHighestLevel) {
        if (cachedHasCollision(levelEvent, event)) {
          const startDiff =
            Math.abs(event._internal.startUnix - levelEvent._internal.startUnix) /
            MILLISECONDS_IN_MINUTE;
          minStartDiff = Math.min(minStartDiff, startDiff);
        }
      }

      if (minStartDiff < minDiffMinutes) {
        assignedLevel = highestOverlapLevel;
      } else {
        assignedLevel = highestOverlapLevel + 1;
      }
    } else {
      for (let level = 0; level <= levelEvents.size; level++) {
        const eventsInLevel = levelEvents.get(level);
        if (!eventsInLevel || eventsInLevel.length === 0) {
          assignedLevel = level;
          break;
        }

        let foundCollision = false;
        for (const levelEvent of eventsInLevel) {
          if (cachedHasCollision(levelEvent, event)) {
            foundCollision = true;
            break;
          }
        }

        if (!foundCollision) {
          assignedLevel = level;
          break;
        }
      }
    }

    if (assignedLevel === -1) {
      assignedLevel = levelEvents.size;
    }

    if (!levelEvents.has(assignedLevel)) {
      levelEvents.set(assignedLevel, []);
    }
    levelEvents.get(assignedLevel)!.push(event);
    levels.set(event, assignedLevel);
  }

  return levels;
};

const isContainedEvent = (
  shorter: EventItemInternal,
  longer: EventItemInternal,
  config: EnhancedOverlapConfig
): boolean => {
  const fullyContained =
    shorter._internal.startUnix >= longer._internal.startUnix &&
    shorter._internal.endUnix <= longer._internal.endUnix;

  if (!fullyContained) {
    return false;
  }

  // Check start time difference
  const startDiff =
    Math.abs(shorter._internal.startUnix - longer._internal.startUnix) /
    MILLISECONDS_IN_MINUTE;
  if (startDiff < config.minStartDifferenceForStack) {
    return false; // Should be side-by-side
  }

  // Check duration difference
  const durationDiff = Math.abs(longer._internal.duration - shorter._internal.duration);
  return durationDiff > config.durationDiffThreshold;
};

interface LayoutResult {
  event: EventItemInternal;
  widthPercentage: number;
  xOffsetPercentage: number;
  zIndex: number;
  layoutType: 'stacked' | 'side-by-side' | 'contained';
}

const groupOverlappingEvents = (
  events: EventItemInternal[],
  collisionCache: Map<string, boolean>
): EventItemInternal[][] => {
  if (events.length === 0) {
    return [];
  }

  const cachedHasCollision = (a: EventItemInternal, b: EventItemInternal): boolean => {
    const key = a.localId < b.localId ? `${a.localId}-${b.localId}` : `${b.localId}-${a.localId}`;
    let result = collisionCache.get(key);
    if (result === undefined) {
      result = hasCollision(a, b);
      collisionCache.set(key, result);
    }
    return result;
  };

  const sorted = [...events].sort(
    (a, b) => a._internal.startUnix - b._internal.startUnix
  );

  const groups: EventItemInternal[][] = [];

  for (const event of sorted) {
    let targetGroup: EventItemInternal[] | null = null;

    for (const group of groups) {
      if (group.some((e) => cachedHasCollision(e, event))) {
        targetGroup = group;
        break;
      }
    }

    if (targetGroup) {
      targetGroup.push(event);
    } else {
      groups.push([event]);
    }
  }

  return groups;
};

const layoutEventsInLevel = (
  events: EventItemInternal[],
  level: number,
  levelOffsetPx: number,
  availableWidth: number,
  config: EnhancedOverlapConfig
): LayoutResult[] => {
  if (events.length === 0) {
    return [];
  }

  if (events.length === 1) {
    const offsetPercent = (levelOffsetPx / availableWidth) * 100;
    return [
      {
        event: events[0],
        widthPercentage: 100 - offsetPercent,
        xOffsetPercentage: offsetPercent,
        zIndex: level + 1,
        layoutType: 'stacked',
      },
    ];
  }

  const sorted = [...events].sort(
    (a, b) => b._internal.duration - a._internal.duration
  );
  const longest = sorted[0];
  const others = sorted.slice(1);

  const allContained = others.every((e) =>
    isContainedEvent(e, longest, config)
  );

  if (allContained && others.length > 0) {
    const containedOffsetPx = levelOffsetPx + config.containedOffset;
    const containedOffsetPercent = (containedOffsetPx / availableWidth) * 100;
    const baseOffsetPercent = (levelOffsetPx / availableWidth) * 100;

    return [
      {
        event: longest,
        widthPercentage: 100 - baseOffsetPercent,
        xOffsetPercentage: baseOffsetPercent,
        zIndex: level + 1,
        layoutType: 'contained',
      },
      ...others.map((e, i) => ({
        event: e,
        widthPercentage: 100 - containedOffsetPercent,
        xOffsetPercentage: containedOffsetPercent,
        zIndex: level + 2 + i,
        layoutType: 'contained' as const,
      })),
    ];
  }

  const levelOffsetPercent = (levelOffsetPx / availableWidth) * 100;
  const availableWidthAfterOffset = availableWidth - levelOffsetPx;
  const totalGapWidth = (events.length - 1) * config.sideBySideGap;
  const widthPerEvent =
    ((availableWidthAfterOffset - totalGapWidth) / events.length / availableWidth) * 100;
  const gapPercent = (config.sideBySideGap / availableWidth) * 100;

  return sorted.map((e, i) => ({
    event: e,
    widthPercentage: widthPerEvent,
    xOffsetPercentage: levelOffsetPercent + i * (widthPerEvent + gapPercent),
    zIndex: level + 1,
    layoutType: 'side-by-side' as const,
  }));
};

const computeEnhancedOverlapLayout = (
  events: EventItemInternal[],
  config: EnhancedOverlapConfig,
  availableWidth: number,
  resourceIndex?: number
): PackedEvent[] => {
  if (events.length === 0) {
    return [];
  }

  const collisionCache = new Map<string, boolean>();

  const stackLevels = assignStackLevels(
    events,
    config.minStartDifferenceForStack,
    collisionCache
  );

  const levelGroups = new Map<number, EventItemInternal[]>();
  for (const [event, level] of stackLevels.entries()) {
    if (!levelGroups.has(level)) {
      levelGroups.set(level, []);
    }
    levelGroups.get(level)!.push(event);
  }

  const maxStackOffsetPx =
    (availableWidth * config.maxStackOffsetPercentage) / 100;
  const allLayoutResults: LayoutResult[] = [];

  for (const [level, levelEvents] of levelGroups.entries()) {
    const offsetPx = Math.min(level * config.stackOffset, maxStackOffsetPx);

    const overlappingGroups = groupOverlappingEvents(levelEvents, collisionCache);

    for (const group of overlappingGroups) {
      const results = layoutEventsInLevel(
        group,
        level,
        offsetPx,
        availableWidth,
        config
      );
      allLayoutResults.push(...results);
    }
  }

  // Post-process to check for contained relationships across levels
  const resultMap = new Map(allLayoutResults.map(r => [r.event.localId, r]));

  for (const result of allLayoutResults) {
    if (result.layoutType === 'stacked') {
      // Check if this event is contained within another event
      for (const otherResult of allLayoutResults) {
        if (result.event.localId !== otherResult.event.localId) {
          const thisEvent = result.event;
          const otherEvent = otherResult.event;

          // Check if this event is fully contained
          const isFullyContained =
            thisEvent._internal.startUnix >= otherEvent._internal.startUnix &&
            thisEvent._internal.endUnix <= otherEvent._internal.endUnix;

          if (isFullyContained) {
            const startDiff =
              Math.abs(thisEvent._internal.startUnix - otherEvent._internal.startUnix) /
              MILLISECONDS_IN_MINUTE;
            const durationDiff = Math.abs(otherEvent._internal.duration - thisEvent._internal.duration);

            // If start diff >= threshold AND duration diff > threshold → contained
            if (startDiff >= config.minStartDifferenceForStack &&
                durationDiff > config.durationDiffThreshold) {
              result.layoutType = 'contained';

              // Recalculate offset using containedOffset instead of stackOffset
              const level = stackLevels.get(result.event) ?? 0;
              const containerLevel = stackLevels.get(otherResult.event) ?? 0;

              // Calculate offset: use containedOffset for levels beyond container
              const levelsAboveContainer = level - containerLevel;
              const newOffsetPx = Math.min(
                containerLevel * config.stackOffset + levelsAboveContainer * config.containedOffset,
                maxStackOffsetPx
              );
              const newOffsetPercent = (newOffsetPx / availableWidth) * 100;

              result.xOffsetPercentage = newOffsetPercent;
              result.widthPercentage = 100 - newOffsetPercent;

              // Also mark the container event as contained
              const containerResult = resultMap.get(otherEvent.localId);
              if (containerResult && containerResult.layoutType === 'stacked') {
                containerResult.layoutType = 'contained';
              }
              break;
            }
          }
        }
      }
    }
  }

  return allLayoutResults.map((result) => {
    const stackLevel = stackLevels.get(result.event) ?? 0;
    return {
      ...result.event,
      _internal: {
        ...result.event._internal,
        resourceIndex,
        widthPercentage: result.widthPercentage,
        xOffsetPercentage: result.xOffsetPercentage,
        zIndex: result.zIndex,
        stackLevel,
        layoutType: result.layoutType,
      },
    };
  });
};

export const populateEvents = (
  events: EventItemInternal[],
  {
    overlap = false,
    minStartDifference = DEFAULT_MIN_START_DIFFERENCE,
    resources,
    overlappingConfig,
    availableWidth,
  }: {
    overlap?: boolean;
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
    availableWidth?: number;
  } = {}
): PackedEvent[] => {
  if (!events.length) {
    return [];
  }

  const useEnhancedLayout = overlappingConfig !== undefined;

  const handleEvents = (
    eventsToHandle: EventItemInternal[],
    resourceIndex?: number
  ): PackedEvent[] => {
    if (useEnhancedLayout && availableWidth) {
      const config: EnhancedOverlapConfig = {
        minStartDifferenceForStack:
          overlappingConfig.minStartDifferenceForStack ??
          minStartDifference ??
          DEFAULT_MIN_START_DIFFERENCE,
        durationDiffThreshold: overlappingConfig.durationDiffThreshold ?? 30,
        stackOffset: normalizeOffset(
          overlappingConfig.stackOffset ?? 10,
          availableWidth
        ),
        containedOffset: normalizeOffset(
          overlappingConfig.containedOffset ?? 10,
          availableWidth
        ),
        maxStackOffsetPercentage: overlappingConfig.maxStackOffsetPercentage ?? 40,
        sideBySideGap: overlappingConfig.sideBySideGap ?? 1,
      };
      return computeEnhancedOverlapLayout(
        eventsToHandle,
        config,
        availableWidth,
        resourceIndex
      );
    }

    return overlap
      ? handleOverlap(
          eventsToHandle,
          minStartDifference * MILLISECONDS_IN_MINUTE,
          resourceIndex
        )
      : handleNoOverlap(eventsToHandle, resourceIndex);
  };

  if (resources && resources.length > 0) {
    const eventsByResourceId = new Map<string, EventItemInternal[]>();
    for (const event of events) {
      const resourceId = event.resourceId || '';
      if (!eventsByResourceId.has(resourceId)) {
        eventsByResourceId.set(resourceId, []);
      }
      eventsByResourceId.get(resourceId)!.push(event);
    }

    const result: PackedEvent[] = [];
    for (let i = 0; i < resources.length; i++) {
      const resource = resources[i];
      const resourceEvents = eventsByResourceId.get(resource.id);
      if (resourceEvents && resourceEvents.length > 0) {
        result.push(...handleEvents(resourceEvents, i));
      }
    }
    return result;
  }

  return handleEvents(events);
};

interface PopulateAllDayOptions {
  startDate: number;
  endDate: number;
  timeZone: string;
  visibleDays: number[];
}
interface PopulateAllDayResult {
  packedEvents: PackedAllDayEvent[];
  maxRowCount: number;
}
export const populateAllDayEvents = (
  events: EventItemInternal[],
  options: PopulateAllDayOptions
): PopulateAllDayResult => {
  const sortedEvents = sortEvents(events);
  const rows: EventItemInternal[][] = [];
  const dateToIndexMap: Record<string, number> = {};

  options.visibleDays.forEach((dateUnix, index) => {
    dateToIndexMap[dateUnix] = index;
  });

  for (const event of sortedEvents) {
    let placed = false;
    for (const row of rows) {
      if (!row.some((e) => hasCollision(e, event))) {
        row.push(event);
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push([event]);
    }
  }

  const packedEvents: PackedAllDayEvent[] = [];
  rows.forEach((row, rowIndex) => {
    for (const event of row) {
      const eventStart = event._internal.startUnix;
      const eventEnd = event._internal.endUnix;

      // Collect the visible days the event spans
      const eventVisibleDays: number[] = [];

      for (
        let dayUnix = eventStart;
        dayUnix <= eventEnd;
        dayUnix = parseDateTime(dayUnix).plus({ days: 1 }).toMillis()
      ) {
        const dayStartUnix = parseDateTime(dayUnix).startOf('day').toMillis();
        if (
          Object.prototype.hasOwnProperty.call(dateToIndexMap, dayStartUnix)
        ) {
          eventVisibleDays.push(dayStartUnix);
        }
      }

      if (eventVisibleDays.length === 0) {
        // Event does not span any visible days, skip it
        continue;
      }

      const adjustedStartStr = eventVisibleDays[0];
      const adjustedEndStr = eventVisibleDays[eventVisibleDays.length - 1];

      const startIndex = dateToIndexMap[adjustedStartStr];
      const endIndex = dateToIndexMap[adjustedEndStr];

      const columnSpan = endIndex - startIndex + 1;

      const packedEvent: PackedAllDayEvent = {
        ...event,
        _internal: {
          ...event._internal,
          rowIndex,
          startIndex,
          columnSpan,
          totalRows: rows.length,
        },
      };
      packedEvents.push(packedEvent);
    }
  });
  const maxRowCount = rows.length;
  return { packedEvents, maxRowCount };
};
