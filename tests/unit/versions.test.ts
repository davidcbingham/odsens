/**
 * tests/unit/versions.test.ts — `lib/versions.ts`: `groupGameVersions` (05 T-UNIT-39; 03 V-01;
 * 02 §2.2 `version` param) and the VERSIONS & FILES ordering helpers (05 T-UNIT-30 —
 * "versionsTable sort": `date_published` desc, files primary-first, changelog flag drives the
 * "Changes ▾" link). Pure — no DOM, no network, no clock.
 */
import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_GROUP,
  groupGameVersions,
  hasChangelog,
  isSnapshotVersion,
  matchesVersionGroup,
  primaryFirst,
  sortVersionsForTable,
} from '@/lib/versions';

describe('T-UNIT-39 groupGameVersions (03 V-01)', () => {
  it('T-UNIT-39 groups the catalogue example into 1.21.x, 1.20.x, snapshots — newest first', () => {
    const groups = groupGameVersions(['1.21', '1.21.1', '1.21.4', '1.20.1', '24w10a', '1.21-pre1']);
    expect(groups).toEqual([
      { value: '1.21.x', label: '1.21.x' },
      { value: '1.20.x', label: '1.20.x' },
      { value: SNAPSHOT_GROUP, label: SNAPSHOT_GROUP },
    ]);
  });

  it('T-UNIT-39 orders release groups numerically, newest first', () => {
    expect(groupGameVersions(['1.9', '1.10.2', '2.0']).map((g) => g.value)).toEqual([
      '2.0.x',
      '1.10.x',
      '1.9.x',
    ]);
  });

  it('T-UNIT-39 dedupes versions of the same major.minor into one group', () => {
    expect(groupGameVersions(['1.21.1', '1.21.4', '1.21'])).toEqual([
      { value: '1.21.x', label: '1.21.x' },
    ]);
  });

  it('T-UNIT-39 no snapshots → no snapshots group; empty input → no groups', () => {
    expect(groupGameVersions(['1.21.4'])).toEqual([{ value: '1.21.x', label: '1.21.x' }]);
    expect(groupGameVersions([])).toEqual([]);
  });

  it('T-UNIT-39 snapshot detection: 24w10a and 1.21-pre1 are snapshots, releases are not', () => {
    expect(isSnapshotVersion('24w10a')).toBe(true);
    expect(isSnapshotVersion('1.21-pre1')).toBe(true);
    expect(isSnapshotVersion('1.21.4-rc1')).toBe(true);
    expect(isSnapshotVersion('1.21')).toBe(false);
    expect(isSnapshotVersion('1.21.4')).toBe(false);
  });

  it('T-UNIT-39 match rule: equals major.minor or starts with major.minor.', () => {
    expect(matchesVersionGroup(['1.21'], '1.21.x')).toBe(true); // equals
    expect(matchesVersionGroup(['1.21.4'], '1.21.x')).toBe(true); // startsWith major.minor.
    expect(matchesVersionGroup(['1.20.1'], '1.21.x')).toBe(false);
    expect(matchesVersionGroup(['1.210.5'], '1.21.x')).toBe(false); // prefix needs the dot
    expect(matchesVersionGroup(['1.21-pre1'], '1.21.x')).toBe(false); // snapshots don't match a release group
    expect(matchesVersionGroup(['24w10a'], SNAPSHOT_GROUP)).toBe(true);
    expect(matchesVersionGroup(['1.21.4'], SNAPSHOT_GROUP)).toBe(false);
  });
});

describe('T-UNIT-30 versionsTable sort (lib/versions.ts)', () => {
  const versions = [
    {
      id: 'v-old',
      datePublished: '2025-01-10T00:00:00Z',
      changelogMd: null,
      files: [{ id: 'f1', primary: false }],
    },
    {
      id: 'v-new',
      datePublished: '2026-06-01T12:00:00Z',
      changelogMd: '- fixed the sound',
      files: [
        { id: 'sources', primary: false },
        { id: 'jar', primary: true },
      ],
    },
    {
      id: 'v-mid',
      datePublished: '2025-11-20T00:00:00Z',
      changelogMd: '',
      files: [
        { id: 'a', primary: false },
        { id: 'b', primary: false },
      ],
    },
  ];

  it('T-UNIT-30 orders versions by date_published desc', () => {
    expect(sortVersionsForTable(versions).map((v) => v.id)).toEqual(['v-new', 'v-mid', 'v-old']);
  });

  it('T-UNIT-30 puts the primary file first within a version, stable otherwise', () => {
    const sorted = sortVersionsForTable(versions);
    expect(sorted.map((v) => v.files.map((f) => f.id))).toEqual([
      ['jar', 'sources'], // primary first
      ['a', 'b'], // stable when no primary
      ['f1'],
    ]);
    expect(primaryFirst([{ primary: false }, { primary: true }, { primary: false }])).toEqual([
      { primary: true },
      { primary: false },
      { primary: false },
    ]);
  });

  it('T-UNIT-30 changelog-present flag drives the "Changes ▾" link', () => {
    expect(hasChangelog('- fixed the sound')).toBe(true);
    expect(hasChangelog(null)).toBe(false);
    expect(hasChangelog(undefined)).toBe(false);
    expect(hasChangelog('')).toBe(false);
    expect(hasChangelog('   ')).toBe(false);
  });

  it('T-UNIT-30 never mutates its input', () => {
    const input = versions.map((v) => ({ ...v, files: [...v.files] }));
    const snapshot = JSON.parse(JSON.stringify(input)) as unknown;
    sortVersionsForTable(input);
    expect(input).toEqual(snapshot);
  });
});
