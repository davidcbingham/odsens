/**
 * tests/unit/filters.test.ts — `lib/validation/filters.ts` `parseProjectFilters` /
 * `serializeFilters` (05 T-UNIT-21; 02 §2.2 `/projects` param table; ADR-0002 #39).
 * Pure — no DOM, no network; the module is zod-free (client island `ProjectGrid` imports it).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROJECT_SORT,
  PROJECT_SORTS,
  QUERY_MAX,
  parseProjectFilters,
  serializeFilters,
  type ProjectFilters,
} from '@/lib/validation/filters';

describe('T-UNIT-21 parseProjectFilters', () => {
  it('T-UNIT-21 parses the catalogue example into the typed object', () => {
    const filters = parseProjectFilters(
      new URLSearchParams('type=mod&version=1.21.x&sort=downloads&q=pipe'),
    );
    expect(filters).toEqual({ type: 'mod', version: '1.21.x', sort: 'downloads', q: 'pipe' });
  });

  it('T-UNIT-21 type is single-select and unknown values are ignored', () => {
    expect(parseProjectFilters(new URLSearchParams('type=zzz')).type).toBeNull();
    expect(parseProjectFilters(new URLSearchParams('type=datapack')).type).toBe('datapack');
    // Record input with a repeated key keeps the first value (single-select).
    expect(parseProjectFilters({ type: ['mod', 'plugin'] }).type).toBe('mod');
  });

  it('T-UNIT-21 sort ∈ {downloads,updated,newest,title}, default downloads, unknown → default', () => {
    expect(PROJECT_SORTS).toEqual(['downloads', 'updated', 'newest', 'title']);
    expect(DEFAULT_PROJECT_SORT).toBe('downloads');
    expect(parseProjectFilters(new URLSearchParams(''))).toEqual({
      type: null,
      version: null,
      sort: 'downloads',
      q: '',
    });
    expect(parseProjectFilters(new URLSearchParams('sort=updated')).sort).toBe('updated');
    expect(parseProjectFilters(new URLSearchParams('sort=zzz')).sort).toBe('downloads');
  });

  it('T-UNIT-21 q is trimmed and capped at 64 chars', () => {
    expect(parseProjectFilters(new URLSearchParams('q=%20pipe%20')).q).toBe('pipe');
    const long = 'x'.repeat(80);
    expect(parseProjectFilters(new URLSearchParams(`q=${long}`)).q).toBe('x'.repeat(QUERY_MAX));
  });

  it('T-UNIT-21 accepts the Next-style record shape too', () => {
    expect(parseProjectFilters({ type: 'plugin', q: 'duck', page: '2' })).toEqual({
      type: 'plugin',
      version: null,
      sort: 'downloads',
      q: 'duck',
    });
  });
});

describe('T-UNIT-21 round-trips through serializeFilters', () => {
  const cases: ProjectFilters[] = [
    { type: 'mod', version: '1.21.x', sort: 'downloads', q: 'pipe' },
    { type: null, version: null, sort: 'downloads', q: '' },
    { type: 'resourcepack', version: 'snapshots', sort: 'title', q: '' },
    { type: null, version: null, sort: 'newest', q: 'metal pipe' },
  ];

  it.each(cases)('T-UNIT-21 parse(serialize(%j)) is identity', (filters) => {
    expect(parseProjectFilters(new URLSearchParams(serializeFilters(filters)))).toEqual(filters);
  });

  it('T-UNIT-21 defaults are omitted (all-default state serializes to the bare URL)', () => {
    expect(serializeFilters({ type: null, version: null, sort: 'downloads', q: '' })).toBe('');
    expect(serializeFilters({ type: 'mod', version: null, sort: 'downloads', q: '' })).toBe(
      'type=mod',
    );
  });

  it('T-UNIT-21 non-default sort is kept', () => {
    expect(serializeFilters({ type: null, version: null, sort: 'title', q: '' })).toBe(
      'sort=title',
    );
  });
});
