/**
 * lib/art.ts — the pure, client-safe half of the art data layer (S1.7; 03 §2.7 `ArtMasonry` /
 * `ArtCard` / `ArtMasonryLightbox` + the `ArtGallery` island; 02 route row `/art`; 00 S1.7 AC6–AC8;
 * ADR-0048).
 *
 * Plain module (no directive, no env, no `server-only`, no zod — ADR-0008): bundled into the
 * `ArtGallery` / `ArtMasonry` client leaves and the `ArtForm` admin island, which may not import
 * `@/lib/data/*` (01 INV-09 Check greps every client file for it). So the prop type `ArtItem` is
 * declared HERE and `lib/data/art.ts` (server-only: the one cached reader `listPublishedArt`, tag
 * `art`) re-exports it with `export type` — the `lib/videos.ts` / `lib/data/videos.ts` split
 * (ADR-0043 D6). `tests/unit/art.test.ts` covers every function.
 *
 * What lives here:
 *   ART_KINDS · ArtKind                     the `art_kind` enum (data-model §2.4), in display order
 *   ArtItem                                 the component prop shape (serialisable: camelCase, public
 *                                           URLs already resolved, natural `width`/`height` — 03 C-19)
 *   ArtFilter · parseArtFilter · applyArtFilter
 *                                           `/art` `?kind=` state (02 §1.1: unknown values fall away)
 *   kindLabel · FIXED_FILTER_KINDS · kindCounts
 *                                           the `FilterBarView` group: ALL / AVATARS / THUMBNAILS /
 *                                           ICONS always, RENDERS / OTHER only when such items exist
 *   artFilename                             `<slug>.<ext>` — the lightbox Download's saved file name
 *
 * Every function is pure: no clock, no I/O, inputs are never mutated. Ordering is locale-free on
 * purpose (01 INV-68 / INV-93) — server and client must agree.
 */

/** `art_kind` (data-model §2.4; 04 §1.5 `createArtInput.kind`) — display order of the filter row. */
export const ART_KINDS = ['avatar', 'thumbnail', 'icon', 'render', 'other'] as const;
export type ArtKind = (typeof ART_KINDS)[number];

/** 03 §2.7 `ArtCard` / `Lightbox` meta prop shape — one published row of `art`. */
export type ArtItem = {
  id: string;
  slug: string;
  title: string;
  kind: ArtKind;
  /** Public object URL of the stored image (`art/<id>/<hash16>.<ext>`). */
  imageUrl: string;
  /** Natural pixel size (server-derived at commit — 04 §1.5); the masonry never crops. */
  width: number;
  height: number;
  year: number | null;
  /** A handle, never a real name (00 S1.7 / CLAUDE.md "no PII"). */
  credit: string | null;
  downloadable: boolean;
  /** `imageUrl + ?download=<slug>.<ext>` when `downloadable`, else `null` (no lightbox button). */
  downloadHref: string | null;
};

/** `/art` filter state — `null` = ALL (03 C-19 serialisable). */
export type ArtFilter = ArtKind | null;

/** The buttons that are always on the row, even at a count of 0 (T-E2E-9 clicks ICONS to reach the empty state). */
export const FIXED_FILTER_KINDS = [
  'avatar',
  'thumbnail',
  'icon',
] as const satisfies readonly ArtKind[];

/** `FilterBar` button words — uppercase IN SOURCE (e2e reads DOM text, not `text-transform`). */
const KIND_LABELS: Record<ArtKind, string> = {
  avatar: 'AVATARS',
  thumbnail: 'THUMBNAILS',
  icon: 'ICONS',
  render: 'RENDERS',
  other: 'OTHER',
};

const KIND_SET: ReadonlySet<string> = new Set<string>(ART_KINDS);
const FIXED_SET: ReadonlySet<string> = new Set<string>(FIXED_FILTER_KINDS);

/** The filter-row word for a kind: `AVATARS` / `THUMBNAILS` / `ICONS` / `RENDERS` / `OTHER`. */
export function kindLabel(kind: ArtKind): string {
  return KIND_LABELS[kind];
}

/** True when `value` is one of `ART_KINDS`. */
export function isArtKind(value: string): value is ArtKind {
  return KIND_SET.has(value);
}

/**
 * Parses `?kind=` (02 §1.1 row `/art` "Query (client-side)") — an unknown or missing value falls
 * away silently to ALL (the `parseProjectFilters` rule; T-E2E-9 `?kind=nonsense` → both cards).
 */
export function parseArtFilter(params: URLSearchParams): ArtFilter {
  const kind = params.get('kind');
  return kind !== null && isArtKind(kind) ? kind : null;
}

/** The `/art` masonry filter (exported pure — the `applyProjectFilters` precedent): order is kept. */
export function applyArtFilter<T extends Pick<ArtItem, 'kind'>>(
  items: readonly T[],
  filter: ArtFilter,
): T[] {
  return filter === null ? [...items] : items.filter((item) => item.kind === filter);
}

/**
 * The `/art` `FilterBarView` group (ADR-0048 D17): AVATARS / THUMBNAILS / ICONS always (a 0 count stays —
 * the row is fixed so the empty state is reachable), RENDERS / OTHER only when at least one such
 * item exists; in `ART_KINDS` order; counted once over the FULL list (never faceted). The caller
 * puts its own ALL (`value: ''`, count = `items.length`) in front. Structurally a `FilterOption[]`
 * (`components/projects/FilterBar.tsx`).
 */
export function kindCounts(
  items: readonly Pick<ArtItem, 'kind'>[],
): { value: ArtKind; label: string; count: number }[] {
  const counts = new Map<ArtKind, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  return ART_KINDS.flatMap((kind) => {
    const count = counts.get(kind) ?? 0;
    return FIXED_SET.has(kind) || count > 0
      ? [{ value: kind, label: KIND_LABELS[kind], count }]
      : [];
  });
}

/**
 * The file name a downloadable piece saves as: `<slug>.<ext>`, `ext` taken from the stored
 * `image_path` (`art/<id>/<hash16>.png|jpg|webp` — 04 SC-21); a path without an extension falls
 * back to `png` (every path the commit writes has one — defensive only).
 */
export function artFilename(slug: string, imagePath: string): string {
  const name = imagePath.slice(imagePath.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return `${slug}.${ext === '' ? 'png' : ext}`;
}
