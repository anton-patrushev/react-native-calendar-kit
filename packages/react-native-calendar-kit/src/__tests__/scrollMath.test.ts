import {
  buildSnapConfig,
  computeColumnState,
  getMaxOffset,
  isScrollableOffset,
} from '../service/CalendarList/scrollMath';

describe('scrollMath', () => {
  describe('computeColumnState', () => {
    describe('day mode (columnsPerPage=1, itemSize=333)', () => {
      const itemSize = 333;
      const columnsPerPage = 1;

      it('decodes offset 0 to page 0, column 0', () => {
        expect(computeColumnState(0, itemSize, columnsPerPage)).toEqual({
          pageIndex: 0,
          column: 0,
          columnPageIndex: 0,
        });
      });

      it('rounds offset 332.4 (just before page boundary) to page 1', () => {
        expect(computeColumnState(332.4, itemSize, columnsPerPage)).toEqual({
          pageIndex: 1,
          column: 0,
          columnPageIndex: 1,
        });
      });

      it('decodes exact page boundary offset 333 to page 1', () => {
        expect(computeColumnState(333, itemSize, columnsPerPage)).toEqual({
          pageIndex: 1,
          column: 0,
          columnPageIndex: 1,
        });
      });

      it('decodes offset 999 (3 pages) to page 3', () => {
        expect(computeColumnState(999, itemSize, columnsPerPage)).toEqual({
          pageIndex: 3,
          column: 0,
          columnPageIndex: 3,
        });
      });

      it('rounds mid-scroll fraction at exactly half a page up (166.5 -> page 1)', () => {
        expect(computeColumnState(166.5, itemSize, columnsPerPage)).toEqual({
          pageIndex: 1,
          column: 0,
          columnPageIndex: 1,
        });
      });

      it('rounds mid-scroll fraction just below half a page down (166.4 -> page 0)', () => {
        expect(computeColumnState(166.4, itemSize, columnsPerPage)).toEqual({
          pageIndex: 0,
          column: 0,
          columnPageIndex: 0,
        });
      });

      it('keeps small mid-scroll offsets on the current page (100 -> page 0)', () => {
        expect(computeColumnState(100, itemSize, columnsPerPage)).toEqual({
          pageIndex: 0,
          column: 0,
          columnPageIndex: 0,
        });
      });

      it('clamps column to 0 on negative overscroll offset', () => {
        const result = computeColumnState(-200, itemSize, columnsPerPage);
        expect(result.column).toBe(0);
        // Page index follows the source decode math (can go negative during
        // iOS bounce; consumers guard it).
        expect(result.pageIndex).toBe(-1);
        expect(result.columnPageIndex).toBe(-1);
      });
    });

    describe('week mode (columnsPerPage=7, itemSize=333)', () => {
      const itemSize = 333;
      const columnsPerPage = 7;
      const columnWidth = itemSize / columnsPerPage; // 47.57142857142857

      it('decodes offset 0 to page 0, column 0', () => {
        expect(computeColumnState(0, itemSize, columnsPerPage)).toEqual({
          pageIndex: 0,
          column: 0,
          columnPageIndex: 0,
        });
      });

      it('decodes an exact column boundary (1 column width)', () => {
        expect(computeColumnState(columnWidth, itemSize, columnsPerPage)).toEqual(
          {
            pageIndex: 0,
            column: 1,
            columnPageIndex: 0,
          }
        );
      });

      it('rounds up at exactly half a column (Math.round half-up)', () => {
        expect(
          computeColumnState(columnWidth / 2, itemSize, columnsPerPage)
        ).toEqual({
          pageIndex: 0,
          column: 1,
          columnPageIndex: 0,
        });
      });

      it('rounds down just below half a column', () => {
        expect(computeColumnState(23.78, itemSize, columnsPerPage)).toEqual({
          pageIndex: 0,
          column: 0,
          columnPageIndex: 0,
        });
      });

      it('decodes the last column of a page (column 6)', () => {
        expect(
          computeColumnState(6 * columnWidth, itemSize, columnsPerPage)
        ).toEqual({
          pageIndex: 0,
          column: 6,
          columnPageIndex: 0,
        });
      });

      it('keeps 6.4 columns on page 0, column 6', () => {
        expect(
          computeColumnState(6.4 * columnWidth, itemSize, columnsPerPage)
        ).toEqual({
          pageIndex: 0,
          column: 6,
          columnPageIndex: 0,
        });
      });

      it('rolls 6.5 columns over to page 1, column 0 (page transition)', () => {
        expect(
          computeColumnState(6.5 * columnWidth, itemSize, columnsPerPage)
        ).toEqual({
          pageIndex: 1,
          column: 0,
          columnPageIndex: 1,
        });
      });

      it('decodes an exact page boundary (offset 333) to page 1, column 0', () => {
        expect(computeColumnState(333, itemSize, columnsPerPage)).toEqual({
          pageIndex: 1,
          column: 0,
          columnPageIndex: 1,
        });
      });

      it('decodes a column inside a later page (page 1, column 3)', () => {
        expect(
          computeColumnState(333 + 3 * columnWidth, itemSize, columnsPerPage)
        ).toEqual({
          pageIndex: 1,
          column: 3,
          columnPageIndex: 1,
        });
      });

      it('decodes a small negative overscroll into the previous page, last column', () => {
        expect(computeColumnState(-30, itemSize, columnsPerPage)).toEqual({
          pageIndex: -1,
          column: 6,
          columnPageIndex: -1,
        });
      });

      it('decodes a full negative page (offset -333) to page -1, column 0', () => {
        expect(computeColumnState(-333, itemSize, columnsPerPage)).toEqual({
          pageIndex: -1,
          column: 0,
          columnPageIndex: -1,
        });
      });

      it('decodes offsets beyond content linearly (page index is not capped)', () => {
        expect(computeColumnState(600 * 333, itemSize, columnsPerPage)).toEqual({
          pageIndex: 600,
          column: 0,
          columnPageIndex: 600,
        });
      });

      it('always keeps column within [0, columnsPerPage) across a dense offset sweep', () => {
        const violations: { offset: number; column: number }[] = [];
        for (let offset = -1000; offset <= 200000; offset += 0.37) {
          const { column } = computeColumnState(offset, itemSize, columnsPerPage);
          if (column < 0 || column >= columnsPerPage) {
            violations.push({ offset, column });
          }
        }
        expect(violations).toEqual([]);
      });
    });

    describe('fractional Android widths (itemSize=351.428571)', () => {
      const itemSize = 351.428571;

      it('exactly decodes pageIndex*itemSize back at page 100 (columnsPerPage=7)', () => {
        expect(computeColumnState(100 * itemSize, itemSize, 7)).toEqual({
          pageIndex: 100,
          column: 0,
          columnPageIndex: 100,
        });
      });

      it('exactly decodes pageIndex*itemSize back at page 1000 (columnsPerPage=7)', () => {
        expect(computeColumnState(1000 * itemSize, itemSize, 7)).toEqual({
          pageIndex: 1000,
          column: 0,
          columnPageIndex: 1000,
        });
      });

      it('decodes a mid-page column without drift at page 1000 (column 3)', () => {
        const offset = 1000 * itemSize + 3 * (itemSize / 7);
        expect(computeColumnState(offset, itemSize, 7)).toEqual({
          pageIndex: 1000,
          column: 3,
          columnPageIndex: 1000,
        });
      });

      it('exactly decodes pageIndex*itemSize back at page 100 (columnsPerPage=1)', () => {
        expect(computeColumnState(100 * itemSize, itemSize, 1)).toEqual({
          pageIndex: 100,
          column: 0,
          columnPageIndex: 100,
        });
      });

      it('exactly decodes pageIndex*itemSize back at page 1000 (columnsPerPage=1)', () => {
        expect(computeColumnState(1000 * itemSize, itemSize, 1)).toEqual({
          pageIndex: 1000,
          column: 0,
          columnPageIndex: 1000,
        });
      });

      it('round-trips every page exactly (no cumulative drift, pages 0-1000)', () => {
        for (let page = 0; page <= 1000; page++) {
          const result = computeColumnState(page * itemSize, itemSize, 7);
          expect(result.pageIndex).toBe(page);
          expect(result.column).toBe(0);
        }
      });
    });
  });

  describe('buildSnapConfig', () => {
    describe('plain day paging (no snapToInterval)', () => {
      it('returns snapToIndices for every item with count=3653', () => {
        const config = buildSnapConfig({
          count: 3653,
          pageWidth: 333,
          columnsPerPage: 1,
        });

        expect(config.snapToIndices).toHaveLength(3653);
        expect(config.snapToIndices!.slice(0, 3)).toEqual([0, 1, 2]);
        expect(config.snapToIndices![3652]).toBe(3652);
        expect(config.snapToOffsets).toBeUndefined();
        expect(config.disableIntervalMomentum).toBe(true);
        expect(config.decelerationRate).toBe('fast');
        expect(config.pagingEnabled).toBe(false);
      });
    });

    describe('plain week paging (no snapToInterval)', () => {
      it('returns snapToIndices for every item with count=522', () => {
        const config = buildSnapConfig({
          count: 522,
          pageWidth: 332.5,
          columnsPerPage: 7,
        });

        expect(config.snapToIndices).toHaveLength(522);
        expect(config.snapToIndices!.slice(0, 3)).toEqual([0, 1, 2]);
        expect(config.snapToIndices![521]).toBe(521);
        expect(config.snapToOffsets).toBeUndefined();
        expect(config.disableIntervalMomentum).toBe(true);
        expect(config.decelerationRate).toBe('fast');
        expect(config.pagingEnabled).toBe(false);
      });
    });

    describe('snapToInterval path (scrollByDay multi-day mode)', () => {
      it('builds per-column offsets replicated per page', () => {
        const config = buildSnapConfig({
          count: 522,
          pageWidth: 332.5,
          columnsPerPage: 7,
          snapToInterval: 47.5,
        });

        expect(config.snapToOffsets).toHaveLength(522 * 7);
        expect(config.snapToOffsets!.slice(0, 10)).toEqual([
          0, 47.5, 95, 142.5, 190, 237.5, 285, 332.5, 380, 427.5,
        ]);
        // Last offset: column 6 of page 521.
        expect(config.snapToOffsets![522 * 7 - 1]).toBe(
          6 * 47.5 + 521 * 332.5
        );
        expect(config.snapToOffsets![522 * 7 - 1]).toBe(173517.5);
        expect(config.snapToIndices).toBeUndefined();
        expect(config.disableIntervalMomentum).toBe(true);
        expect(config.decelerationRate).toBe('fast');
        expect(config.pagingEnabled).toBe(false);
      });

      it('does not warn when offsets count is within MAX_OFFSETS', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        buildSnapConfig({
          count: 522,
          pageWidth: 332.5,
          columnsPerPage: 7,
          snapToInterval: 47.5,
        });

        expect(warnSpy).not.toHaveBeenCalled();
        warnSpy.mockRestore();
      });

      it('warns above MAX_OFFSETS but does NOT truncate (matches existing behavior)', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        // 25792 * 7 = 180544 > MAX_OFFSETS (180537)
        const config = buildSnapConfig({
          count: 25792,
          pageWidth: 332.5,
          columnsPerPage: 7,
          snapToInterval: 47.5,
        });

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          'The number of days to display is too large'
        );
        expect(config.snapToOffsets).toHaveLength(25792 * 7);
        warnSpy.mockRestore();
      });

      it('does not warn at exactly MAX_OFFSETS offsets', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

        // 25791 * 7 = 180537 === MAX_OFFSETS (guard is strict greater-than)
        const config = buildSnapConfig({
          count: 25791,
          pageWidth: 332.5,
          columnsPerPage: 7,
          snapToInterval: 47.5,
        });

        expect(warnSpy).not.toHaveBeenCalled();
        expect(config.snapToOffsets).toHaveLength(25791 * 7);
        warnSpy.mockRestore();
      });
    });

    describe('edge cases', () => {
      it('disables all snapping for count=1', () => {
        const config = buildSnapConfig({
          count: 1,
          pageWidth: 333,
          columnsPerPage: 7,
          snapToInterval: 47.5,
        });

        expect(config).toEqual({
          disableIntervalMomentum: false,
          pagingEnabled: false,
        });
        expect(config.snapToIndices).toBeUndefined();
        expect(config.snapToOffsets).toBeUndefined();
        expect(config.decelerationRate).toBeUndefined();
      });

      it('disables all snapping for count=0', () => {
        const config = buildSnapConfig({
          count: 0,
          pageWidth: 333,
          columnsPerPage: 1,
        });

        expect(config).toEqual({
          disableIntervalMomentum: false,
          pagingEnabled: false,
        });
      });
    });
  });

  describe('getMaxOffset', () => {
    it('returns totalSize - columnWidth * visibleColumns in week mode', () => {
      // totalSize = 522 * 332.5 = 173565; columnWidth = 47.5
      expect(
        getMaxOffset({
          count: 522,
          itemSize: 332.5,
          columnsPerPage: 7,
          visibleColumns: 7,
        })
      ).toBe(173232.5);
    });

    it('leaves room for fewer visible columns (3-day view: visibleColumns=3, columnsPerPage=7)', () => {
      // 173565 - 47.5 * 3 = 173422.5 (larger max than the 7-column case)
      expect(
        getMaxOffset({
          count: 522,
          itemSize: 332.5,
          columnsPerPage: 7,
          visibleColumns: 3,
        })
      ).toBe(173422.5);
    });

    it('returns totalSize - itemSize in day mode', () => {
      expect(
        getMaxOffset({
          count: 3653,
          itemSize: 333,
          columnsPerPage: 1,
          visibleColumns: 1,
        })
      ).toBe(1216116);
    });

    it('falls back to totalSize - itemSize when visibleColumns is 0 (source falsy guard)', () => {
      expect(
        getMaxOffset({
          count: 522,
          itemSize: 332.5,
          columnsPerPage: 7,
          visibleColumns: 0,
        })
      ).toBe(173232.5);
    });

    it('falls back to totalSize - itemSize when columnsPerPage is 0 (source falsy guard)', () => {
      expect(
        getMaxOffset({
          count: 522,
          itemSize: 332.5,
          columnsPerPage: 0,
          visibleColumns: 7,
        })
      ).toBe(173232.5);
    });
  });

  describe('isScrollableOffset', () => {
    const baseParams = {
      count: 522,
      itemSize: 332.5,
      columnsPerPage: 7,
      visibleColumns: 7,
    };
    const maxOffset = 173232.5; // 522 * 332.5 - 47.5 * 7

    it('returns true for offset 0 when current offset differs', () => {
      expect(
        isScrollableOffset({ ...baseParams, offset: 0, currentOffset: 100 })
      ).toBe(true);
    });

    it('returns true at exactly the max offset (inclusive bound)', () => {
      expect(
        isScrollableOffset({
          ...baseParams,
          offset: maxOffset,
          currentOffset: 0,
        })
      ).toBe(true);
    });

    it('returns false beyond the max offset', () => {
      expect(
        isScrollableOffset({
          ...baseParams,
          offset: maxOffset + 0.5,
          currentOffset: 0,
        })
      ).toBe(false);
    });

    it('returns false for negative offsets', () => {
      expect(
        isScrollableOffset({ ...baseParams, offset: -1, currentOffset: 100 })
      ).toBe(false);
    });

    it('returns false when offset strictly equals currentOffset', () => {
      expect(
        isScrollableOffset({ ...baseParams, offset: 500, currentOffset: 500 })
      ).toBe(false);
    });

    it('returns true for near-equal offsets (source uses strict !==, no threshold)', () => {
      expect(
        isScrollableOffset({
          ...baseParams,
          offset: 500.0001,
          currentOffset: 500,
        })
      ).toBe(true);
    });

    it('allows offsets past the 7-column max when only 3 columns are visible (3-day view)', () => {
      // 173422.5 is the 3-column max; 173300 is beyond the 7-column max
      // (173232.5) but within the 3-column max.
      expect(
        isScrollableOffset({
          ...baseParams,
          visibleColumns: 3,
          offset: 173300,
          currentOffset: 0,
        })
      ).toBe(true);
      expect(
        isScrollableOffset({
          ...baseParams,
          visibleColumns: 7,
          offset: 173300,
          currentOffset: 0,
        })
      ).toBe(false);
    });

    it('returns true at exactly the 3-column max offset', () => {
      expect(
        isScrollableOffset({
          ...baseParams,
          visibleColumns: 3,
          offset: 173422.5,
          currentOffset: 0,
        })
      ).toBe(true);
      expect(
        isScrollableOffset({
          ...baseParams,
          visibleColumns: 3,
          offset: 173423,
          currentOffset: 0,
        })
      ).toBe(false);
    });
  });
});
