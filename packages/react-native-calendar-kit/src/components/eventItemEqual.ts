import isEqual from 'lodash.isequal';
import type { PackedEvent } from '../types';

/**
 * Props of `EventItem` that the memo comparator inspects. Kept as a local
 * structural type (not the full `EventItemProps`) so the comparator is a pure,
 * unit-testable function with no React/animation deps.
 */
export interface EventItemEqualProps {
  event: PackedEvent;
  startUnix: number;
  renderEvent?: unknown;
  onPressEvent?: unknown;
  onLongPressEvent?: unknown;
  isDragging?: boolean;
  visibleDates: Record<string, { diffDays: number; unix: number }>;
  totalResources?: number;
}

/**
 * `React.memo` comparator for `EventItem`. Returns `true` when the two prop
 * sets render identically (so the memo can skip a re-render).
 *
 * Replaces an unconditional lodash `isEqual` deep-walk of the whole event +
 * visibleDates on every parent render — under LegendList `recycleItems` that
 * deep compare runs for every resident event on every parent state change and
 * dominates the page-render cost. The deep compare is kept ONLY for the
 * custom-renderer path (see step 3a), where the renderer may read any field;
 * the default kit render path uses a cheap flat compare of the fields it reads.
 *
 * Strategy:
 *  1. Compare the scalar/reference props first (cheap, and the most likely to
 *     differ on a drag-state or selection toggle): `startUnix`, `renderEvent`
 *     (identity — a changed render fn must invalidate), `isDragging`,
 *     `onPressEvent`, `onLongPressEvent`, `totalResources`, and `visibleDates`
 *     by reference (it is a stable per-page memo in BodyItem; its identity only
 *     changes when its contents change). If any differ → not equal.
 *  2. Reference fast path: if `prev.event === next.event` the packed object is
 *     the exact same instance, so nothing event-derived changed. The store
 *     allocates a fresh PackedEvent only when it recomputes, so identity is a
 *     reliable "unchanged" signal. Combined with step 1 → equal.
 *  3. Events differ by reference. The compare now depends on the render path:
 *     - Custom renderer (`next.renderEvent` set): `EventItem` passes the FULL
 *       packed event to `renderEvent`, which can read ARBITRARY fields (e.g.
 *       `textColor`, `borderColor`, `useInvertedColorScheme`,
 *       `timeSegments.{processing,trailing}`, `startTime`, `endTime`). A flat
 *       appearance compare would miss those and skip a render → stale cards.
 *       So deep-compare the whole event with lodash `isEqual`. Callers that
 *       care about cost stabilize event identity upstream, so the fast path in
 *       step 2 usually hits and this deep walk only runs when an event actually
 *       changed.
 *     - Default kit render (`renderEvent` not set): only a fixed set of fields
 *       is read, so a cheap flat compare suffices:
 *       - identity: `localId`
 *       - appearance scalars: `color` (background), `titleColor`, `title`,
 *         `draggable` (gates long-press)
 *       - `_internal` layout fields that drive width/position/height/z:
 *         `startUnix` (event day → diffDays), `total`, `index`, `columnSpan`,
 *         `widthPercentage`, `xOffsetPercentage`, `resourceIndex`, `zIndex`,
 *         `stackLevel`, `startMinutes`, `duration`
 *       Any field outside this set is intentionally NOT compared on the default
 *       path — the default render does not read it.
 */
export const eventItemPropsAreEqual = (
  prev: EventItemEqualProps,
  next: EventItemEqualProps
): boolean => {
  // 1. Scalar / reference props first (cheap, and the most likely to differ
  //    on a drag-state or selection toggle). `renderEvent` identity is part of
  //    this set: a changed render function must invalidate the memo.
  if (
    prev.startUnix !== next.startUnix ||
    prev.isDragging !== next.isDragging ||
    prev.totalResources !== next.totalResources ||
    prev.renderEvent !== next.renderEvent ||
    prev.onPressEvent !== next.onPressEvent ||
    prev.onLongPressEvent !== next.onLongPressEvent ||
    prev.visibleDates !== next.visibleDates
  ) {
    return false;
  }

  const prevEvent = prev.event;
  const nextEvent = next.event;

  // 2. Reference fast path on the packed event.
  if (prevEvent === nextEvent) {
    return true;
  }

  // 3a. Custom renderer can read any field — deep compare the whole event.
  if (next.renderEvent) {
    return isEqual(prevEvent, nextEvent);
  }

  // 3b. Default render path: appearance scalars + identity on the event.
  if (
    prevEvent.localId !== nextEvent.localId ||
    prevEvent.color !== nextEvent.color ||
    prevEvent.titleColor !== nextEvent.titleColor ||
    prevEvent.title !== nextEvent.title ||
    prevEvent.draggable !== nextEvent.draggable
  ) {
    return false;
  }

  // 3c. Layout-affecting `_internal` fields (default render path).
  const p = prevEvent._internal;
  const n = nextEvent._internal;
  return (
    p.startUnix === n.startUnix &&
    p.duration === n.duration &&
    p.startMinutes === n.startMinutes &&
    p.resourceIndex === n.resourceIndex &&
    p.total === n.total &&
    p.index === n.index &&
    p.columnSpan === n.columnSpan &&
    p.widthPercentage === n.widthPercentage &&
    p.xOffsetPercentage === n.xOffsetPercentage &&
    p.zIndex === n.zIndex &&
    p.stackLevel === n.stackLevel
  );
};
