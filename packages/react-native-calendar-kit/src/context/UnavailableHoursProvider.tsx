import type { FC, PropsWithChildren } from 'react';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
} from 'react';
import useLazyRef from '../hooks/useLazyRef';
import { useSyncExternalStoreWithSelector } from '../hooks/useSyncExternalStoreWithSelector';
import type { Store } from '../storeBuilder';
import { createStore } from '../storeBuilder';
import type { UnavailableHourProps } from '../types';
import { parseDateTime } from '../utils/dateUtils';
import { useDateChangedListener } from './VisibleDateProvider';

type UnavailableHoursStore = {
  unavailableHours?: Record<string, UnavailableHourProps[]>;
};

export const UnavailableHoursContext = createContext<
  Store<UnavailableHoursStore> | undefined
>(undefined);

/**
 * Merges unavailable hours from specific date and weekday sources.
 * Specific date hours take precedence over weekday hours per resource.
 */
const mergeUnavailableHours = (
  specificDateHours: UnavailableHourProps[],
  weekdayHours: UnavailableHourProps[]
): UnavailableHourProps[] => {
  if (!specificDateHours.length) {
    return weekdayHours;
  }
  if (!weekdayHours.length) {
    return specificDateHours;
  }

  const merged: UnavailableHourProps[] = [];

  // Get all unique resource IDs from both sources
  const allResourceIds = new Set<string>();

  [...specificDateHours, ...weekdayHours].forEach((hour) => {
    if (hour.resourceId) {
      allResourceIds.add(hour.resourceId);
    }
  });

  // For each resource, specific date takes precedence over weekday
  allResourceIds.forEach((resourceId) => {
    const specificForResource = specificDateHours.filter(
      (h) => h.resourceId === resourceId
    );

    if (specificForResource.length > 0) {
      merged.push(...specificForResource);
    } else {
      const weekdayForResource = weekdayHours.filter(
        (h) => h.resourceId === resourceId
      );
      merged.push(...weekdayForResource);
    }
  });

  // Handle global hours (no resourceId): specific date takes precedence
  const specificGlobal = specificDateHours.filter((h) => !h.resourceId);
  const weekdayGlobal = weekdayHours.filter((h) => !h.resourceId);

  merged.push(...(specificGlobal.length > 0 ? specificGlobal : weekdayGlobal));

  return merged;
};

const UnavailableHoursProvider: FC<
  PropsWithChildren<{
    unavailableHours?:
      | Record<string, UnavailableHourProps[]>
      | UnavailableHourProps[];
    timeZone: string;
    pagesPerSide: number;
  }>
> = ({ children, unavailableHours = {}, timeZone, pagesPerSide }) => {
  const unavailableHoursStore = useLazyRef(() =>
    createStore<UnavailableHoursStore>({
      unavailableHours: {},
    })
  ).current;
  const currentDate = useDateChangedListener();

  const notifyDataChanged = useCallback(
    (date: number, offset: number = 7) => {
      const originalData: Record<string, UnavailableHourProps[]> =
        Array.isArray(unavailableHours)
          ? {
              '1': unavailableHours,
              '2': unavailableHours,
              '3': unavailableHours,
              '4': unavailableHours,
              '5': unavailableHours,
              '6': unavailableHours,
              '7': unavailableHours,
            }
          : unavailableHours;

      const data: Record<string, UnavailableHourProps[]> = {};

      // Fix: `date` millis come from prepareCalendarRange which creates them
      // as midnight in DEVICE timezone (parseDateTime(isoDate) with no zone).
      // Interpreting those millis directly in business timezone via
      // parseDateTime(date, { zone: timeZone }) can shift the date by ±1 day
      // when device and business timezones differ.
      // Instead, extract the correct ISO date first (in device TZ, matching
      // what the calendar columns display), then build the range in business TZ.
      const baseDateIso = parseDateTime(date).toISODate();
      let startDateTime = parseDateTime(baseDateIso, { zone: timeZone }).minus({
        days: offset * pagesPerSide,
      });
      const endDateTime = parseDateTime(baseDateIso, { zone: timeZone }).plus({
        days: offset * (pagesPerSide + 1),
      });

      while (startDateTime <= endDateTime) {
        // weekDay and dateStr are now correct in business timezone
        const weekDay = startDateTime.weekday;
        const dateStr = startDateTime.toFormat('yyyy-MM-dd');

        // Reconstruct device-TZ midnight millis to match visibleDatesArray keys
        const dateUnix = parseDateTime(dateStr).toMillis();

        const specificDateHours = originalData[dateStr] || [];
        const weekdayHours = originalData[weekDay] || [];

        const mergedHours = mergeUnavailableHours(
          specificDateHours,
          weekdayHours
        );

        if (mergedHours.length > 0) {
          data[dateUnix] = mergedHours;
        }

        startDateTime = startDateTime.plus({ days: 1 });
      }

      unavailableHoursStore.setState({ unavailableHours: data });
    },
    [unavailableHours, pagesPerSide, timeZone, unavailableHoursStore]
  );

  useEffect(() => {
    notifyDataChanged(currentDate);
  }, [currentDate, notifyDataChanged]);

  return (
    <UnavailableHoursContext.Provider value={unavailableHoursStore}>
      {children}
    </UnavailableHoursContext.Provider>
  );
};

export default UnavailableHoursProvider;

const selector = (state: UnavailableHoursStore) => state.unavailableHours || {};

export const useUnavailableHours = () => {
  const unavailableHoursContext = useContext(UnavailableHoursContext);

  if (!unavailableHoursContext) {
    throw new Error(
      'useRegionsByDate must be used within a UnavailableHoursProvider'
    );
  }

  const state = useSyncExternalStoreWithSelector(
    unavailableHoursContext.subscribe,
    unavailableHoursContext.getState,
    selector
  );
  return state;
};

export const useUnavailableHoursByDate = (dateUnix: number) => {
  const unavailableHoursContext = useContext(UnavailableHoursContext);

  if (!unavailableHoursContext) {
    throw new Error(
      'useRegionsByDate must be used within a UnavailableHoursProvider'
    );
  }

  const selectUnavailableHoursByDate = useCallback(
    (state: UnavailableHoursStore) => {
      return state.unavailableHours
        ? state.unavailableHours[dateUnix]
        : undefined;
    },
    [dateUnix]
  );

  const state = useSyncExternalStoreWithSelector(
    unavailableHoursContext.subscribe,
    unavailableHoursContext.getState,
    selectUnavailableHoursByDate
  );
  return state;
};
