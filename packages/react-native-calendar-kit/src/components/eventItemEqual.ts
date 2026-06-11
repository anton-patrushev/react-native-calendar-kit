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
 * Replaces a previous lodash `isEqual` deep-walk of the whole event +
 * visibleDates on every parent render — under LegendList `recycleItems` that
 * deep compare runs for every resident event on every parent state change and
 * dominates the page-render cost.
 *
 * Strategy:
 *  1. Reference fast path: if `prev.event === next.event` the packed object is
 *     the exact same instance, so nothing event-derived changed. The store
 *     allocates a fresh PackedEvent only when it recomputes, so identity is a
 *     reliable "unchanged" signal.
 *  2. Otherwise compare only the fields the render actually reads:
 *     - identity: `localId`
 *     - appearance scalars from the event: `color` (background),
 *       `titleColor`, `title`, `draggable` (gates long-press)
 *     - `_internal` layout fields that drive width/position/height/z:
 *       `startUnix` (event day → diffDays), `total`, `index`, `columnSpan`,
 *       `widthPercentage`, `xOffsetPercentage`, `resourceIndex`, `zIndex`,
 *       `stackLevel`, `startMinutes`, `duration`
 *  3. Compare the scalar/reference props: `startUnix`, `renderEvent`,
 *     `isDragging`, `onPressEvent`, `onLongPressEvent`, `totalResources`, and
 *     `visibleDates` by reference (it is a stable per-page memo in BodyItem;
 *     its identity only changes when its contents change).
 *
 * No deep walk: every field below is a primitive or a reference. If a field
 * that changes appearance changes, one of these checks invalidates the memo.
 */
export const eventItemPropsAreEqual = (
  prev: EventItemEqualProps,
  next: EventItemEqualProps
): boolean => {
  // 3. Scalar / reference props first (cheap, and the most likely to differ
  //    on a drag-state or selection toggle).
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

  // 1. Reference fast path on the packed event.
  if (prevEvent === nextEvent) {
    return true;
  }

  // 2a. Appearance scalars + identity on the event itself.
  if (
    prevEvent.localId !== nextEvent.localId ||
    prevEvent.color !== nextEvent.color ||
    prevEvent.titleColor !== nextEvent.titleColor ||
    prevEvent.title !== nextEvent.title ||
    prevEvent.draggable !== nextEvent.draggable
  ) {
    return false;
  }

  // 2b. Layout-affecting `_internal` fields.
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
