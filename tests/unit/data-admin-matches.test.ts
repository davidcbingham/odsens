/**
 * tests/unit/data-admin-matches.test.ts — 05 T-UNIT-50: `projectMatchKey` (`lib/format/project.ts`)
 * and the suggested-match rule `suggestMatches` (`lib/data/admin.ts`) behind the `/admin/projects`
 * "Looks like the same project as <title> — link it" note (ADR-0037 D8; 00 S1.5a.AC7). Pure — no
 * DB, no network (05 §1.1); `server-only` is mocked by the unit setup file.
 */
import { describe, expect, it } from 'vitest';
import { suggestMatches, type SuggestMatchRow } from '@/lib/data/admin';
import { projectMatchKey } from '@/lib/format/project';

function row(
  id: string,
  source: SuggestMatchRow['source'],
  slug: string,
  title: string,
  externalId: string | null = source === 'modrinth' ? `ext-${id}` : null,
): SuggestMatchRow {
  return { id, source, slug, title, externalId };
}

describe('T-UNIT-50 projectMatchKey (ADR-0037 D8)', () => {
  it.each([
    ['Metal Pipe Mace', 'metalpipemace'],
    ['metal-pipe-mace', 'metalpipemace'],
    ['metal_pipe_mace', 'metalpipemace'],
    ['  Pixel  Chameleon! ', 'pixelchameleon'],
    ['p-sd000199', 'psd000199'],
  ])('T-UNIT-50 %j → %j (lower-case alphanumerics only)', (text, key) => {
    expect(projectMatchKey(text)).toBe(key);
  });

  it('T-UNIT-50 empty or symbol-only input keys to "" (never matches)', () => {
    expect(projectMatchKey('')).toBe('');
    expect(projectMatchKey('— · —')).toBe('');
  });
});

describe('T-UNIT-50 suggestMatches (the /admin/projects note rule)', () => {
  it("T-UNIT-50 a synced row sharing an odsens row's SLUG key is matched (keyed by the synced id)", () => {
    const rows = [
      row('excl', 'odsens', 'metal-pipe-mace', 'Seed Exclusive Pack'),
      row('sync', 'modrinth', 'metal_pipe_mace', 'Something Else', 'sd000101'),
    ];
    expect([...suggestMatches(rows)]).toEqual([
      ['sync', { odsensId: 'excl', odsensTitle: 'Seed Exclusive Pack', externalId: 'sd000101' }],
    ]);
  });

  it('T-UNIT-50 a TITLE match surfaces the note when the slugs differ (the ADR-0037 D2 `p-<id>` slug)', () => {
    const rows = [
      row('excl', 'odsens', 'foo', 'Metal Pipe Mace'),
      row('sync', 'modrinth', 'p-sd000101', 'Metal Pipe Mace', 'sd000101'),
    ];
    expect(suggestMatches(rows).get('sync')).toEqual({
      odsensId: 'excl',
      odsensTitle: 'Metal Pipe Mace',
      externalId: 'sd000101',
    });
  });

  it('T-UNIT-50 the synced TITLE may match the odsens SLUG and vice versa', () => {
    const rows = [
      row('excl', 'odsens', 'pixel-chameleon', 'A Different Name'),
      row('sync', 'modrinth', 'renamed-upstream', 'Pixel Chameleon', 'sd000102'),
    ];
    expect(suggestMatches(rows).get('sync')?.odsensId).toBe('excl');
  });

  it('T-UNIT-50 no note without an odsens twin, for odsens rows, or between two synced rows', () => {
    const rows = [
      row('a', 'modrinth', 'metal-pipe-mace', 'Metal Pipe Mace', 'sd000101'),
      row('b', 'modrinth', 'metal-pipe-mace-2', 'Metal Pipe Mace', 'sd000103'),
      row('excl', 'odsens', 'seed-exclusive-pack', 'Seed Exclusive Pack'),
      row('excl2', 'odsens', 'seed-exclusive-pack-2', 'Seed Exclusive Pack'),
    ];
    expect(suggestMatches(rows).size).toBe(0);
  });

  it('T-UNIT-50 a synced row without an external_id never gets a note (nothing to prefill)', () => {
    const rows = [
      row('excl', 'odsens', 'foo', 'Foo'),
      row('sync', 'modrinth', 'foo', 'Foo', null),
      row('sync2', 'modrinth', 'foo', 'Foo', ''),
    ];
    expect(suggestMatches(rows).size).toBe(0);
  });

  it('T-UNIT-50 the first odsens row in list order wins when two share the key; empty keys never match', () => {
    const rows = [
      row('excl-a', 'odsens', 'foo', 'Foo'),
      row('excl-b', 'odsens', 'foo-2', 'Foo'),
      row('sync', 'modrinth', 'foo', 'Foo', 'sd1'),
      row('blank-odsens', 'odsens', '---', '···'),
      row('blank-sync', 'modrinth', '---', '···', 'sd2'),
    ];
    const matches = suggestMatches(rows);
    expect(matches.get('sync')?.odsensId).toBe('excl-a');
    expect(matches.has('blank-sync')).toBe(false);
  });

  it('T-UNIT-50 an empty list or a list with no odsens rows returns an empty map', () => {
    expect(suggestMatches([]).size).toBe(0);
    expect(suggestMatches([row('a', 'modrinth', 'x', 'X', 'sd1')]).size).toBe(0);
  });
});
