import {
  eventItemPropsAreEqual,
  type EventItemEqualProps,
} from '../components/eventItemEqual';
import type { PackedEvent } from '../types';

const makeEvent = (
  overrides: Partial<PackedEvent> = {},
  internalOverrides: Partial<PackedEvent['_internal']> = {}
): PackedEvent =>
  ({
    id: 'e1',
    localId: 'e1',
    title: 'Title',
    color: '#fff',
    titleColor: '#000',
    draggable: true,
    start: { dateTime: '2024-05-01T09:00:00.000Z' },
    end: { dateTime: '2024-05-01T10:00:00.000Z' },
    ...overrides,
    _internal: {
      startUnix: 1714553940000,
      endUnix: 1714557540000,
      duration: 60,
      startMinutes: 540,
      resourceIndex: 0,
      total: 1,
      index: 0,
      columnSpan: 1,
      widthPercentage: 100,
      xOffsetPercentage: 0,
      zIndex: 1,
      stackLevel: 0,
      ...internalOverrides,
    },
  }) as PackedEvent;

const makeProps = (
  overrides: Partial<EventItemEqualProps> = {}
): EventItemEqualProps => {
  const visibleDates = {
    '1714521600000': { diffDays: 0, unix: 1714521600000 },
  };
  return {
    event: makeEvent(),
    startUnix: 1714521600000,
    renderEvent: undefined,
    onPressEvent: undefined,
    onLongPressEvent: undefined,
    isDragging: false,
    visibleDates,
    totalResources: undefined,
    ...overrides,
  };
};

describe('eventItemPropsAreEqual', () => {
  it('returns true when the event object is the same reference', () => {
    const event = makeEvent();
    const visibleDates = makeProps().visibleDates;
    const prev = makeProps({ event, visibleDates });
    const next = makeProps({ event, visibleDates });
    expect(eventItemPropsAreEqual(prev, next)).toBe(true);
  });

  it('returns true for distinct but field-identical events', () => {
    const visibleDates = makeProps().visibleDates;
    const prev = makeProps({ event: makeEvent(), visibleDates });
    const next = makeProps({ event: makeEvent(), visibleDates });
    // Different object references, identical fields.
    expect(prev.event).not.toBe(next.event);
    expect(eventItemPropsAreEqual(prev, next)).toBe(true);
  });

  describe('appearance scalars invalidate', () => {
    it.each([
      ['title', { title: 'Changed' }],
      ['color', { color: '#000' }],
      ['titleColor', { titleColor: '#fff' }],
      ['draggable', { draggable: false }],
      ['localId', { localId: 'e2' }],
    ])('invalidates when %s changes', (_name, override) => {
      const visibleDates = makeProps().visibleDates;
      const prev = makeProps({ event: makeEvent(), visibleDates });
      const next = makeProps({ event: makeEvent(override), visibleDates });
      expect(eventItemPropsAreEqual(prev, next)).toBe(false);
    });
  });

  describe('layout _internal fields invalidate', () => {
    it.each([
      ['startUnix', { startUnix: 1714640400000 }],
      ['duration', { duration: 90 }],
      ['startMinutes', { startMinutes: 600 }],
      ['resourceIndex', { resourceIndex: 2 }],
      ['total', { total: 3 }],
      ['index', { index: 1 }],
      ['columnSpan', { columnSpan: 2 }],
      ['widthPercentage', { widthPercentage: 50 }],
      ['xOffsetPercentage', { xOffsetPercentage: 25 }],
      ['zIndex', { zIndex: 5 }],
      ['stackLevel', { stackLevel: 1 }],
    ])('invalidates when _internal.%s changes', (_name, internalOverride) => {
      const visibleDates = makeProps().visibleDates;
      const prev = makeProps({ event: makeEvent({}, {}), visibleDates });
      const next = makeProps({
        event: makeEvent({}, internalOverride),
        visibleDates,
      });
      expect(eventItemPropsAreEqual(prev, next)).toBe(false);
    });
  });

  describe('scalar / reference props invalidate', () => {
    it('invalidates when startUnix changes', () => {
      const event = makeEvent();
      const visibleDates = makeProps().visibleDates;
      expect(
        eventItemPropsAreEqual(
          makeProps({ event, visibleDates, startUnix: 1 }),
          makeProps({ event, visibleDates, startUnix: 2 })
        )
      ).toBe(false);
    });

    it('invalidates when isDragging toggles', () => {
      const event = makeEvent();
      const visibleDates = makeProps().visibleDates;
      expect(
        eventItemPropsAreEqual(
          makeProps({ event, visibleDates, isDragging: false }),
          makeProps({ event, visibleDates, isDragging: true })
        )
      ).toBe(false);
    });

    it('invalidates when totalResources changes', () => {
      const event = makeEvent();
      const visibleDates = makeProps().visibleDates;
      expect(
        eventItemPropsAreEqual(
          makeProps({ event, visibleDates, totalResources: 1 }),
          makeProps({ event, visibleDates, totalResources: 2 })
        )
      ).toBe(false);
    });

    it('invalidates when a callback reference changes', () => {
      const event = makeEvent();
      const visibleDates = makeProps().visibleDates;
      expect(
        eventItemPropsAreEqual(
          makeProps({ event, visibleDates, onPressEvent: () => {} }),
          makeProps({ event, visibleDates, onPressEvent: () => {} })
        )
      ).toBe(false);
    });

    it('invalidates when renderEvent reference changes', () => {
      const event = makeEvent();
      const visibleDates = makeProps().visibleDates;
      expect(
        eventItemPropsAreEqual(
          makeProps({ event, visibleDates, renderEvent: () => null }),
          makeProps({ event, visibleDates, renderEvent: () => null })
        )
      ).toBe(false);
    });

    it('invalidates when visibleDates reference changes', () => {
      const event = makeEvent();
      expect(
        eventItemPropsAreEqual(
          makeProps({ event, visibleDates: { a: { diffDays: 0, unix: 1 } } }),
          makeProps({ event, visibleDates: { a: { diffDays: 0, unix: 1 } } })
        )
      ).toBe(false);
    });

    it('stays equal when visibleDates is the same reference', () => {
      const event = makeEvent();
      const visibleDates = { a: { diffDays: 0, unix: 1 } };
      expect(
        eventItemPropsAreEqual(
          makeProps({ event, visibleDates }),
          makeProps({ event, visibleDates })
        )
      ).toBe(true);
    });
  });

  describe('default render path: fields outside the compared set', () => {
    it('stays equal when an uncompared field changes (no renderEvent)', () => {
      // A custom renderer would read this; the DEFAULT render does not, so the
      // memo intentionally skips re-rendering. Documents the default-path
      // contract: only the fixed appearance/layout set is compared.
      const visibleDates = makeProps().visibleDates;
      const prev = makeProps({
        event: makeEvent({ textColor: '#111' } as Partial<PackedEvent>),
        visibleDates,
      });
      const next = makeProps({
        event: makeEvent({ textColor: '#999' } as Partial<PackedEvent>),
        visibleDates,
      });
      expect(eventItemPropsAreEqual(prev, next)).toBe(true);
    });

    it('still invalidates when a compared appearance field changes', () => {
      const visibleDates = makeProps().visibleDates;
      const prev = makeProps({
        event: makeEvent({ title: 'A' }),
        visibleDates,
      });
      const next = makeProps({
        event: makeEvent({ title: 'B' }),
        visibleDates,
      });
      expect(eventItemPropsAreEqual(prev, next)).toBe(false);
    });
  });

  describe('custom render path: deep compare', () => {
    const renderEvent = () => null;

    it('stays equal when the event ref is identical (fast path)', () => {
      const event = makeEvent();
      const visibleDates = makeProps().visibleDates;
      expect(
        eventItemPropsAreEqual(
          makeProps({ event, visibleDates, renderEvent }),
          makeProps({ event, visibleDates, renderEvent })
        )
      ).toBe(true);
    });

    it('stays equal for distinct but deep-equal events', () => {
      const visibleDates = makeProps().visibleDates;
      const prev = makeProps({ event: makeEvent(), visibleDates, renderEvent });
      const next = makeProps({ event: makeEvent(), visibleDates, renderEvent });
      expect(prev.event).not.toBe(next.event);
      expect(eventItemPropsAreEqual(prev, next)).toBe(true);
    });

    it('invalidates when an ARBITRARY uncompared field changes', () => {
      // `textColor` is not in the default-path compared set, but a custom
      // renderer reads it — so with renderEvent present it MUST invalidate.
      const visibleDates = makeProps().visibleDates;
      const prev = makeProps({
        event: makeEvent({ textColor: '#111' } as Partial<PackedEvent>),
        visibleDates,
        renderEvent,
      });
      const next = makeProps({
        event: makeEvent({ textColor: '#999' } as Partial<PackedEvent>),
        visibleDates,
        renderEvent,
      });
      expect(eventItemPropsAreEqual(prev, next)).toBe(false);
    });

    it('invalidates when a deeply-nested field changes', () => {
      const visibleDates = makeProps().visibleDates;
      const prev = makeProps({
        event: makeEvent({
          timeSegments: { processing: true, trailing: false },
        } as Partial<PackedEvent>),
        visibleDates,
        renderEvent,
      });
      const next = makeProps({
        event: makeEvent({
          timeSegments: { processing: false, trailing: false },
        } as Partial<PackedEvent>),
        visibleDates,
        renderEvent,
      });
      expect(eventItemPropsAreEqual(prev, next)).toBe(false);
    });
  });
});
