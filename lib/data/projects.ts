/**
 * lib/data/projects.ts — ISR reads for `/`, `/projects`, `/projects/[slug]` (registry Modules
 * `data/<area>.ts`; 02 §2.1/§2.2/§2.3).
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
import { groupGameVersions, primaryFirst } from '@/lib/versions';

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
 * CurseForge"). `source='odsens'` and, when the caller has them, no cross-post `project_links`.
 * List reads carry no links, so their cards use the source alone; the dedicated predicate test
 * (05 T-UNIT-36) lands with the badge in S1.3.
 */
export function isExclusive(
  source: ProjectSource,
  links: readonly { platform: string }[] = [],
): boolean {
  return source === 'odsens' && links.length === 0;
}

/**
 * Canonical Modrinth project page for a synced project — the hero DOWNLOAD target and the
 * GET IT panel's Modrinth link (02 §2.1 #1 "synced: Modrinth project URL"; §2.3 rail). The
 * type-neutral `/project/<slug>` path is used because our `project_type` is remapped from
 * Modrinth's (04 §5.2 P1–P5, e.g. `mod`+`paper` → `plugin`), so a typed path could be wrong;
 * `/project/` resolves for every type. Modrinth slugs mirror ours (`syncModrinth` copies them).
 */
export function modrinthProjectUrl(slug: string): string {
  return `https://modrinth.com/project/${slug}`;
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
 * `groupGameVersions`) followed by the loaders verbatim. The platform-noise loaders
 * `minecraft`/`datapack` are dropped — they repeat what the `TypeBadge` already says. The
 * components cap the list themselves (2 on cards, 4 elsewhere — ADR-0002 #54).
 */
const NOISE_LOADERS: ReadonlySet<string> = new Set(['minecraft', 'datapack']);

export function projectChips(
  gameVersions: readonly string[],
  loaders: readonly string[],
): string[] {
  const chips = groupGameVersions(gameVersions).map((group) => group.label);
  for (const loader of loaders) {
    if (!NOISE_LOADERS.has(loader) && !chips.includes(loader)) chips.push(loader);
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
>;

// NOTE: select strings must stay single literals — concatenation widens them to `string` and
// supabase-js's typed query parser then returns `GenericStringError` rows.
const LIST_SELECT =
  'slug, title, description, icon_url, project_type, source, loaders, game_versions, downloads_total, external_updated_at, published_at';

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
    exclusive: isExclusive(row.source),
    gameVersions,
    externalUpdatedAt: row.external_updated_at,
    publishedAt: row.published_at,
  };
}

type RawFile = {
  id: string;
  filename: string;
  size_bytes: number;
  sha512: string | null;
  url: string | null;
  storage_path: string | null;
  primary: boolean;
};

type RawVersion = {
  id: string;
  version_number: string;
  name: string | null;
  changelog_md: string | null;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  project_files: RawFile[];
};

/**
 * Download href per file (02 §2.3 #4, ADR-0002 #42): exclusive (`source='odsens'`) →
 * `/api/download/<file id>` (route ships in S1.3; the href shape is fixed now); synced → the
 * Modrinth CDN `project_files.url`, falling back to the project's Modrinth page when a synced
 * row somehow has no URL (data guard — never an empty href).
 */
function fileHref(source: ProjectSource, slug: string, file: RawFile): string {
  if (source === 'odsens') return `/api/download/${file.id}`;
  return file.url ?? modrinthProjectUrl(slug);
}

function toVersion(source: ProjectSource, slug: string, raw: RawVersion): ProjectVersion {
  const files: VersionFile[] = raw.project_files.map((file) => ({
    id: file.id,
    filename: file.filename,
    sizeBytes: file.size_bytes,
    href: fileHref(source, slug, file),
    primary: file.primary,
  }));
  return {
    id: raw.id,
    versionNumber: raw.version_number,
    ...(raw.name !== null ? { name: raw.name } : {}),
    gameVersions: raw.game_versions,
    loaders: raw.loaders,
    datePublished: raw.date_published,
    changelogMd: raw.changelog_md,
    files,
  };
}

/** Newest version (by `date_published`, 05 T-UNIT-30 order) → its primary-first file. */
function latestPrimaryFile(versions: readonly RawVersion[]): RawFile | null {
  const withFiles = versions.filter((version) => version.project_files.length > 0);
  const latest = withFiles.sort(
    (a, b) => Date.parse(b.date_published) - Date.parse(a.date_published),
  )[0];
  if (latest === undefined) return null;
  return primaryFirst(latest.project_files)[0] ?? null;
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

/** GET IT panel row source (02 §2.3 rail): the project's cross-post links. */
export type ProjectLinkItem = {
  platform: LinkPlatform;
  url: string;
  downloads: number;
};

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
  /** `VersionsTable` props (hrefs computed; the component orders them, 05 T-UNIT-30). */
  versions: ProjectVersion[];
  links: ProjectLinkItem[];
  /** Synced projects: the Modrinth page (GET IT primary + Modrinth row). Null for exclusives. */
  modrinthUrl: string | null;
  /**
   * Latest version's primary file with its computed `href` — the GET IT primary for exclusives
   * (file meta per 03 `GetItPanel`) and the hero direct download. Null when no files exist.
   */
  primaryFile: {
    id: string;
    filename: string;
    sizeBytes: number;
    sha512: string | null;
    gameVersions: string[];
    loaders: string[];
    href: string;
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
  'id, slug, title, description, body_md, icon_url, project_type, source, gallery, categories, loaders, game_versions, license, source_url, issues_url, discord_url, followers, downloads_modrinth, downloads_curseforge, downloads_direct, downloads_total, published_at, external_updated_at, updated_at, project_versions ( id, version_number, name, changelog_md, game_versions, loaders, date_published, project_files ( id, filename, size_bytes, sha512, url, storage_path, primary ) ), project_links ( platform, url, downloads ), project_overrides ( notes_md, comments_enabled, extra_gallery )';

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
  const primary = latestPrimaryFile(versions);
  const gameVersions = row.game_versions ?? [];
  const loaders = row.loaders ?? [];
  const links: ProjectLinkItem[] = row.project_links.map((link) => ({
    platform: link.platform,
    url: link.url,
    downloads: link.downloads,
  }));

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description ?? '',
    bodyMd: row.body_md ?? '',
    iconUrl: row.icon_url !== null ? resolveMediaUrl(row.icon_url) : null,
    type: row.project_type,
    source: row.source,
    exclusive: isExclusive(row.source, links),
    chips: projectChips(gameVersions, loaders),
    gameVersions,
    loaders,
    categories: row.categories ?? [],
    license: row.license,
    sourceUrl: row.source_url,
    issuesUrl: row.issues_url,
    discordUrl: row.discord_url,
    followers: row.followers ?? 0,
    downloads: {
      modrinth: row.downloads_modrinth ?? 0,
      curseforge: row.downloads_curseforge ?? 0,
      direct: row.downloads_direct ?? 0,
      total: row.downloads_total ?? 0,
    },
    publishedAt: row.published_at,
    externalUpdatedAt: row.external_updated_at,
    updatedAt: row.updated_at,
    gallery,
    ogImage: featuredEntry?.url ?? null,
    versions: versions.map((version) => toVersion(source, slug, version)),
    links,
    modrinthUrl: row.source === 'modrinth' ? modrinthProjectUrl(row.slug) : null,
    primaryFile:
      primary !== null
        ? {
            id: primary.id,
            filename: primary.filename,
            sizeBytes: primary.size_bytes,
            sha512: primary.sha512,
            gameVersions,
            loaders,
            href: fileHref(row.source, row.slug, primary),
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
  Pick<ProjectsPublicRow, 'id' | 'gallery'> & {
    project_overrides: { featured: boolean; featured_order: number | null } | null;
  };

const HOME_SELECT =
  'slug, title, description, icon_url, project_type, source, loaders, game_versions, downloads_total, external_updated_at, published_at, id, gallery, project_overrides ( featured, featured_order )';

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
        gallery: row.gallery,
        item,
      },
    ];
  });

  const { hero: heroRow, next } = selectFeatured(candidates);
  if (heroRow === null) return { hero: null, screenshot: null, featured: [] };

  // Hero DOWNLOAD (02 §2.1 #1): synced → Modrinth project URL; exclusive → the direct download
  // of the latest version's primary file (route S1.3; href fixed now). A published exclusive
  // always has one (04 publishProject precondition); if the invariant is ever broken the button
  // degrades to the project page rather than a dead link.
  let downloadHref = modrinthProjectUrl(heroRow.slug);
  let downloadKind: 'direct' | 'modrinth' = 'modrinth';
  if (heroRow.source === 'odsens') {
    downloadKind = 'direct';
    downloadHref = `/projects/${heroRow.slug}`;
    const { data: versionRows, error: versionsError } = await client
      .from('project_versions')
      .select(
        'id, version_number, name, changelog_md, game_versions, loaders, date_published, project_files ( id, filename, size_bytes, sha512, url, storage_path, primary )',
      )
      .eq('project_id', heroRow.id);
    if (versionsError)
      throw new Error(`lib/data/projects: hero versions read failed — ${versionsError.message}`);
    const primary = latestPrimaryFile(versionRows satisfies RawVersion[]);
    if (primary !== null) downloadHref = `/api/download/${primary.id}`;
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
