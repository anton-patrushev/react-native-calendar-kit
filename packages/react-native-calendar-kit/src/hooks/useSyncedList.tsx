import { useCallback, useRef } from 'react';
import { MILLISECONDS_IN_DAY, ScrollType } from '../constants';
import { useActions } from '../context/ActionsProvider';
import { useCalendar } from '../context/CalendarProvider';
import {
  useDateChangedListener,
  useNotifyDateChanged,
} from '../context/VisibleDateProvider';
import { dateTimeToISOString, parseDateTime } from '../utils/dateUtils';

// Minimum gap between selection haptics during a horizontal swipe.
// Without this, a fast swipe across N day columns fires N native
// haptic calls back-to-back, contributing JS-thread work that visibly
// drops scroll FPS on Fabric. Eighty ms feels lively while keeping
// the rate under ~13/sec even at gesture-frame speed.
const HAPTIC_MIN_GAP_MS = 80;

// Settling window for onDateChanged emission. Shared by BOTH arm sites
// (column-change path and drag-end path below) on the same timer ref —
// the windows replace each other rather than stack, so retuning this
// value retunes every emission path in lockstep.
const DATE_EMISSION_DEBOUNCE_MS = 150;

const useSyncedList = ({ id }: { id: ScrollType }) => {
  const {
    visibleDateUnix,
    triggerDateChanged,
    visibleDateUnixAnim,
    visibleWeeks,
    linkedScrollGroup,
    hapticService,
  } = useCalendar();
  const currentUnix = useDateChangedListener();
  const notifyDateChanged = useNotifyDateChanged();
  const { onChange, onDateChanged } = useActions();
  const isDragging = useRef(false);
  const isPendingDateChanged = useRef<boolean>(false);

  const onScrollBeginDrag = useCallback(() => {
    isDragging.current = true;
  }, []);

  const onMomentumScrollBegin = useCallback(() => {
    if (isDragging.current) {
      isPendingDateChanged.current = true;
      isDragging.current = false;
    }
  }, []);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const lastHapticAt = useRef(0);

  // Slow-swipe emission gap: a slow drag crosses the column boundary
  // mid-gesture, so the debounce below expires while the finger is still
  // down — neither `triggerDateChanged` nor `isPendingDateChanged` is set
  // and the emission is swallowed. A zero-velocity release then produces
  // no momentum phase (or one too short to change the rounded column
  // again), so nothing ever re-arms the timer and `onDateChanged` never
  // fires for the swipe. Re-arm on drag end when the visible date has
  // diverged from the last notified one. `isDragging` is deliberately
  // left untouched: with a normal momentum release this handler is a
  // no-op gap-filler and the original begin-drag → momentum-begin flow
  // still drives the emission; a later column change clears this timer
  // and re-arms its own.
  //
  // The emission is deferred (same window, same timer ref as the main
  // debounce — never stacked) rather than fired synchronously because
  // at drag-end JS cannot yet tell whether a momentum phase will
  // follow; an immediate emit would double-fire when momentum carries
  // the scroll across another boundary. The window also lets the snap
  // settle — the timer re-reads the visible date at fire time.
  //
  // Wiring note: this handler reaches the ScrollView only because
  // CalendarBody/CalendarHeader spread `{...scrollProps}` into their
  // list views. If those call sites ever switch to explicit props,
  // `onScrollEndDrag` must be wired explicitly or this fix dies
  // silently.
  const onScrollEndDrag = useCallback(() => {
    const activeId = linkedScrollGroup.getActiveId() || ScrollType.calendarGrid;
    if (activeId !== id.toString()) {
      return;
    }

    if (visibleDateUnix.current === currentUnix) {
      return;
    }

    isPendingDateChanged.current = true;
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      const latestDate = visibleDateUnix.current;
      if (latestDate === currentUnix) {
        isPendingDateChanged.current = false;
        return;
      }
      if (isPendingDateChanged.current) {
        const dateIsoStr = dateTimeToISOString(parseDateTime(latestDate));
        triggerDateChanged.current = undefined;
        onDateChanged?.(dateIsoStr);
        notifyDateChanged(latestDate);
      }
      isPendingDateChanged.current = false;
    }, DATE_EMISSION_DEBOUNCE_MS);
  }, [
    linkedScrollGroup,
    id,
    visibleDateUnix,
    currentUnix,
    triggerDateChanged,
    onDateChanged,
    notifyDateChanged,
  ]);

  const onVisibleColumnChanged = useCallback(
    (props: {
      index: number;
      column: number;
      columns: number;
      offset: number;
      extraScrollData: Record<string, any>;
    }) => {
      const { index: pageIndex, column, columns, extraScrollData } = props;
      const { visibleColumns, visibleDates } = extraScrollData;

      const activeId =
        linkedScrollGroup.getActiveId() || ScrollType.calendarGrid;
      if (activeId === id.toString() && visibleColumns && visibleDates) {
        const dayIndex = pageIndex * columns + column;
        const visibleStart = visibleDates[pageIndex * columns];

        const visibleEnd =
          visibleDates[pageIndex * columns + column + visibleColumns];

        if (visibleStart && visibleEnd) {
          const diffDays = Math.floor(
            (visibleEnd - visibleStart) / MILLISECONDS_IN_DAY
          );
          // Skip write when structurally equal — avoids waking any
          // useAnimatedReaction consumer of visibleWeeks per scroll
          // column when the week range hasn't actually changed.
          const prev = visibleWeeks.value;
          if (diffDays <= 7) {
            if (prev.length !== 1 || prev[0] !== visibleStart) {
              visibleWeeks.value = [visibleStart];
            }
          } else {
            const nextWeekStart = visibleDates[pageIndex * columns + 7];
            if (nextWeekStart) {
              if (
                prev.length !== 2 ||
                prev[0] !== visibleStart ||
                prev[1] !== nextWeekStart
              ) {
                visibleWeeks.value = [visibleStart, nextWeekStart];
              }
            }
          }
        }

        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current);
        }

        const currentDate = visibleDates[dayIndex];
        if (!currentDate) {
          triggerDateChanged.current = undefined;
          return;
        }

        if (visibleDateUnix.current !== currentDate) {
          // Haptic is throttled — see HAPTIC_MIN_GAP_MS comment.
          const now = Date.now();
          if (now - lastHapticAt.current >= HAPTIC_MIN_GAP_MS) {
            lastHapticAt.current = now;
            hapticService.selection();
          }
          // Defer the ISO string allocation: only build it when a JS
          // consumer is actually listening on onChange. Cuts per-column
          // luxon work to zero for the common case (consumers usually
          // only listen on onDateChanged, which is debounced below).
          if (onChange) {
            onChange(dateTimeToISOString(parseDateTime(currentDate)));
          }
          visibleDateUnix.current = currentDate;
          // Direct shared-value assignment from JS thread. Reanimated
          // propagates it to UI consumers next worklet tick. Avoids the
          // closure allocation and scheduling overhead of
          // `runOnUI(() => { sv.value = x })()` per column change.
          visibleDateUnixAnim.value = currentDate;
        }

        debounceTimer.current = setTimeout(() => {
          const isSamePrevUnix = currentUnix === currentDate;
          if (isSamePrevUnix) {
            return;
          }

          if (
            (triggerDateChanged.current &&
              triggerDateChanged.current === currentDate) ||
            isPendingDateChanged.current
          ) {
            const dateIsoStr = dateTimeToISOString(parseDateTime(currentDate));
            triggerDateChanged.current = undefined;
            onDateChanged?.(dateIsoStr);
            notifyDateChanged(currentDate);
          }
          isPendingDateChanged.current = false;
        }, DATE_EMISSION_DEBOUNCE_MS);
      }
    },
    [
      linkedScrollGroup,
      id,
      visibleDateUnix,
      visibleWeeks,
      triggerDateChanged,
      onChange,
      visibleDateUnixAnim,
      currentUnix,
      onDateChanged,
      notifyDateChanged,
      hapticService,
    ]
  );

  return {
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onVisibleColumnChanged,
  };
};

export default useSyncedList;
