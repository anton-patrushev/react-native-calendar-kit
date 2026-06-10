/**
 * Pure scroll math helpers for the horizontal calendar list.
 *
 * Extracted from the inline math in `src/service/CalendarList/index.tsx`
 * (column decode + imperative handle) and the snap-offset enumeration in
 * `src/components/CalendarListView/index.tsx`, so the virtualization engine
 * consumes unit-tested functions instead of hand-rolled inline math.
 *
 * Every function carries a `'worklet'` directive so it can run on the
 * Reanimated UI thread (a no-op everywhere else, including jest).
 */

/**
 * Above this many enumerated snap offsets we warn — matches the existing
 * guard in `CalendarListView` (it warns but does NOT truncate the array).
 */
const MAX_OFFSETS = 180537;

export interface ColumnState {
  /** Page index containing the decoded column (floor of column page math). */
  pageIndex: number;
  /** Column within the page, clamped to `[0, columnsPerPage)`. */
  column: number;
  /**
   * The per-column page index used by the scroll reaction for change
   * detection (`colPageIdx`). The JS and worklet decode paths in the source
   * derive it identically, so it always equals `pageIndex`.
   */
  columnPageIndex: number;
}

/**
 * Decodes a horizontal scroll offset into page/column state.
 *
 * Ported from the worklet decode in `CalendarList/index.tsx` (the JS
 * `handleColumnChanged` variant is identical except it lacks the
 * `columnsPerPage > 0` guard on the column width).
 *
 * Deliberate deviation: the column clamp
 * `Math.max(0, Math.min(columnsPerPage - 1, rawColumn))` exists in NEITHER
 * legacy path — both emit the raw `Math.round` result, including `-0` at
 * exact half-boundaries (e.g. offset 166.5 in day mode) and out-of-range
 * readings at page boundaries. The clamp is added intentionally to
 * normalize those legacy edge readings; everything else is behavior-exact.
 */
export function computeColumnState(
  offset: number,
  itemSize: number,
  columnsPerPage: number
): ColumnState {
  'worklet';
  const colWidth = columnsPerPage > 0 ? itemSize / columnsPerPage : itemSize;
  const columnPageIndex = Math.floor(
    Math.round(offset / colWidth) / columnsPerPage
  );
  const columnOffset = columnPageIndex * itemSize;
  const rawColumn = Math.round((offset - columnOffset) / colWidth);
  const column = Math.max(0, Math.min(columnsPerPage - 1, rawColumn));
  return { pageIndex: columnPageIndex, column, columnPageIndex };
}

export interface SnapConfig {
  snapToIndices?: number[];
  snapToOffsets?: number[];
  disableIntervalMomentum: boolean;
  decelerationRate?: 'fast';
  /**
   * Constant `false` by design — there is no `true` branch. New-engine
   * policy: never use native `pagingEnabled`; snapping is always driven by
   * explicit indices/offsets plus `disableIntervalMomentum`.
   */
  pagingEnabled: boolean;
}

/**
 * Builds the cross-platform snap policy for the horizontal list.
 *
 * - `snapToInterval` set (scrollByDay multi-day mode, interval = column
 *   width): faithful port of the previous `CalendarListView` per-column
 *   enumeration — one snap offset per column per page. The legacy
 *   enumeration never branched on `Platform.OS`, and neither does this.
 * - `snapToInterval` not set (plain day/week paging): NEW cross-platform
 *   `snapToIndices` policy that REPLACES the legacy platform split (legacy:
 *   iOS-only page-offset enumeration, Android fell back to native
 *   `pagingEnabled`). Snapping to every item index lets the list convert
 *   indices to exact pixel offsets from real item positions, so fractional
 *   page widths cannot drift. Explicit snap points make
 *   `disableIntervalMomentum` engage, capping a flick at one page
 *   (`pagingEnabled` alone does not constrain momentum on the
 *   New-Architecture ScrollView). The legacy Android freeze concern (a
 *   stale offset array rebuilt in render) does not apply here:
 *   `@legendapp/list` computes and maintains the snap offsets natively from
 *   real item positions instead of rebuilding them in render.
 * - `count <= 1`: nothing to snap between.
 */
export function buildSnapConfig(params: {
  count: number;
  pageWidth: number;
  columnsPerPage: number;
  snapToInterval?: number;
}): SnapConfig {
  'worklet';
  const { count, pageWidth, columnsPerPage, snapToInterval } = params;

  if (count <= 1) {
    return { disableIntervalMomentum: false, pagingEnabled: false };
  }

  if (snapToInterval) {
    // Per-column snapping: base offsets [0..columnsPerPage) * snapToInterval
    // replicated per page at `baseOffset + page * pageWidth`.
    const snapToOffsets: number[] = [];
    for (let page = 0; page < count; page++) {
      for (let col = 0; col < columnsPerPage; col++) {
        snapToOffsets.push(col * snapToInterval + page * pageWidth);
      }
    }
    if (snapToOffsets.length > MAX_OFFSETS) {
      console.warn('The number of days to display is too large');
    }
    return {
      snapToOffsets,
      disableIntervalMomentum: true,
      decelerationRate: 'fast',
      pagingEnabled: false,
    };
  }

  const snapToIndices: number[] = [];
  for (let index = 0; index < count; index++) {
    snapToIndices.push(index);
  }
  return {
    snapToIndices,
    disableIntervalMomentum: true,
    decelerationRate: 'fast',
    pagingEnabled: false,
  };
}

/**
 * Maximum scrollable offset for the list.
 *
 * Ported from the `getMaxOffset` imperative handle in
 * `CalendarList/index.tsx`: `totalSize - columnWidth * visibleColumns`,
 * falling back to `totalSize - itemSize` when `visibleColumns` or
 * `columnsPerPage` is falsy. The source applies no further clamping.
 */
export function getMaxOffset(params: {
  count: number;
  itemSize: number;
  columnsPerPage: number;
  visibleColumns: number;
}): number {
  'worklet';
  const { count, itemSize, columnsPerPage, visibleColumns } = params;
  const totalSize = count * itemSize;
  if (!visibleColumns || !columnsPerPage) {
    return totalSize - itemSize;
  }
  const columnWidth = itemSize / columnsPerPage;
  return totalSize - columnWidth * visibleColumns;
}

/**
 * Whether a target offset is reachable and would actually move the list.
 *
 * Ported from the `isScrollable` imperative handle in
 * `CalendarList/index.tsx`: within `[0, maxOffset]` (inclusive) AND strictly
 * different from the current offset (exact `!==`, no threshold).
 */
export function isScrollableOffset(params: {
  offset: number;
  currentOffset: number;
  count: number;
  itemSize: number;
  columnsPerPage: number;
  visibleColumns: number;
}): boolean {
  'worklet';
  const { offset, currentOffset, count, itemSize, columnsPerPage, visibleColumns } =
    params;
  const maxOffset = getMaxOffset({
    count,
    itemSize,
    columnsPerPage,
    visibleColumns,
  });
  return offset >= 0 && offset <= maxOffset && offset !== currentOffset;
}
