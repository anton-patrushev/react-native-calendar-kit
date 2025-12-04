import { MILLISECONDS_IN_MINUTE } from '../constants';
import type { EventItemInternal } from '../types';
import { populateEvents } from '../utils/eventUtils';

const createTestEvent = (
  id: string,
  startMinutes: number,
  durationMinutes: number,
  resourceId?: string
): EventItemInternal => {
  const startUnix = startMinutes * MILLISECONDS_IN_MINUTE;
  const endUnix = (startMinutes + durationMinutes) * MILLISECONDS_IN_MINUTE;

  return {
    id,
    localId: id,
    start: { dateTime: new Date(startUnix).toISOString() },
    end: { dateTime: new Date(endUnix).toISOString() },
    resourceId,
    _internal: {
      startUnix,
      endUnix,
      duration: durationMinutes,
    },
  };
};

describe('Enhanced Overlap Layout', () => {
  describe('Stacked Layout (events with >= 30 min start difference)', () => {
    it('displays two events stacked with progressive offset', () => {
      const events = [
        createTestEvent('1', 0, 60), // 00:00 - 01:00
        createTestEvent('2', 30, 60), // 00:30 - 01:30
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          stackOffset: 10,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(2);

      const event1 = result.find((e) => e.id === '1')!;
      const event2 = result.find((e) => e.id === '2')!;

      expect(event1._internal.stackLevel).toBe(0);
      expect(event1._internal.xOffsetPercentage).toBe(0);
      expect(event1._internal.widthPercentage).toBe(100);
      expect(event1._internal.zIndex).toBe(1);
      expect(event1._internal.layoutType).toBe('stacked');

      expect(event2._internal.stackLevel).toBe(1);
      expect(event2._internal.xOffsetPercentage).toBe(10);
      expect(event2._internal.widthPercentage).toBe(90); // 100 - 10% offset
      expect(event2._internal.zIndex).toBe(2);
      expect(event2._internal.layoutType).toBe('stacked');
    });

    it('displays three cascading events with progressive offset', () => {
      const events = [
        createTestEvent('1', 0, 90), // 00:00 - 01:30 (overlaps with all)
        createTestEvent('2', 30, 90), // 00:30 - 02:00 (overlaps with all)
        createTestEvent('3', 60, 60), // 01:00 - 02:00 (overlaps with event 2)
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          stackOffset: 10,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(3);

      const event1 = result.find((e) => e.id === '1')!;
      const event2 = result.find((e) => e.id === '2')!;
      const event3 = result.find((e) => e.id === '3')!;

      expect(event1._internal.stackLevel).toBe(0);
      expect(event1._internal.zIndex).toBe(1);

      expect(event2._internal.stackLevel).toBe(1);
      expect(event2._internal.zIndex).toBe(2);

      expect(event3._internal.stackLevel).toBe(2);
      expect(event3._internal.zIndex).toBe(3);
      expect(event3._internal.xOffsetPercentage).toBe(20); // 10px * 2 levels
    });
  });

  describe('Side-by-Side Layout (events with same start time)', () => {
    it('displays two events side-by-side with equal width', () => {
      const events = [
        createTestEvent('1', 0, 60), // 00:00 - 01:00
        createTestEvent('2', 0, 60), // 00:00 - 01:00
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          sideBySideGap: 1,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(2);

      const event1 = result.find((e) => e.id === '1')!;
      const event2 = result.find((e) => e.id === '2')!;

      expect(event1._internal.stackLevel).toBe(0);
      expect(event1._internal.zIndex).toBe(1);
      expect(event1._internal.layoutType).toBe('side-by-side');
      expect(event1._internal.widthPercentage).toBeCloseTo(49.5, 1);

      expect(event2._internal.stackLevel).toBe(0);
      expect(event2._internal.zIndex).toBe(1);
      expect(event2._internal.layoutType).toBe('side-by-side');
      expect(event2._internal.widthPercentage).toBeCloseTo(49.5, 1);
    });

    it('displays five events side-by-side with equal width', () => {
      const events = [
        createTestEvent('1', 0, 60),
        createTestEvent('2', 0, 60),
        createTestEvent('3', 0, 60),
        createTestEvent('4', 0, 60),
        createTestEvent('5', 0, 60),
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          sideBySideGap: 1,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(5);

      result.forEach((event) => {
        expect(event._internal.layoutType).toBe('side-by-side');
        expect(event._internal.zIndex).toBe(1);
        expect(event._internal.widthPercentage).toBeCloseTo(19.2, 1);
      });
    });
  });

  describe('Contained/Overlay Layout', () => {
    it('displays short event overlaid on long event', () => {
      const events = [
        createTestEvent('long', 0, 240), // 00:00 - 04:00
        createTestEvent('short', 30, 60), // 00:30 - 01:30 (starts 30+ min after for contained check)
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          durationDiffThreshold: 30, // Duration diff: 240-60=180 > 30 → contained
          stackOffset: 10,
          containedOffset: 10,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(2);

      const longEvent = result.find((e) => e.id === 'long')!;
      const shortEvent = result.find((e) => e.id === 'short')!;

      expect(longEvent._internal.layoutType).toBe('contained');
      expect(longEvent._internal.widthPercentage).toBe(100);
      expect(longEvent._internal.xOffsetPercentage).toBe(0);
      expect(longEvent._internal.zIndex).toBe(1);

      expect(shortEvent._internal.layoutType).toBe('contained');
      expect(shortEvent._internal.widthPercentage).toBe(90); // 100 - 10% offset
      expect(shortEvent._internal.xOffsetPercentage).toBe(10);
      expect(shortEvent._internal.zIndex).toBe(2);
    });

    it('uses containedOffset for contained events on different levels', () => {
      const events = [
        createTestEvent('long', 0, 240), // 00:00 - 04:00
        createTestEvent('short', 30, 60), // 00:30 - 01:30
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          durationDiffThreshold: 30, // Duration diff: 240-60=180 > 30 → contained
          stackOffset: 5,
          containedOffset: 20, // Different offset for contained layouts
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(2);

      const longEvent = result.find((e) => e.id === 'long')!;
      const shortEvent = result.find((e) => e.id === 'short')!;

      // Both should be marked as contained
      expect(longEvent._internal.layoutType).toBe('contained');
      expect(shortEvent._internal.layoutType).toBe('contained');

      // Long event is at level 0, should have no offset
      expect(longEvent._internal.stackLevel).toBe(0);
      expect(longEvent._internal.xOffsetPercentage).toBe(0);

      // Short event is at level 1 (starts 30min after)
      // Since it's contained, offset should use containedOffset (20), not stackOffset (5)
      expect(shortEvent._internal.stackLevel).toBe(1);
      expect(shortEvent._internal.xOffsetPercentage).toBe(20); // containedOffset
      expect(shortEvent._internal.widthPercentage).toBe(80); // 100 - 20
    });

    it('does not use contained layout when duration difference is insufficient', () => {
      const events = [
        createTestEvent('1', 0, 90), // Duration diff: 90-60=30 <= 30 → not contained
        createTestEvent('2', 0, 60),
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          durationDiffThreshold: 30,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(2);

      result.forEach((event) => {
        expect(event._internal.layoutType).toBe('side-by-side');
      });
    });

    it('uses stacked layout when start time diff is sufficient but duration diff is within threshold', () => {
      const events = [
        createTestEvent('1', 0, 90), // 00:00 - 01:30
        createTestEvent('2', 30, 60), // 00:30 - 01:30 (duration diff: 90-60=30 <= 30)
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          durationDiffThreshold: 30,
          stackOffset: 10,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(2);

      const event1 = result.find((e) => e.id === '1')!;
      const event2 = result.find((e) => e.id === '2')!;

      expect(event1._internal.layoutType).toBe('stacked');
      expect(event2._internal.layoutType).toBe('stacked');
      expect(event2._internal.stackLevel).toBe(1);
    });

    it('uses side-by-side layout when start time diff is less than threshold', () => {
      const events = [
        createTestEvent('1', 0, 330), // 00:00 - 05:30 (10am-3:30pm example)
        createTestEvent('2', 0, 60), // 00:00 - 01:00 (10am-11am example)
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          durationDiffThreshold: 30,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(2);

      const event1 = result.find((e) => e.id === '1')!;
      const event2 = result.find((e) => e.id === '2')!;

      // Both events start at same time (0), so startTimeDiff = 0 < 30 → side-by-side
      expect(event1._internal.layoutType).toBe('side-by-side');
      expect(event2._internal.layoutType).toBe('side-by-side');
    });
  });

  describe('Combined: Stacked + Side-by-Side', () => {
    it('displays base event stacked with two side-by-side events on top', () => {
      const events = [
        createTestEvent('base', 0, 60), // 00:00 - 01:00
        createTestEvent('top1', 30, 30), // 00:30 - 01:00
        createTestEvent('top2', 30, 30), // 00:30 - 01:00
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          stackOffset: 10,
          sideBySideGap: 1,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(3);

      const baseEvent = result.find((e) => e.id === 'base')!;
      const top1 = result.find((e) => e.id === 'top1')!;
      const top2 = result.find((e) => e.id === 'top2')!;

      expect(baseEvent._internal.stackLevel).toBe(0);
      expect(baseEvent._internal.zIndex).toBe(1);
      expect(baseEvent._internal.widthPercentage).toBe(100);

      expect(top1._internal.stackLevel).toBe(1);
      expect(top1._internal.zIndex).toBe(2);
      expect(top1._internal.layoutType).toBe('side-by-side');

      expect(top2._internal.stackLevel).toBe(1);
      expect(top2._internal.zIndex).toBe(2);
      expect(top2._internal.layoutType).toBe('side-by-side');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty event array', () => {
      const result = populateEvents([], {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(0);
    });

    it('handles single event', () => {
      const events = [createTestEvent('1', 0, 60)];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(1);
      expect(result[0]._internal.widthPercentage).toBe(100);
      expect(result[0]._internal.xOffsetPercentage).toBe(0);
      expect(result[0]._internal.zIndex).toBe(1);
    });

    it('respects maxStackOffsetPercentage', () => {
      const events = [
        createTestEvent('1', 0, 180), // All overlap to create cascade
        createTestEvent('2', 30, 150),
        createTestEvent('3', 60, 120),
        createTestEvent('4', 90, 90),
        createTestEvent('5', 120, 60),
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          stackOffset: 10,
          maxStackOffsetPercentage: 30,
        },
        availableWidth: 100,
      });

      const event5 = result.find((e) => e.id === '5')!;
      expect(event5._internal.xOffsetPercentage).toBeLessThanOrEqual(30);
    });

    it('handles events at threshold boundary', () => {
      const events = [
        createTestEvent('1', 0, 60),
        createTestEvent('2', 30, 60), // Exactly 30 minutes difference
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(2);

      const event1 = result.find((e) => e.id === '1')!;
      const event2 = result.find((e) => e.id === '2')!;

      expect(event1._internal.stackLevel).toBe(0);
      expect(event2._internal.stackLevel).toBe(1);
    });
  });

  describe('Resource Mode', () => {
    it('handles events with different resources separately', () => {
      const events = [
        createTestEvent('1', 0, 60, 'resource-1'),
        createTestEvent('2', 0, 60, 'resource-1'),
        createTestEvent('3', 0, 60, 'resource-2'),
        createTestEvent('4', 0, 60, 'resource-2'),
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          sideBySideGap: 1,
        },
        availableWidth: 100,
        resources: [
          { id: 'resource-1', title: 'Resource 1' },
          { id: 'resource-2', title: 'Resource 2' },
        ],
      });

      expect(result).toHaveLength(4);

      const resource1Events = result.filter(
        (e) => e.resourceId === 'resource-1'
      );
      const resource2Events = result.filter(
        (e) => e.resourceId === 'resource-2'
      );

      expect(resource1Events).toHaveLength(2);
      expect(resource2Events).toHaveLength(2);

      resource1Events.forEach((event) => {
        expect(event._internal.resourceIndex).toBe(0);
      });

      resource2Events.forEach((event) => {
        expect(event._internal.resourceIndex).toBe(1);
      });
    });
  });

  describe('Backward Compatibility', () => {
    it('uses legacy overlap mode when enhanced config not provided', () => {
      const events = [createTestEvent('1', 0, 60), createTestEvent('2', 0, 60)];

      const result = populateEvents(events, {
        overlap: false,
      });

      expect(result).toHaveLength(2);
      expect(result[0]._internal.zIndex).toBeUndefined();
      expect(result[0]._internal.layoutType).toBeUndefined();
    });

    it('uses minStartDifference as fallback for minStartDifferenceForStack', () => {
      const events = [
        createTestEvent('1', 0, 60),
        createTestEvent('2', 30, 60),
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          stackOffset: 10, // Trigger enhanced layout
        },
        minStartDifference: 30,
        availableWidth: 100,
      });

      expect(result).toHaveLength(2);

      const event1 = result.find((e) => e.id === '1');
      const event2 = result.find((e) => e.id === '2');

      expect(event1?._internal.stackLevel).toBe(0);
      expect(event2?._internal.stackLevel).toBe(1);
      expect(event2?._internal.layoutType).toBe('stacked');
    });
  });

  describe('Transitive Overlap - Boundary Touch', () => {
    it('stacks three events where event3 touches event1 at boundary', () => {
      // User scenario:
      // event1: 8am-9am (480-540)
      // event2: 8:30am-9:30am (510-570) - overlaps event1
      // event3: 9am-10am (540-600) - touches event1 at boundary, overlaps event2
      // All 3 should be stacked

      const events = [
        createTestEvent('1', 480, 60), // 8:00 - 9:00
        createTestEvent('2', 510, 60), // 8:30 - 9:30
        createTestEvent('3', 540, 60), // 9:00 - 10:00
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          stackOffset: 10,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(3);

      const event1 = result.find((e) => e.id === '1')!;
      const event2 = result.find((e) => e.id === '2')!;
      const event3 = result.find((e) => e.id === '3')!;

      // All three should be at different levels (stacked)
      expect(event1._internal.stackLevel).toBe(0);
      expect(event2._internal.stackLevel).toBe(1);
      expect(event3._internal.stackLevel).toBe(2);

      // Each should have progressively higher z-index
      expect(event1._internal.zIndex).toBe(1);
      expect(event2._internal.zIndex).toBe(2);
      expect(event3._internal.zIndex).toBe(3);

      // Each should have progressive offset
      expect(event1._internal.xOffsetPercentage).toBe(0);
      expect(event2._internal.xOffsetPercentage).toBe(10);
      expect(event3._internal.xOffsetPercentage).toBe(20);
    });
  });

  describe('Real World Scenario - 5 Events Analysis', () => {
    it('analyzes overlap behavior for 5 real events', () => {
      // Event 1: 07:00 - 08:00 (Hank Zakroff)
      // Event 2: 07:30 - 08:30 (John Appleseed) - overlaps with Event 1
      // Event 3: 08:00 - 09:00 (David Taylor) - overlaps with Event 2, touches Event 1 at boundary
      // Event 4: 12:00 - 13:00 (James Hurt) - no overlap with anything
      // Event 5: 13:55 - 14:55 (John Appleseed) - no overlap with anything

      const events = [
        createTestEvent('1', 420, 60), // 07:00 - 08:00
        createTestEvent('2', 450, 60), // 07:30 - 08:30
        createTestEvent('3', 480, 60), // 08:00 - 09:00
        createTestEvent('4', 720, 60), // 12:00 - 13:00
        createTestEvent('5', 835, 60), // 13:55 - 14:55
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          stackOffset: 10,
          sideBySideGap: 1,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(5);

      const event1 = result.find((e) => e.id === '1')!;
      const event2 = result.find((e) => e.id === '2')!;
      const event3 = result.find((e) => e.id === '3')!;
      const event4 = result.find((e) => e.id === '4')!;
      const event5 = result.find((e) => e.id === '5')!;

      console.log('\n=== Event Analysis ===');
      console.log('Event 1 (07:00-08:00):', {
        stackLevel: event1._internal.stackLevel,
        layoutType: event1._internal.layoutType,
        zIndex: event1._internal.zIndex,
        widthPercentage: event1._internal.widthPercentage,
        xOffsetPercentage: event1._internal.xOffsetPercentage,
      });
      console.log('Event 2 (07:30-08:30):', {
        stackLevel: event2._internal.stackLevel,
        layoutType: event2._internal.layoutType,
        zIndex: event2._internal.zIndex,
        widthPercentage: event2._internal.widthPercentage,
        xOffsetPercentage: event2._internal.xOffsetPercentage,
      });
      console.log('Event 3 (08:00-09:00):', {
        stackLevel: event3._internal.stackLevel,
        layoutType: event3._internal.layoutType,
        zIndex: event3._internal.zIndex,
        widthPercentage: event3._internal.widthPercentage,
        xOffsetPercentage: event3._internal.xOffsetPercentage,
      });
      console.log('Event 4 (12:00-13:00):', {
        stackLevel: event4._internal.stackLevel,
        layoutType: event4._internal.layoutType,
        zIndex: event4._internal.zIndex,
        widthPercentage: event4._internal.widthPercentage,
        xOffsetPercentage: event4._internal.xOffsetPercentage,
      });
      console.log('Event 5 (13:55-14:55):', {
        stackLevel: event5._internal.stackLevel,
        layoutType: event5._internal.layoutType,
        zIndex: event5._internal.zIndex,
        widthPercentage: event5._internal.widthPercentage,
        xOffsetPercentage: event5._internal.xOffsetPercentage,
      });

      // Just verify they all got processed
      expect(event1).toBeDefined();
      expect(event2).toBeDefined();
      expect(event3).toBeDefined();
      expect(event4).toBeDefined();
      expect(event5).toBeDefined();
    });

    it('distinguishes between side-by-side and stacked+side-by-side', () => {
      // Event 1: Base event at level 0
      // Event 2: Overlaps with Event 1, different start time -> stacked (level 1)
      // Event 3 & 4: Same time as Event 2, overlap with Event 1 -> side-by-side at level 1

      const events = [
        createTestEvent('1', 0, 90), // 00:00 - 01:30
        createTestEvent('2', 30, 60), // 00:30 - 01:30
        createTestEvent('3', 30, 60), // 00:30 - 01:30 (same as 2)
        createTestEvent('4', 30, 60), // 00:30 - 01:30 (same as 2)
      ];

      const result = populateEvents(events, {
        overlappingConfig: {
          minStartDifferenceForStack: 30,
          stackOffset: 10,
          sideBySideGap: 1,
        },
        availableWidth: 100,
      });

      expect(result).toHaveLength(4);

      const event1 = result.find((e) => e.id === '1')!;
      const event2 = result.find((e) => e.id === '2')!;
      const event3 = result.find((e) => e.id === '3')!;
      const event4 = result.find((e) => e.id === '4')!;

      // Event 1: Base event
      expect(event1._internal.stackLevel).toBe(0);
      expect(event1._internal.xOffsetPercentage).toBe(0);
      expect(event1._internal.layoutType).toBe('stacked');

      // Events 2, 3, 4: Side-by-side with each other, but stacked on Event 1
      expect(event2._internal.stackLevel).toBe(1);
      expect(event2._internal.layoutType).toBe('side-by-side');
      expect(event2._internal.xOffsetPercentage).toBeGreaterThan(0);

      expect(event3._internal.stackLevel).toBe(1);
      expect(event3._internal.layoutType).toBe('side-by-side');
      expect(event3._internal.xOffsetPercentage).toBeGreaterThan(0);

      expect(event4._internal.stackLevel).toBe(1);
      expect(event4._internal.layoutType).toBe('side-by-side');
      expect(event4._internal.xOffsetPercentage).toBeGreaterThan(0);
    });
  });
});
