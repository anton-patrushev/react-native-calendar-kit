import type { FC } from 'react';
import React, { useCallback, useMemo } from 'react';
import { Platform, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { useActions } from '../context/ActionsProvider';
import { useBody } from '../context/BodyContext';
import {
  useDragEvent,
  useDragEventActions,
} from '../context/DragEventProvider';
import { useRegularEvents } from '../context/EventsProvider';
import { useTimezone } from '../context/TimeZoneProvider';
import type { PackedEvent, ResourceItem } from '../types';
import { forceUpdateZone, parseDateTime } from '../utils/dateUtils';
import EventItem from './EventItem';

const Events: FC<{
  startUnix: number;
  visibleDates: Record<string, { diffDays: number; unix: number }>;
  resources?: ResourceItem[];
}> = ({ startUnix, visibleDates, resources }) => {
  const totalResources = resources?.length;
  const { renderEvent, numberOfDays, columnWidth, enableResourceScroll } =
    useBody();
  const { onPressEvent, onLongPressEvent } = useActions();
  const { draggingId, selectedEventId } = useDragEvent();
  const { timeZone } = useTimezone();
  const { triggerDragEvent } = useDragEventActions();

  const resourcesIds = useMemo(() => {
    return resources?.map((resource) => resource.id);
  }, [resources]);

  const { data: eventsByDate } = useRegularEvents(
    startUnix,
    numberOfDays,
    visibleDates
  );

  const events = useMemo(() => {
    if (!enableResourceScroll) {
      return eventsByDate;
    }

    return eventsByDate.filter(
      (event) => event.resourceId && resourcesIds?.includes(event.resourceId)
    );
  }, [enableResourceScroll, eventsByDate, resourcesIds]);

  const _triggerDragEvent = useCallback(
    (event: PackedEvent, resEvent: GestureResponderEvent) => {
      if (!event.start.dateTime || !event.end.dateTime) {
        return;
      }
      if (event.draggable === false) {
        return;
      }

      // Fix: Use parseDateTime().setZone() instead of forceUpdateZone() for proper timezone handling
      // forceUpdateZone uses keepLocalTime: true which corrupts timestamps when device timezone
      // differs from business timezone, causing drag to fail for events near midnight
      const eventStart = parseDateTime(event._internal.startUnix)
        .setZone(timeZone)
        .startOf('day');
      const originalStart = parseDateTime(event.start.dateTime, { zone: event.start.timeZone })
        .setZone(timeZone)
        .startOf('day');
      const startIndex = eventStart.diff(originalStart, 'days').days;
      triggerDragEvent!(
        {
          start: {
            dateTime: event.start.dateTime,
            timeZone: event.start.timeZone,
          },
          end: {
            dateTime: event.end.dateTime,
            timeZone: event.end.timeZone,
          },
          startIndex,
          dragX:
            event._internal.resourceIndex && totalResources
              ? event._internal.resourceIndex * (columnWidth / totalResources) +
                resEvent.nativeEvent.locationX
              : undefined,
        },
        event
      );
    },
    [timeZone, triggerDragEvent, columnWidth, totalResources]
  );

  const _onLongPressEvent = useCallback(
    (event: PackedEvent) => {
      const clonedEvent = { ...event, _internal: undefined };
      delete clonedEvent._internal;
      onLongPressEvent?.(clonedEvent);
    },
    [onLongPressEvent]
  );

  if (events.length === 0) {
    return null;
  }

  const _renderEvent = (event: PackedEvent) => {
    return (
      <EventItem
        // Android-only: include packed layout state (zIndex, xOffset) in the key
        // so the View remounts when overlap topology changes. Works around an
        // Android paint-state bug where the native View doesn't repaint after a
        // sibling is removed (e.g. delete a block that contained an appointment
        // — the appointment was rendered as 'contained' with zIndex 2 / offset
        // 10%, becomes solo at zIndex 1 / offset 0; React updates the style but
        // Android keeps the old paint, leaving the View tappable but invisible).
        // iOS handles this correctly via CALayer, so we keep its stable key to
        // avoid unnecessary unmount/remount cost.
        key={
          Platform.OS === 'android'
            ? `${event.localId}-z${event._internal.zIndex}-x${event._internal.xOffsetPercentage}`
            : event.localId
        }
        event={event}
        startUnix={startUnix}
        renderEvent={renderEvent}
        onPressEvent={onPressEvent}
        onLongPressEvent={
          triggerDragEvent
            ? _triggerDragEvent
            : onLongPressEvent
              ? _onLongPressEvent
              : undefined
        }
        isDragging={
          draggingId === event.localId || selectedEventId === event.localId
        }
        visibleDates={visibleDates}
        totalResources={totalResources}
      />
    );
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {events.map(_renderEvent)}
    </View>
  );
};

export default Events;
