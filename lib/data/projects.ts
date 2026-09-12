/**
 * lib/data/projects.ts — ISR reads for `/`, `/projects`, `/projects/[slug]` (registry Modules
 * `data/<area>.ts`; 02 §2.1/§2.2/§2.3; ADR-0037 D4 `resolveProjectPage`, D6 primary-download
 * rule + per-file href/kind + platform rows, D7 `is_exclusive`).
 *
 * Server-only. Every read runs on the cookie-less anon client (`lib/supabase/anon.ts` — 01
 * INV-13/INV-15: RLS as `anon`, never `cookies()`, never the admin client) against the public
 * view `projects_public` (published, not `overrides.hidden`, `title_override`/
 * `description_override` applied, `downloads_total` computed) plus the child tables anon RLS
 * already scopes to visible projects (05 T-RLS-24/29/34/39). Pages call these functions and
 * never import a Supabase client themselves (01 INV-09/INV-12).
 *
 * Caching per 01 §8 INV-38: reads are wrapped in `unstable_cache` with the registry tags —
 * list/home under `projects`, detail under `projects` + `project:<slug>` (02 §0.3/§5/RP-23) —
 * and `revalidate: 600` matching the pages' `export const revalidate = 600` (02 §0.1), so a
 * sync/curation `revalidateTag` refreshes instantly and everything else catches up within 600 s.
 *
 * Return shapes are the 03 component prop types verbatim (imported `import type` from the
 * components so they cannot drift): `ProjectListItem` (`ProjectGrid`), `ProjectVersion`/
 * `VersionFile` (`VersionsTable`), `GalleryImage` (`Gallery`), `FeaturedHeroProject` minus
 * `isNew` (`FeaturedHero` — the page computes `isNew` via `isNewProject()`, ADR-0002 #41;
 * render code never reads the clock inside the cache).
 *
 * Featured selection (`selectFeatured`) is 02 §2.1 #1/#2 = 00 S1.2.AC7 verbatim: hero = lowest
 * `featured_order` among `project_overrides.featured = true`; 4-up = the NEXT featured by
 * `featured_order` (hero excluded); nothing featured → hero = highest `downloads_total` and
 * 4-up = the next four by `downloads_total`; fewer than 4 → what exists; 0 published → nothing.
 *
 * "One project, many homes" (ADR-0037 D6/D7): a project's files may live in our Storage
 * (`storage_path` — served by `/api/download/<id>`, kind `direct`) and/or on the Modrinth CDN
 * (`url`, kind `modrinth`) on ANY `source`; the primary download is the hosted primary file of
 * the newest version that has one (`selectPrimaryFile`), else the project's Modrinth home
 * (`modrinthHome`: the listing page for `source='modrinth'`, or the `modrinth` link's URL);
 * CDN-only rows are not rendered while `is_exclusive` (no platform home). The badge predicate
 * is the view column `is_exclusive` (D7) — `isExclusive()` stays as its pure twin. Old slugs
 * of folded duplicates resolve through `project_redirects` (`resolveProjectPage`, D4).
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import type { FeaturedHeroProject } from '@/components/projects/FeaturedHero';
import type { GalleryImage } from '@/components/projects/Gallery';
import type { ProjectListItem } from '@/components/projects/ProjectGrid';
import type { ProjectVersion, VersionFile } from '@/components/projects/VersionsTable';
import { env } from '@/lib/env';
import { createAnonClient } from '@/lib/supabase/anon';
import type { Database } from '@/lib/supabase/types';
import { SLUG_RE } from '@/lib/validation/slug';
import { loaderLabel, loaderLabels } from '@/lib/format/loader';
import { modrinthListingUrl } from '@/lib/format/project';
import { groupGameVersions, hostedFirst, selectPrimaryFile, type FileKind } from '@/lib/versions';

export type { ProjectListItem };

type ProjectSource = Database['public']['Enums']['project_source'];
type ProjectType = Database['public']['Enums']['project_type'];
type LinkPlatform = Database['public']['Enums']['link_platform'];

// ---- Cache plumbing — 01 INV-38; tag names verbatim from 02 §0.3 (registry "Cache tags") ----

/** `export const revalidate = 600` on the pages (02 §0.1); the data cache matches it. */
const REVALIDATE_S = 600;
const TAG_PROJECTS = 'projects';
const projectTag = (slug: string): string => `project:${slug}`;

// ---- Pure helpers (unit-testable; no I/O) ----------------------------------------------------

/** ADR-0002 #41: the NEW badge shows while `published_at` is under 30 days old. */
const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * `published_at` < 30 days (ADR-0002 #41; 02 §2.1 #1). The PAGE calls this — never this module's
 * cached readers — so the clock is read at render time, not baked into the data cache
 * (`FeaturedHero` doc: "`isNew` arrives as a prop — the page computes it server-side").
 */
export function isNewProject(publishedAt: string | null, now: number = Date.now()): boolean {
  if (publishedAt === null) return false;
  const time = Date.parse(publishedAt);
  if (Number.isNaN(time)) return false;
  return now - time < NEW_WINDOW_MS;
}

/**
 * Exclusive gate (03 `ExclusiveBadge` row: "gating logic unit-tested in `lib/data/projects.ts`
 * `isExclusive()`"; DESIGN.md §5: "Never on a project that also lives on Modrinth or
 * CurseForge"). `source='odsens'` and no cross-post `project_links` row of any platform.
 *
 * ADR-0037 D7: the reads below take the badge from the `projects_public` column `is_exclusive`
 * (`p.source = 'odsens' and not exists (project_links where project_id = p.id)`) so cards, hero
 * and detail agree without inferring from `source` alone; this function is the SAME predicate
 * in TypeScript — kept for unit parity (05 T-UNIT-36) and for callers that hold a row's links.
 */
export function isExclusive(
  source: ProjectSource,
  links: readonly { platform: string }[] = [],
): boolean {
  return source === 'odsens' && links.length === 0;
}

/** A `project_links` row as the read model needs it (platform + the URL the platform owns). */
export type PlatformLink = { platform: LinkPlatform; url: string };

/**
 * The project's Modrinth home (ADR-0037 D6): a `source='modrinth'` row IS its listing — the
 * page is `modrinthListingUrl(external_id)` (the id, never our normalised slug — ADR-0034 D1);
 * an `odsens` row's home is its `modrinth` link's URL; otherwise none. This is the GET IT
 * "Download on Modrinth" target, the hero DOWNLOAD for a project with no hosted file, and the
 * per-file data-guard fallback.
 */
export function modrinthHome(
  source: ProjectSource,
  externalId: string | null,
  links: readonly PlatformLink[],
): string | null {
  if (source === 'modrinth') return externalId !== null ? modrinthListingUrl(externalId) : null;
  return links.find((link) => link.platform === 'modrinth')?.url ?? null;
}

/**
 * Public-bucket URL for a Storage path that INCLUDES its bucket (04 SC-21 patterns:
 * `project-media/{project_id}/…`). Inline template on purpose — `lib/files.ts` sits behind the
 * admin-client import fence (01 INV-14) and `lib/data/**` must not import it (the same
 * precedent as `app/admin/layout.tsx`'s avatar URL).
 */
export function publicStorageUrl(path: string): string {
  return `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${path}`;
}

/** `icon_url`/gallery values are "Modrinth CDN URL, or Storage path for exclusives" (data-model §2). */
export function resolveMediaUrl(value: string): string {
  return value.startsWith('http://') || value.startsWith('https://')
    ? value
    : publicStorageUrl(value);
}

/**
 * Chip source data for cards / hero / detail header ("version chips", "Chips (versions/
 * loaders)" — 02 §2.1/§2.3; DESIGN.md §5): 03 V-01 version-group labels (newest first, via
 * `groupGameVersions`) followed by the loaders as display names (`loaderLabel`, ADR-0034 D2 —
 * `fabric` → `Fabric`). The platform-noise loaders `minecraft`/`datapack` are dropped — they
 * repeat what the `TypeBadge` already says. The components cap the list themselves (2 on cards,
 * 4 elsewhere — ADR-0002 #54).
 */
const NOISE_LOADERS: ReadonlySet<string> = new Set(['minecraft', 'datapack']);

export function projectChips(
  gameVersions: readonly string[],
  loaders: readonly string[],
): string[] {
  const chips = groupGameVersions(gameVersions).map((group) => group.label);
  for (const loader of loaders) {
    if (NOISE_LOADERS.has(loader)) continue;
    const label = loaderLabel(loader);
    if (!chips.includes(label)) chips.push(label);
  }
  return chips;
}

/** One normalized gallery entry — base `projects.gallery` rows carry `url` + `featured`; admin `extra_gallery` rows carry `path` (04 §1.4). */
export type GalleryEntry = {
  url: string;
  title: string | null;
  description: string | null;
  ordering: number;
  featured: boolean;
};

/**
 * Narrows a `gallery`/`extra_gallery` JSON value (04 §3.1 shape `[{url,title,description,
 * ordering,featured}]`; `extra_gallery` uses `path` instead of `url`) into typed entries.
 * Hand-rolled on purpose — no zod outside action schemas (conventions), and sync-owned JSON is
 * trusted-shape: malformed items are skipped, never thrown on.
 */
export function parseGalleryEntries(json: unknown): GalleryEntry[] {
  if (!Array.isArray(json)) return [];
  const entries: GalleryEntry[] = [];
  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const source = record['url'] ?? record['path'];
    if (typeof source !== 'string' || source === '') continue;
    entries.push({
      url: resolveMediaUrl(source),
      title: typeof record['title'] === 'string' ? record['title'] : null,
      description: typeof record['description'] === 'string' ? record['description'] : null,
      ordering: typeof record['ordering'] === 'number' ? record['ordering'] : entries.length,
      featured: record['featured'] === true,
    });
  }
  return entries;
}

/**
 * `gallery` ∪ `overrides.extra_gallery`, featured first (02 §2.3 #2), then `ordering`, base
 * entries before extras on ties (stable sort). Output is the `Gallery` prop shape — `alt` is
 * mandatory (03), so untitled images fall back to "<title> screenshot N".
 */
export function mergeGallery(base: unknown, extra: unknown, projectTitle: string): GalleryImage[] {
  const entries = [...parseGalleryEntries(base), ...parseGalleryEntries(extra)].sort(
    (a, b) => Number(b.featured) - Number(a.featured) || a.ordering - b.ordering,
  );
  return entries.map((entry, index) => ({
    url: entry.url,
    alt: entry.title ?? `${projectTitle} screenshot ${index + 1}`,
    ...(entry.description !== null ? { caption: entry.description } : {}),
  }));
}

/**
 * Hero right-rail image (02 §2.1 #1): "featured gallery image, else first gallery image, else
 * icon in a well". `gallery` is already featured-first (`mergeGallery`), so its head is both.
 */
export function pickScreenshot(
  gallery: readonly GalleryImage[],
  iconUrl: string | null,
  projectTitle: string,
): { url: string; alt: string } | null {
  const first = gallery[0];
  if (first !== undefined) return { url: first.url, alt: first.alt };
  if (iconUrl !== null) return { url: iconUrl, alt: `${projectTitle} icon` };
  return null;
}

/** The fields `selectFeatured` orders on — generic so the pure rule is testable without rows. */
export type FeaturedCandidate = {
  slug: string;
  featured: boolean;
  featuredOrder: number | null;
  downloadsTotal: number;
};

/**
 * 02 §2.1 #1/#2 = 00 S1.2.AC7 (00-O-3 DECIDED), verbatim:
 * - hero = the published, non-hidden project with `overrides.featured = true` and the LOWEST
 *   `featured_order`; none featured → the one with the highest `downloads_total`;
 * - next = when anything is featured, the next featured by `featured_order` (hero excluded —
 *   NO back-fill from unfeatured rows: the seed renders `seed-exclusive-pack` alone, 05
 *   T-E2E-1); when nothing is featured, the next `limit` by `downloads_total`;
 * - fewer than `limit` → what exists; zero rows → `{hero: null, next: []}`.
 * Ties: `featured_order` nulls last, then `downloads_total` desc, then slug (locale-free —
 * 01 INV-68/INV-93 precedent in `ProjectGrid`).
 */
export function selectFeatured<T extends FeaturedCandidate>(
  rows: readonly T[],
  limit = 4,
): { hero: T | null; next: T[] } {
  const bySlug = (a: T, b: T): number => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const featured = rows
    .filter((row) => row.featured)
    .sort(
      (a, b) =>
        (a.featuredOrder ?? Number.POSITIVE_INFINITY) -
          (b.featuredOrder ?? Number.POSITIVE_INFINITY) ||
        b.downloadsTotal - a.downloadsTotal ||
        bySlug(a, b),
    );
  const pool =
    featured.length > 0
      ? featured
      : [...rows].sort((a, b) => b.downloadsTotal - a.downloadsTotal || bySlug(a, b));
  return { hero: pool[0] ?? null, next: pool.slice(1, 1 + limit) };
}

// ---- Row mapping -----------------------------------------------------------------------------

type ProjectsPublicRow = Database['public']['Views']['projects_public']['Row'];

type ListRow = Pick<
  ProjectsPublicRow,
  | 'slug'
  | 'title'
  | 'description'
  | 'icon_url'
  | 'project_type'
  | 'source'
  | 'loaders'
  | 'game_versions'
  | 'downloads_total'
  | 'external_updated_at'
  | 'published_at'
  | 'is_exclusive'
>;

// NOTE: select strings must stay single literals — concatenation widens them to `string` and
// supabase-js's typed query parser then returns `GenericStringError` rows.
const LIST_SELECT =
  'slug, title, description, icon_url, project_type, source, loaders, game_versions, downloads_total, external_updated_at, published_at, is_exclusive';

/** View columns are all nullable in the generated types; rows missing identity fields are skipped. */
function toListItem(row: ListRow): ProjectListItem | null {
  if (row.slug === null || row.title === null || row.project_type === null || row.source === null)
    return null;
  const gameVersions = row.game_versions ?? [];
  const loaders = row.loaders ?? [];
  return {
    slug: row.slug,
    title: row.title,
    description: row.description ?? '',
    iconUrl: row.icon_url !== null ? resolveMediaUrl(row.icon_url) : null,
    type: row.project_type,
    chips: projectChips(gameVersions, loaders),
    downloadsTotal: row.downloads_total ?? 0,
    exclusive: row.is_exclusive === true, // the view column (ADR-0037 D7), never `source` alone
    gameVersions,
    externalUpdatedAt: row.external_updated_at,
    publishedAt: row.published_at,
  };
}

export type RawFile = {
  id: string;
  filename: string;
  size_bytes: number;
  sha512: string | null;
  url: string | null;
  storage_path: string | null;
  primary: boolean;
};

export type RawVersion = {
  id: string;
  version_number: string;
  name: string | null;
  changelog_md: string | null;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  project_files: RawFile[];
};

/** ADR-0037 D6, per file: hosted (`storage_path` set) → `direct`; CDN-only → `modrinth`. */
export function fileKind(file: Pick<RawFile, 'storage_path'>): FileKind {
  return file.storage_path !== null ? 'direct' : 'modrinth';
}

/**
 * Download href per file (02 §2.3 #4 as amended by ADR-0037 D6; 01 INV-55; ADR-0002 #42):
 * hosted → `/api/download/<file id>` on ANY source; CDN-only → `project_files.url`, falling
 * back to the project's Modrinth home when a synced row somehow has no URL (data guard).
 * `null` only for a CDN-only row with no URL on a project with no Modrinth home — nothing to
 * link, so the caller drops the row (never an empty href).
 */
export function fileHref(
  file: Pick<RawFile, 'id' | 'url' | 'storage_path'>,
  modrinthHomeUrl: string | null,
): string | null {
  if (file.storage_path !== null) return `/api/download/${file.id}`;
  return file.url ?? modrinthHomeUrl;
}

/** Everything `projectVersions` / `pickPrimaryFile` need to know about the project itself. */
export type VersionContext = {
  /** `modrinthHome()` — the per-file fallback and the primary's fallback target. */
  modrinthHomeUrl: string | null;
  /** `is_exclusive` (ADR-0037 D7): CDN-only rows are not rendered while true (D6). */
  exclusive: boolean;
};

/** A file with its computed `href`/`kind` — `VersionFile` plus the raw columns the panel shows. */
type ResolvedFile = VersionFile & Pick<RawFile, 'sha512'>;

/**
 * The renderable files of one version (ADR-0037 D6): each with `href` + `kind`; CDN-only rows
 * dropped while the project `is_exclusive` (an unlinked odsens project lists hosted files only,
 * so the badge stays a true statement after an unlink — the rows come back when it is linked
 * again); rows that would have no href dropped (data guard). Order is left to `hostedFirst`.
 */
function resolveFiles(files: readonly RawFile[], context: VersionContext): ResolvedFile[] {
  const resolved: ResolvedFile[] = [];
  for (const file of files) {
    const kind = fileKind(file);
    if (kind === 'modrinth' && context.exclusive) continue;
    const href = fileHref(file, context.modrinthHomeUrl);
    if (href === null) continue;
    resolved.push({
      id: file.id,
      filename: file.filename,
      sizeBytes: file.size_bytes,
      href,
      kind,
      primary: file.primary,
      sha512: file.sha512,
    });
  }
  return resolved;
}

function toVersion(raw: RawVersion, files: readonly VersionFile[]): ProjectVersion {
  return {
    id: raw.id,
    versionNumber: raw.version_number,
    ...(raw.name !== null ? { name: raw.name } : {}),
    gameVersions: raw.game_versions,
    loaders: loaderLabels(raw.loaders), // display names (ADR-0034 D2)
    datePublished: raw.date_published,
    changelogMd: raw.changelog_md,
    files: files.map(({ id, filename, sizeBytes, href, kind, primary }) => ({
      id,
      filename,
      sizeBytes,
      href,
      kind,
      primary,
    })),
  };
}

/**
 * `VersionsTable` props for a project's raw versions (ADR-0037 D6; 05 T-UNIT-49): per-file
 * `href`/`kind` via `resolveFiles`; a version left with no renderable file is dropped (nothing
 * to list — the table would otherwise render an empty group). The component orders the result
 * (`sortVersionsForTable`, 05 T-UNIT-30).
 */
export function projectVersions(
  versions: readonly RawVersion[],
  context: VersionContext,
): ProjectVersion[] {
  return versions.flatMap((raw) => {
    const files = resolveFiles(raw.project_files, context);
    return files.length > 0 ? [toVersion(raw, files)] : [];
  });
}

/** The GET IT / hero primary (ADR-0037 D6) — a resolved file plus which rule chose it. */
export type PrimaryPick = { file: ResolvedFile; kind: FileKind };

/**
 * The primary-download rule (ADR-0037 D6; 02 §2.1 #1, §2.3 rail; 05 T-UNIT-49), in order:
 * 1. `selectPrimaryFile` — the hosted primary of the newest version with a hosted file
 *    (`kind: 'direct'`, href `/api/download/<id>`) — on ANY source;
 * 2. none, and the project has a Modrinth home → `kind: 'modrinth'`: the newest version's
 *    first file in `hostedFirst` order (today's rule verbatim — its meta is what the panel
 *    shows under "Download on Modrinth"; the button itself targets the home page);
 * 3. no home and no hosted file → `null` (the S1.3 degrade: no panel; unreachable for a
 *    published odsens row, whose publish precondition needs a hosted file).
 * Hidden CDN-only rows (`exclusive`) never reach step 2 — an exclusive has no home.
 */
export function pickPrimaryFile(
  versions: readonly RawVersion[],
  context: VersionContext,
): PrimaryPick | null {
  const resolved = versions.map((raw) => ({
    datePublished: raw.date_published,
    files: resolveFiles(raw.project_files, context),
  }));
  const hosted = selectPrimaryFile(resolved);
  if (hosted !== null) return { file: hosted, kind: 'direct' };
  if (context.modrinthHomeUrl === null) return null;
  const newest = resolved
    .filter((version) => version.files.length > 0)
    .sort((a, b) => Date.parse(b.datePublished) - Date.parse(a.datePublished))[0];
  const first = newest !== undefined ? hostedFirst(newest.files)[0] : undefined;
  return first !== undefined ? { file: first, kind: 'modrinth' } : null;
}

/** GET IT panel row source (02 §2.3 rail; ADR-0037 D6): the project's platform homes. */
export type ProjectLinkItem = {
  platform: LinkPlatform;
  url: string;
  downloads: number;
};

/**
 * "Also on" rows (ADR-0037 D6; 00 S1.5a.AC6) from `project_links` OR `source`: a
 * `source='modrinth'` row contributes a Modrinth row (`modrinthListingUrl(external_id)`, count
 * `downloads_modrinth`); each `project_links` row contributes its `url` with the project's
 * count for that platform (`downloads_modrinth` / `downloads_curseforge` — the columns the sync
 * writes alongside the link, so the rows always sum to `downloads_total`). Modrinth first,
 * then CurseForge (the S1.2 order); one row per platform.
 */
export function platformRows(
  source: ProjectSource,
  externalId: string | null,
  links: readonly PlatformLink[],
  downloads: { modrinth: number; curseforge: number },
): ProjectLinkItem[] {
  const rows = new Map<LinkPlatform, ProjectLinkItem>();
  if (source === 'modrinth' && externalId !== null) {
    rows.set('modrinth', {
      platform: 'modrinth',
      url: modrinthListingUrl(externalId),
      downloads: downloads.modrinth,
    });
  }
  for (const link of links) {
    if (rows.has(link.platform)) continue;
    rows.set(link.platform, {
      platform: link.platform,
      url: link.url,
      downloads: link.platform === 'modrinth' ? downloads.modrinth : downloads.curseforge,
    });
  }
  return (['modrinth', 'curseforge'] as const).flatMap((platform) => rows.get(platform) ?? []);
}

// ---- /projects — 02 §2.2 ---------------------------------------------------------------------

async function fetchProjectList(): Promise<ProjectListItem[]> {
  const { data, error } = await createAnonClient()
    .from('projects_public')
    .select(LIST_SELECT)
    .order('downloads_total', { ascending: false })
    .order('slug', { ascending: true });
  if (error) throw new Error(`lib/data/projects: list read failed — ${error.message}`);
  return data.flatMap((row) => toListItem(row) ?? []);
}

/**
 * All published, non-hidden projects (`projects_public`), ordered `downloads_total` desc — the
 * full list `/projects` passes to `ProjectGrid` (02 §2.2; the island filters/sorts client-side,
 * RP-02), and the slug source for `generateStaticParams` / `app/sitemap.ts` (02 §2.3, RP-07).
 * Cached under tag `projects` (01 INV-38).
 */
export const listPublishedProjects = unstable_cache(fetchProjectList, ['data-projects-list'], {
  revalidate: REVALIDATE_S,
  tags: [TAG_PROJECTS],
});

// ---- /projects/[slug] — 02 §2.3 --------------------------------------------------------------

export type ProjectDetail = {
  id: string;
  slug: string;
  /** `title_override ?? title`, applied by the view (RP-08). */
  title: string;
  description: string;
  bodyMd: string;
  iconUrl: string | null;
  type: ProjectType;
  source: ProjectSource;
  /** The view's `is_exclusive` (ADR-0037 D7): `odsens` with no `project_links` row. */
  exclusive: boolean;
  /** Full chip list (versions then loaders); header caps at 4 (ADR-0002 #54). */
  chips: string[];
  gameVersions: string[];
  loaders: string[];
  categories: string[];
  license: string | null;
  sourceUrl: string | null;
  issuesUrl: string | null;
  discordUrl: string | null;
  followers: number;
  downloads: { modrinth: number; curseforge: number; direct: number; total: number };
  publishedAt: string | null;
  /** `DetailsList` "updated" = `external_updated_at ?? updated_at` (02 §2.3 rail). */
  externalUpdatedAt: string | null;
  updatedAt: string | null;
  /** `gallery` ∪ `overrides.extra_gallery`, featured first (02 §2.3 #2) — `Gallery` props. */
  gallery: GalleryImage[];
  /** OG image: the gallery entry marked `featured`, else null → page uses the default (RP-06). */
  ogImage: string | null;
  /**
   * `VersionsTable` props (per-file `href`/`kind` computed by `projectVersions`; CDN-only rows
   * hidden while `exclusive` — ADR-0037 D6; the component orders them, 05 T-UNIT-30).
   */
  versions: ProjectVersion[];
  /** GET IT platform rows (`platformRows`): from `project_links` or `source` (ADR-0037 D6). */
  links: ProjectLinkItem[];
  /** The project's Modrinth home (`modrinthHome`) — "Download on Modrinth" target. Null = none. */
  modrinthUrl: string | null;
  /**
   * The primary download per ADR-0037 D6 (`pickPrimaryFile`): `kind: 'direct'` = the hosted
   * primary of the newest version with a hosted file (`href` `/api/download/<id>` — the GET IT
   * primary and the hero DOWNLOAD on any source); `kind: 'modrinth'` = the newest version's
   * CDN file, whose meta the panel shows under "Download on Modrinth" (the button targets
   * `modrinthUrl`). Null when the project has neither a hosted file nor a Modrinth home.
   */
  primaryFile: {
    id: string;
    filename: string;
    sizeBytes: number;
    sha512: string | null;
    gameVersions: string[];
    loaders: string[];
    href: string;
    kind: FileKind;
  } | null;
  /** `overrides.notes_md` — second ABOUT block under a `NoteCallout` (02 §2.3 #3). */
  notesMd: string | null;
  /**
   * Raw `overrides.comments_enabled`; null when the project has no overrides row. The page
   * computes `commentsEnabled = coalesce(this, not site_settings_public.comments_closed_default)`
   * (02 §2.3) with `lib/data/settings.ts` once comments land (S1.4).
   */
  commentsEnabledOverride: boolean | null;
};

const DETAIL_SELECT =
  'id, slug, title, description, body_md, icon_url, project_type, source, external_id, is_exclusive, gallery, categories, loaders, game_versions, license, source_url, issues_url, discord_url, followers, downloads_modrinth, downloads_curseforge, downloads_direct, downloads_total, published_at, external_updated_at, updated_at, project_versions ( id, version_number, name, changelog_md, game_versions, loaders, date_published, project_files ( id, filename, size_bytes, sha512, url, storage_path, primary ) ), project_links ( platform, url, downloads ), project_overrides ( notes_md, comments_enabled, extra_gallery )';

async function fetchProjectDetail(slug: string): Promise<ProjectDetail | null> {
  const { data, error } = await createAnonClient()
    .from('projects_public')
    .select(DETAIL_SELECT)
    .eq('slug', slug)
    .maybeSingle();
  if (error) throw new Error(`lib/data/projects: detail read failed — ${error.message}`);
  if (data === null) return null;
  const row = data;
  if (
    row.id === null ||
    row.slug === null ||
    row.title === null ||
    row.project_type === null ||
    row.source === null
  )
    return null;

  const source = row.source;
  const overrides = row.project_overrides;
  const gallery = mergeGallery(row.gallery, overrides?.extra_gallery ?? null, row.title);
  const featuredEntry = [
    ...parseGalleryEntries(row.gallery),
    ...parseGalleryEntries(overrides?.extra_gallery ?? null),
  ].find((entry) => entry.featured);
  const versions: RawVersion[] = row.project_versions;
  const gameVersions = row.game_versions ?? [];
  const loaders = row.loaders ?? [];
  const downloads = {
    modrinth: row.downloads_modrinth ?? 0,
    curseforge: row.downloads_curseforge ?? 0,
    direct: row.downloads_direct ?? 0,
    total: row.downloads_total ?? 0,
  };
  // ADR-0037 D6/D7: the home, the badge and the file rules all derive from source + links.
  const exclusive = row.is_exclusive === true;
  const modrinthUrl = modrinthHome(source, row.external_id, row.project_links);
  const context: VersionContext = { modrinthHomeUrl: modrinthUrl, exclusive };
  const primary = pickPrimaryFile(versions, context);

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description ?? '',
    bodyMd: row.body_md ?? '',
    iconUrl: row.icon_url !== null ? resolveMediaUrl(row.icon_url) : null,
    type: row.project_type,
    source,
    exclusive,
    chips: projectChips(gameVersions, loaders),
    gameVersions,
    loaders,
    categories: row.categories ?? [],
    license: row.license,
    sourceUrl: row.source_url,
    issuesUrl: row.issues_url,
    discordUrl: row.discord_url,
    followers: row.followers ?? 0,
    downloads,
    publishedAt: row.published_at,
    externalUpdatedAt: row.external_updated_at,
    updatedAt: row.updated_at,
    gallery,
    ogImage: featuredEntry?.url ?? null,
    versions: projectVersions(versions, context),
    links: platformRows(source, row.external_id, row.project_links, downloads),
    modrinthUrl,
    primaryFile:
      primary !== null
        ? {
            id: primary.file.id,
            filename: primary.file.filename,
            sizeBytes: primary.file.sizeBytes,
            sha512: primary.file.sha512,
            gameVersions,
            loaders: loaderLabels(loaders), // display names (ADR-0034 D2)
            href: primary.file.href,
            kind: primary.kind,
          }
        : null,
    notesMd: overrides?.notes_md ?? null,
    commentsEnabledOverride: overrides?.comments_enabled ?? null,
  };
}

/**
 * One read per detail page, keyed by slug (02 §2.3 "Data (ISR shell)"): `projects_public` row +
 * `project_versions` × `project_files` + `project_links` + `project_overrides` in a single
 * embedded select. Unknown, draft or hidden slug → the view has no row → `null` → the page
 * calls `notFound()` (02 §2.3). Malformed slugs short-circuit before touching cache or DB.
 * Cached under `projects` + `project:<slug>` (01 INV-38; 02 §5).
 */
export function getProjectDetail(slug: string): Promise<ProjectDetail | null> {
  if (!SLUG_RE.test(slug)) return Promise.resolve(null);
  return unstable_cache(() => fetchProjectDetail(slug), ['data-projects-detail', slug], {
    revalidate: REVALIDATE_S,
    tags: [TAG_PROJECTS, projectTag(slug)],
  })();
}

/**
 * The canonical slug an old (folded) slug now points at, or `null` (ADR-0037 D4): a
 * `project_redirects` row (anon RLS: visible-or-admin, so a draft/hidden target reads as no
 * row) followed by the canonical row's live slug from `projects_public` (the view gates
 * published + not hidden a second time; a target that is not visible → `null` → 404, never a
 * redirect to a page that would 404). Two small reads, both on the anon client.
 */
async function fetchProjectRedirect(oldSlug: string): Promise<string | null> {
  const client = createAnonClient();
  const { data: redirect, error } = await client
    .from('project_redirects')
    .select('project_id')
    .eq('old_slug', oldSlug)
    .maybeSingle();
  if (error) throw new Error(`lib/data/projects: redirect read failed — ${error.message}`);
  if (redirect === null) return null;
  const { data: target, error: targetError } = await client
    .from('projects_public')
    .select('slug')
    .eq('id', redirect.project_id)
    .maybeSingle();
  if (targetError)
    throw new Error(`lib/data/projects: redirect target read failed — ${targetError.message}`);
  return target?.slug ?? null;
}

/** What `/projects/[slug]` should do (ADR-0037 D4): render, redirect, or `notFound()`. */
export type ProjectPageResolution =
  { kind: 'detail'; detail: ProjectDetail } | { kind: 'redirect'; slug: string } | null;

/**
 * `/projects/[slug]` resolution (ADR-0037 D4; 02 §2.3 "Not found"): a live `projects.slug`
 * always wins (`getProjectDetail` first); otherwise a `project_redirects` row whose canonical
 * project is visible → `{kind:'redirect', slug}` and the page issues
 * `permanentRedirect('/projects/<slug>')` — from BOTH `generateMetadata` and the page body,
 * since metadata runs first; nothing → `null` → `notFound()`. The redirect read is cached under
 * `projects` + `project:<old slug>` (the fold's action revalidates `project:<redirect_slug>`).
 * A slug that is the live slug of nothing and redirects to itself cannot occur (the fold never
 * writes a redirect for a slug a live row holds), and malformed slugs short-circuit.
 */
export async function resolveProjectPage(slug: string): Promise<ProjectPageResolution> {
  if (!SLUG_RE.test(slug)) return null;
  const detail = await getProjectDetail(slug);
  if (detail !== null) return { kind: 'detail', detail };
  const target = await unstable_cache(
    () => fetchProjectRedirect(slug),
    ['data-projects-redirect', slug],
    { revalidate: REVALIDATE_S, tags: [TAG_PROJECTS, projectTag(slug)] },
  )();
  if (target === null || target === slug) return null;
  return { kind: 'redirect', slug: target };
}

// ---- / (home) — 02 §2.1 #1/#2 ----------------------------------------------------------------

/**
 * `FeaturedHero`'s `project` prop minus `isNew`, plus the raw `published_at`: the page renders
 * `{ ...hero, isNew: isNewProject(hero.publishedAt) }` (ADR-0002 #41 — clock at render time).
 */
export type HomeHero = Omit<FeaturedHeroProject, 'isNew'> & { publishedAt: string | null };

export type HomeFeatured = {
  hero: HomeHero | null;
  /** Hero right rail 16:9 (02 §2.1 #1): featured gallery image → first image → icon → null. */
  screenshot: { url: string; alt: string } | null;
  /** Featured 4-up (02 §2.1 #2), `ProjectCard`-ready. Empty + null hero → 0 published projects. */
  featured: ProjectListItem[];
};

type HomeRow = ListRow &
  Pick<ProjectsPublicRow, 'id' | 'gallery' | 'external_id'> & {
    project_overrides: { featured: boolean; featured_order: number | null } | null;
    project_links: PlatformLink[];
  };

const HOME_SELECT =
  'slug, title, description, icon_url, project_type, source, loaders, game_versions, downloads_total, external_updated_at, published_at, is_exclusive, id, gallery, external_id, project_overrides ( featured, featured_order ), project_links ( platform, url )';

async function fetchHomeFeatured(): Promise<HomeFeatured> {
  const client = createAnonClient();
  const { data, error } = await client.from('projects_public').select(HOME_SELECT);
  if (error) throw new Error(`lib/data/projects: home read failed — ${error.message}`);

  const candidates = (data satisfies HomeRow[]).flatMap((row) => {
    const item = toListItem(row);
    if (item === null || row.id === null || row.source === null) return [];
    return [
      {
        slug: item.slug,
        featured: row.project_overrides?.featured ?? false,
        featuredOrder: row.project_overrides?.featured_order ?? null,
        downloadsTotal: item.downloadsTotal,
        id: row.id,
        source: row.source,
        externalId: row.external_id,
        links: row.project_links,
        gallery: row.gallery,
        item,
      },
    ];
  });

  const { hero: heroRow, next } = selectFeatured(candidates);
  if (heroRow === null) return { hero: null, screenshot: null, featured: [] };

  // Hero DOWNLOAD (02 §2.1 #1 as amended by ADR-0037 D6) — the same rule as the GET IT primary
  // (`pickPrimaryFile`): the hosted primary of the newest version with a hosted file, on any
  // source (`direct`, `/api/download/<id>`); else the project's Modrinth home (`modrinth`);
  // neither → `downloadKind: null` and the project page: the hero renders no DOWNLOAD and fires
  // no `download` event (a broken publish invariant, 04 — the GET IT panel degrades the same way).
  const { data: versionRows, error: versionsError } = await client
    .from('project_versions')
    .select(
      'id, version_number, name, changelog_md, game_versions, loaders, date_published, project_files ( id, filename, size_bytes, sha512, url, storage_path, primary )',
    )
    .eq('project_id', heroRow.id);
  if (versionsError)
    throw new Error(`lib/data/projects: hero versions read failed — ${versionsError.message}`);
  const heroHome = modrinthHome(heroRow.source, heroRow.externalId, heroRow.links);
  const heroPrimary = pickPrimaryFile(versionRows satisfies RawVersion[], {
    modrinthHomeUrl: heroHome,
    exclusive: heroRow.item.exclusive,
  });
  let downloadHref = `/projects/${heroRow.slug}`;
  let downloadKind: FileKind | null = null;
  if (heroPrimary?.kind === 'direct') {
    downloadKind = 'direct';
    downloadHref = heroPrimary.file.href;
  } else if (heroHome !== null) {
    downloadKind = 'modrinth';
    downloadHref = heroHome;
  }

  const heroItem = heroRow.item;
  const heroGallery = mergeGallery(heroRow.gallery, null, heroItem.title);
  return {
    hero: {
      slug: heroItem.slug,
      title: heroItem.title,
      description: heroItem.description,
      type: heroItem.type,
      exclusive: heroItem.exclusive,
      chips: heroItem.chips,
      downloadHref,
      downloadKind,
      publishedAt: heroItem.publishedAt,
    },
    screenshot: pickScreenshot(heroGallery, heroItem.iconUrl, heroItem.title),
    featured: next.map((row) => row.item),
  };
}

/**
 * Home hero + Featured 4-up per 02 §2.1 #1/#2 (00 S1.2.AC7): `selectFeatured` over every
 * published project joined with its `project_overrides`. Cached under tag `projects`
 * (01 INV-38; Home's other tags — `videos`, `mentions` — belong to their own data modules,
 * 02 RP-23).
 */
export const getHomeFeatured = unstable_cache(fetchHomeFeatured, ['data-projects-home'], {
  revalidate: REVALIDATE_S,
  tags: [TAG_PROJECTS],
});
