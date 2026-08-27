/**
 * lib/validation/filters.ts — `/projects` query-param parsing (02 §2.2 exact param table;
 * 05 T-UNIT-21 `parseProjectFilters` / `serializeFilters`; ADR-0002 #39 sort values + default).
 *
 * Plain, client-safe module — NO zod (ADR-0008 Decision 3): `ProjectGrid` (client island,
 * ADR-0002 A7) reads/writes these params via `useSearchParams` + `router.replace` (RP-02
 * "URL is the state"); the ISR page itself never reads `searchParams` (RP-03).
 *
 * 02 §2.2 params, verbatim: `type` single-select `mod|datapack|resourcepack|plugin` (unknown
 * ignored); `version` = one `groupGameVersions()` value (`1.21.x` / `snapshots`); `sort` ∈
 * `downloads|updated|newest|title`, default `downloads`, unknown → default; `q` free text,
 * trimmed, ≤ 64 chars; `page` not supported.
 */
import { PROJECT_TYPES, type ProjectType } from '@/lib/format/project';

export const PROJECT_SORTS = ['downloads', 'updated', 'newest', 'title'] as const;
export type ProjectSort = (typeof PROJECT_SORTS)[number];

/** ADR-0002 #39 / 02 §2.2: the default sort (prototype "Downloads ▾"). */
export const DEFAULT_PROJECT_SORT: ProjectSort = 'downloads';

export const QUERY_MAX = 64;

/** The typed `/projects` filter state — JSON-serialisable (03 C-19). */
export type ProjectFilters = {
  type: ProjectType | null;
  version: string | null;
  sort: ProjectSort;
  q: string;
};

type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>;

function readParam(input: SearchParamsInput, key: string): string | null {
  if (input instanceof URLSearchParams) return input.get(key);
  const value = input[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

const TYPE_SET: ReadonlySet<string> = new Set<string>(PROJECT_TYPES);
const SORT_SET: ReadonlySet<string> = new Set<string>(PROJECT_SORTS);

/** Parses `?type=&version=&sort=&q=` into `ProjectFilters` — unknown values fall away silently. */
export function parseProjectFilters(searchParams: SearchParamsInput): ProjectFilters {
  const type = readParam(searchParams, 'type');
  const version = readParam(searchParams, 'version')?.trim() ?? null;
  const sort = readParam(searchParams, 'sort');
  const q = readParam(searchParams, 'q') ?? '';
  return {
    type: type !== null && TYPE_SET.has(type) ? (type as ProjectType) : null,
    version: version !== null && version !== '' ? version : null,
    sort: sort !== null && SORT_SET.has(sort) ? (sort as ProjectSort) : DEFAULT_PROJECT_SORT,
    q: q.trim().slice(0, QUERY_MAX),
  };
}

/**
 * The inverse of `parseProjectFilters` (T-UNIT-21 round-trip): a query string WITHOUT the
 * leading `?`, params in the 02 §2.2 order, defaults omitted (`''` when everything is default —
 * the caller drops the `?` entirely then).
 */
export function serializeFilters(filters: ProjectFilters): string {
  const params = new URLSearchParams();
  if (filters.type !== null) params.set('type', filters.type);
  if (filters.version !== null && filters.version !== '') params.set('version', filters.version);
  if (filters.sort !== DEFAULT_PROJECT_SORT) params.set('sort', filters.sort);
  const q = filters.q.trim().slice(0, QUERY_MAX);
  if (q !== '') params.set('q', q);
  return params.toString();
}
