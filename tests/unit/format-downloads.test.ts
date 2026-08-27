/**
 * tests/unit/format-downloads.test.ts — `lib/format/downloads.ts` `combinedDownloads` +
 * `COMBINED_COUNT_LINE` (05 T-UNIT-11; 03 §2.3 `GetItPanel` copy; T-RLS-23 sum parity;
 * 05 T-E2E-3 combined line `1.7K`). Pure.
 */
import { describe, expect, it } from 'vitest';
import { COMBINED_COUNT_LINE, combinedDownloads } from '@/lib/format/downloads';
import { formatCount } from '@/lib/format/number';

describe('T-UNIT-11 combinedDownloads', () => {
  it('T-UNIT-11 sums modrinth + curseforge + direct', () => {
    expect(
      combinedDownloads({
        downloads_modrinth: 1568,
        downloads_curseforge: 120,
        downloads_direct: 0,
      }),
    ).toBe(1688); // seed `…0102` — T-RLS-23 asserts the same 1688 on the view
  });

  it('T-UNIT-11 treats nulls as 0', () => {
    expect(
      combinedDownloads({
        downloads_modrinth: null,
        downloads_curseforge: 305,
        downloads_direct: null,
      }),
    ).toBe(305);
    expect(
      combinedDownloads({
        downloads_modrinth: null,
        downloads_curseforge: null,
        downloads_direct: null,
      }),
    ).toBe(0);
  });

  it('T-UNIT-11 treats absent keys as 0', () => {
    expect(combinedDownloads({})).toBe(0);
    expect(combinedDownloads({ downloads_direct: 7 })).toBe(7);
  });

  it('T-UNIT-11 the seed combined count renders 1.7K via formatCount (05 T-E2E-3)', () => {
    const total = combinedDownloads({
      downloads_modrinth: 1568,
      downloads_curseforge: 120,
      downloads_direct: 0,
    });
    expect(formatCount(total)).toBe('1.7K');
  });
});

describe('T-UNIT-11 combined-count line (DESIGN.md §6 #3 via 03 §2.3 GetItPanel)', () => {
  it('T-UNIT-11 carries the 03 copy verbatim', () => {
    expect(COMBINED_COUNT_LINE).toBe(
      'Modrinth and CurseForge report their own counts. Direct downloads are the ones we serve.',
    );
  });
});
