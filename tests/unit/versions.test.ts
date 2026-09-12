/**
 * tests/unit/versions.test.ts — `lib/versions.ts`: `groupGameVersions` (05 T-UNIT-39; 03 V-01;
 * 02 §2.2 `version` param), the VERSIONS & FILES ordering helpers (05 T-UNIT-30 — "versionsTable
 * sort": `date_published` desc, files `hostedFirst` (amended by ADR-0037 D6 — was primary-first),
 * changelog flag drives the "Changes ▾" link) and the ADR-0037 D6 primary-download rule
 * (05 T-UNIT-49: `hostedFirst` rank, `selectPrimaryFile`). Pure — no DOM, no network, no clock.
 */
import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_GROUP,
  formatVersionList,
  groupGameVersions,
  hasChangelog,
  hostedFirst,
  isSnapshotVersion,
  matchesVersionGroup,
  selectPrimaryFile,
  sortVersionsForTable,
  type FileKind,
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

describe('T-UNIT-30 versionsTable sort (lib/versions.ts; ADR-0037 D6 amended)', () => {
  const cdn = (id: string, primary = false) => ({ id, kind: 'modrinth' as FileKind, primary });
  const versions = [
    {
      id: 'v-old',
      datePublished: '2025-01-10T00:00:00Z',
      changelogMd: null,
      files: [cdn('f1')],
    },
    {
      id: 'v-new',
      datePublished: '2026-06-01T12:00:00Z',
      changelogMd: '- fixed the sound',
      files: [cdn('sources'), cdn('jar', true)],
    },
    {
      id: 'v-mid',
      datePublished: '2025-11-20T00:00:00Z',
      changelogMd: '',
      files: [cdn('a'), cdn('b')],
    },
  ];

  it('T-UNIT-30 orders versions by date_published desc', () => {
    expect(sortVersionsForTable(versions).map((v) => v.id)).toEqual(['v-new', 'v-mid', 'v-old']);
  });

  it('T-UNIT-30 puts the primary file first within a version, stable otherwise (hostedFirst)', () => {
    const sorted = sortVersionsForTable(versions);
    expect(sorted.map((v) => v.files.map((f) => f.id))).toEqual([
      ['jar', 'sources'], // primary first
      ['a', 'b'], // stable when no primary
      ['f1'],
    ]);
    expect(hostedFirst([cdn('x'), cdn('y', true), cdn('z')]).map((f) => f.id)).toEqual([
      'y',
      'x',
      'z',
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

describe('T-UNIT-49 primary-download rule (ADR-0037 D6: hostedFirst, selectPrimaryFile)', () => {
  const file = (id: string, kind: FileKind, primary: boolean) => ({ id, kind, primary });
  const hostedPrimary = file('hosted-primary', 'direct', true);
  const hosted = file('hosted', 'direct', false);
  const cdnPrimary = file('cdn-primary', 'modrinth', true);
  const cdn = file('cdn', 'modrinth', false);

  it('T-UNIT-49 hostedFirst ranks hosted primary → hosted → CDN primary → CDN, stable within a rank', () => {
    const order = hostedFirst([cdn, cdnPrimary, hosted, hostedPrimary]).map((f) => f.id);
    expect(order).toEqual(['hosted-primary', 'hosted', 'cdn-primary', 'cdn']);
    // Stable: two files of the same rank keep their given order.
    const twoHosted = hostedFirst([file('h1', 'direct', false), file('h2', 'direct', false)]);
    expect(twoHosted.map((f) => f.id)).toEqual(['h1', 'h2']);
    // A version living in two homes (ADR-0037 D2 sha512 pairing): the file we serve before the mirror.
    expect(hostedFirst([cdnPrimary, hostedPrimary]).map((f) => f.id)).toEqual([
      'hosted-primary',
      'cdn-primary',
    ]);
  });

  it('T-UNIT-49 selectPrimaryFile = the hosted primary of the newest version with a hosted file', () => {
    const versions = [
      { datePublished: '2026-01-01T00:00:00Z', files: [cdnPrimary] }, // newest, CDN-only
      { datePublished: '2025-06-01T00:00:00Z', files: [cdn, hosted, hostedPrimary] },
      { datePublished: '2025-01-01T00:00:00Z', files: [file('older-hosted', 'direct', true)] },
    ];
    // An older hosted release beats a newer CDN-only one (David: the hosted file is always the primary).
    expect(selectPrimaryFile(versions)?.id).toBe('hosted-primary');
  });

  it('T-UNIT-49 selectPrimaryFile takes the first hosted file when the version has no hosted primary flag', () => {
    const versions = [{ datePublished: '2026-01-01T00:00:00Z', files: [cdnPrimary, hosted] }];
    expect(selectPrimaryFile(versions)?.id).toBe('hosted');
  });

  it('T-UNIT-49 selectPrimaryFile → null with no hosted file anywhere (caller falls back to the Modrinth home)', () => {
    expect(
      selectPrimaryFile([{ datePublished: '2026-01-01T00:00:00Z', files: [cdnPrimary, cdn] }]),
    ).toBeNull();
    expect(selectPrimaryFile([])).toBeNull();
  });

  it('T-UNIT-49 selectPrimaryFile never mutates its input', () => {
    const input = [
      { datePublished: '2025-01-01T00:00:00Z', files: [cdn, hostedPrimary] },
      { datePublished: '2026-01-01T00:00:00Z', files: [cdn] },
    ];
    const snapshot = JSON.parse(JSON.stringify(input)) as unknown;
    selectPrimaryFile(input);
    expect(input).toEqual(snapshot);
  });
});

describe('T-UNIT-48 formatVersionList (ADR-0034 D3)', () => {
  it('T-UNIT-48 collapses neighbouring minors into one range, oldest → newest', () => {
    expect(
      formatVersionList(['1.21.11', '1.21.1', '1.20.4', '1.19', '1.18.2', '1.17.1', '1.17']),
    ).toBe('1.17 – 1.21.11');
  });

  it('T-UNIT-48 breaks the run where a whole minor series is missing', () => {
    expect(formatVersionList(['1.16.5', '1.18', '1.18.2', '1.19.4'])).toBe('1.16.5, 1.18 – 1.19.4');
    expect(formatVersionList(['1.21.4', '1.19.2'])).toBe('1.19.2, 1.21.4');
  });

  it('T-UNIT-48 a single version stays a single version; snapshots follow verbatim', () => {
    expect(formatVersionList(['1.21.4'])).toBe('1.21.4');
    expect(formatVersionList(['24w10a', '1.21', '1.21-pre1'])).toBe('1.21, 24w10a, 1.21-pre1');
  });

  it('T-UNIT-48 dedupes, trims, and returns "" for nothing', () => {
    expect(formatVersionList([' 1.21 ', '1.21', ''])).toBe('1.21');
    expect(formatVersionList([])).toBe('');
  });
});
