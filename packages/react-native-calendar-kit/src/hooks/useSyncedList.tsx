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
  // Last dayIndex we actually processed. onVisibleColumnChanged fires once per
  // column (~7×/page on a week swipe) but the derived dayIndex only advances
  // when the leading visible column crosses a day boundary. When it hasn't
  // moved, every downstream step is a no-op repeat (same visibleWeeks, same
  // visibleDateUnix, same debounce target) — so we bail before any
  // clearTimeout/setTimeout or shared-value write churn.
  const lastDayIndex = useRef<number | null>(null);

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
        // Early bail on redundant no-op columns: when the leading column
        // hasn't crossed a day boundary, dayIndex is unchanged and every
        // derived value below (visibleWeeks, visibleDateUnix, debounce target)
        // would be identical to last time. Skipping here avoids the per-column
        // clearTimeout/setTimeout reset and the visibleDateUnixAnim write.
        // Placed after the active-id gate so the gate semantics are intact.
        if (lastDayIndex.current === dayIndex) {
          return;
        }
        lastDayIndex.current = dayIndex;
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
        }, 150);
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
    onMomentumScrollBegin,
    onVisibleColumnChanged,
  };
};

export default useSyncedList;
