/**
 * lib/data/admin.ts — read-side queries for the dynamic admin surfaces (02 §1.3 Data columns:
 * `/admin` = `sync_runs` (latest per source — `DASHBOARD_SYNC_SOURCES`, YouTube since S1.6) +
 * `projects` count where `status='draft'` + the S1.4 held-comments count + the S1.6 videos list
 * (`listAdminVideos` — ADR-0002 #20, ADR-0043 D11; there is no `/admin/videos`); `/admin/projects` =
 * `projects` (all statuses) + `project_overrides` + `project_links` + `sync_runs`
 * (modrinth/curseforge); `/admin/projects/[id]` = the same, by id, plus the S1.3 exclusive-editor
 * columns and `project_versions` + `project_files` (`listAdminProjectVersions`); `/admin/settings`
 * (S1.5) = `site_settings` row 1 (webhook masked, never raw — 04 §1.3 / 01 INV-43) +
 * `notification_matrix` (`getAdminSettings`) and `public_profiles where role <> 'user'`
 * (`listModerators`, 01 INV-45); 01 INV-12 "reads go through `lib/data/<area>.ts`"; registry Modules
 * `data/<area>.ts` — `admin` added 2026-08-27, registry add-first rule). S1.5a (ADR-0037 D8):
 * `listAdminProjects` carries `externalId` and the pure `suggestMatches` (the `/admin/projects`
 * "Looks like the same project" note — 00 S1.5a.AC7; 05 T-UNIT-50); `getAdminProject` carries
 * `externalId` + `modrinthLink` beside `curseforgeLink` from ONE `project_links` read. S1.8
 * (ADR-0045): `/admin/mentions` = `mentions` (all statuses — `listAdminMentions`) +
 * `projects_public` (the assign select — `listMentionProjectOptions`) + `sync_runs` (mentions —
 * `MENTIONS_SYNC_SOURCES`); the S1.8 block. S1.7 (ADR-0048 D12): `/admin/skins` = `skins` (all
 * statuses — `listAdminSkins` / `getAdminSkin`) and `/admin/art` = `art` (all statuses —
 * `listAdminArt` / `getAdminArt`); the block at the end of the file. S1.9 (ADR-0049 D14): `/admin/stats` =
 * `stats_daily` through `lib/data/stats.ts` + `sync_runs` for every job that feeds the numbers
 * (`STATS_SYNC_SOURCES`, right after the S1.8 block).
 *
 * The admin read seam is the REQUEST-COOKIE server client (`lib/supabase/server.ts`) under the
 * S1.2 RLS policies (ADR-0022 `project_is_visible() or is_admin()` arms) — admin routes are
 * dynamic and session-backed (02 §1.3 header), the service client is banned from `lib/data/**`
 * and pages (01 INV-14), and the anon client is the ISR seam only (01 INV-15). RLS is the second
 * gate (01 INV-31): an `admin` session reads every row; a `moderator` session gets the
 * RLS-filtered subset (05 §7.1: hidden/draft selects T-RLS-17/18 and `sync_runs` T-RLS-111 are
 * admin-only) while still seeing the page read-only per 02 §1.3.
 *
 * No `unstable_cache` here — these reads are per-request by design (dynamic routes; the cookie
 * client must never be cached, 01 INV-13). `getAdminProject` is wrapped in React `cache()` so
 * `generateMetadata` and the page share one request-scoped read.
 */
import 'server-only';
import { cache } from 'react';
import { avatarUrlFor, type CommentAuthor } from '@/lib/data/comments';
import { publicStorageUrl } from '@/lib/data/projects';
import { combinedDownloads } from '@/lib/format/downloads';
import { projectMatchKey } from '@/lib/format/project';
import { maskSecret } from '@/lib/format/secret';
import {
  COMING_LATER_KINDS,
  DELIVERY_CHANNELS,
  MATRIX_KINDS,
  isDeliveryChannel,
  isMatrixKind,
  type ComingLaterKind,
} from '@/lib/notify/constants';
import { matrixDefaults, type MatrixEntry } from '@/lib/notify/matrix';
import { createServerClient } from '@/lib/supabase/server';
import type { Database, Json } from '@/lib/supabase/types';
import { sortVersionsForTable, type FileKind } from '@/lib/versions';

type ProjectType = Database['public']['Enums']['project_type'];
type ProjectSource = Database['public']['Enums']['project_source'];
type ProjectStatus = Database['public']['Enums']['project_status'];

// ---- Pure helpers (no I/O) -------------------------------------------------------------------

/**
 * The one worded status per row (DESIGN.md §5 Admin table "Status is a worded pill"; fills per
 * ADR-0002 #47). Precedence: DRAFT > HIDDEN (either `projects.status='hidden'` — upstream-deleted,
 * 04 §3.1 — or the `project_overrides.hidden` curation flag) > LIVE. The values are a subset of
 * 03 §2.2 `StatusPill.status`.
 */
export function adminProjectStatus(
  status: ProjectStatus,
  hidden: boolean,
): 'draft' | 'hidden' | 'live' {
  if (status === 'draft') return 'draft';
  if (status === 'hidden' || hidden) return 'hidden';
  return 'live';
}

/** One `project_overrides.extra_gallery` entry (04 §1.4 shape), ordered for display. */
export type AdminGalleryEntry = {
  path: string;
  title: string | null;
  description: string | null;
  ordering: number;
};

/** One `projects.gallery` entry as stored (url = CDN url on a synced row, Storage path on an odsens row). */
export type AdminProjectGalleryEntry = {
  url: string;
  title: string | null;
  description: string | null;
  ordering: number;
  featured: boolean;
};

/** Tolerant parse of the `projects.gallery` jsonb WITHOUT resolving urls (the editor needs the stored key). */
export function parseProjectGallery(json: unknown): AdminProjectGalleryEntry[] {
  if (!Array.isArray(json)) return [];
  const entries: AdminProjectGalleryEntry[] = [];
  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const url = record.url ?? record.path;
    if (typeof url !== 'string' || url === '') continue;
    entries.push({
      url,
      title: typeof record.title === 'string' && record.title !== '' ? record.title : null,
      description:
        typeof record.description === 'string' && record.description !== ''
          ? record.description
          : null,
      ordering: typeof record.ordering === 'number' ? record.ordering : entries.length,
      featured: record.featured === true,
    });
  }
  return entries.sort((a, b) => Number(b.featured) - Number(a.featured) || a.ordering - b.ordering);
}

/** One `project_overrides.gallery_overrides` entry (ADR-0038 D3). */
export type GalleryOverride = { url: string; hidden: boolean; title: string | null };

/** Tolerant parse of the `gallery_overrides` jsonb — malformed entries are dropped. */
export function parseGalleryOverrides(json: unknown): GalleryOverride[] {
  if (!Array.isArray(json)) return [];
  const entries: GalleryOverride[] = [];
  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.url !== 'string' || record.url === '') continue;
    entries.push({
      url: record.url,
      hidden: record.hidden === true,
      title: typeof record.title === 'string' && record.title !== '' ? record.title : null,
    });
  }
  return entries;
}

/** Tolerant parse of the `extra_gallery` jsonb — malformed entries are dropped, order ascending. */
export function parseExtraGallery(json: unknown): AdminGalleryEntry[] {
  if (!Array.isArray(json)) return [];
  const entries: AdminGalleryEntry[] = [];
  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.path !== 'string') continue;
    entries.push({
      path: record.path,
      title: typeof record.title === 'string' ? record.title : null,
      description: typeof record.description === 'string' ? record.description : null,
      ordering: typeof record.ordering === 'number' ? record.ordering : 0,
    });
  }
  return entries.sort((a, b) => a.ordering - b.ordering);
}

// ---- /admin/projects list --------------------------------------------------------------------

export type AdminProjectListItem = {
  id: string;
  slug: string;
  title: string;
  projectType: ProjectType;
  source: ProjectSource;
  status: ProjectStatus;
  /** `projects.external_id` — the Modrinth listing id on synced rows, null on exclusives (ADR-0037 D8). */
  externalId: string | null;
  /** `modrinth + curseforge + direct` (05 T-UNIT-11 `combinedDownloads`). */
  downloadsTotal: number;
  /** Override-derived; a project without an override row reads `false` / `null` / `false`. */
  featured: boolean;
  featuredOrder: number | null;
  hidden: boolean;
};

/** The columns `suggestMatches` reads — a subset of `AdminProjectListItem` so tests stay small. */
export type SuggestMatchRow = {
  id: string;
  slug: string;
  title: string;
  source: ProjectSource;
  externalId: string | null;
};

/** One `/admin/projects` match note: the `odsens` twin of a `source='modrinth'` row (ADR-0037 D8). */
export type SuggestedMatch = {
  /** The `odsens` row the note points at (`/admin/projects/<odsensId>?section=listings&listing=<externalId>` — ADR-0040 D8). */
  odsensId: string;
  odsensTitle: string;
  /** The synced row's Modrinth listing id — what the editor's Modrinth field is prefilled with. */
  externalId: string;
};

/**
 * The `/admin/projects` "Looks like the same project as <title> — link it" rule (ADR-0037 D8;
 * 00 S1.5a.AC7; 05 T-UNIT-50). Pure. For every `source='modrinth'` row that carries an
 * `external_id`, the first `source='odsens'` row (in the given order — the list is title A→Z)
 * whose `projectMatchKey(slug)` OR `projectMatchKey(title)` equals the synced row's slug key or
 * title key. The title leg matters because ADR-0037 D2 gives a slug-colliding synced row the
 * last-resort `p-<id>` slug (ADR-0034 D1), so only the title still says "same project". An
 * empty key (`''`) never matches. Nothing here links anything — the note is a suggestion only.
 * Keyed by the SYNCED row's id.
 */
export function suggestMatches(rows: readonly SuggestMatchRow[]): Map<string, SuggestedMatch> {
  const exclusives = rows
    .filter((row) => row.source === 'odsens')
    .map((row) => ({
      row,
      keys: new Set(
        [projectMatchKey(row.slug), projectMatchKey(row.title)].filter((key) => key !== ''),
      ),
    }));
  const matches = new Map<string, SuggestedMatch>();
  if (exclusives.length === 0) return matches;
  for (const synced of rows) {
    if (synced.source !== 'modrinth' || synced.externalId === null || synced.externalId === '') {
      continue;
    }
    const keys = [projectMatchKey(synced.slug), projectMatchKey(synced.title)].filter(
      (key) => key !== '',
    );
    const twin = exclusives.find(({ keys: own }) => keys.some((key) => own.has(key)));
    if (twin === undefined) continue;
    matches.set(synced.id, {
      odsensId: twin.row.id,
      odsensTitle: twin.row.title,
      externalId: synced.externalId,
    });
  }
  return matches;
}

/**
 * Every project the session may read (admin: all statuses — 05 T-RLS-16..18), with its override
 * flags joined in. Ordered by title A→Z (stable admin scan order; engineering call).
 */
export async function listAdminProjects(): Promise<AdminProjectListItem[]> {
  const db = await createServerClient();
  const [projects, overrides] = await Promise.all([
    db
      .from('projects')
      .select(
        'id, slug, title, project_type, source, status, external_id, downloads_modrinth, downloads_curseforge, downloads_direct',
      )
      .order('title', { ascending: true }),
    db.from('project_overrides').select('project_id, featured, featured_order, hidden'),
  ]);
  if (projects.error) throw new Error(`admin projects read failed: ${projects.error.code}`);
  if (overrides.error) throw new Error(`admin overrides read failed: ${overrides.error.code}`);

  const byProject = new Map(overrides.data.map((row) => [row.project_id, row]));
  return projects.data.map((row) => {
    const override = byProject.get(row.id);
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      projectType: row.project_type,
      source: row.source,
      status: row.status,
      externalId: row.external_id,
      downloadsTotal: combinedDownloads(row),
      featured: override?.featured ?? false,
      featuredOrder: override?.featured_order ?? null,
      hidden: override?.hidden ?? false,
    };
  });
}

// ---- /admin/projects/[id] curate view --------------------------------------------------------

export type AdminProjectDetail = {
  id: string;
  slug: string;
  title: string;
  description: string;
  projectType: ProjectType;
  source: ProjectSource;
  status: ProjectStatus;
  /** `projects.external_id` — the home listing of a `source='modrinth'` row (ADR-0037 D8). */
  externalId: string | null;
  downloadsTotal: number;
  /** S1.3 exclusive-editor columns (04 §1.4 `updateExclusiveProject` fields + publish state). */
  bodyMd: string;
  categories: string[];
  loaders: string[];
  gameVersions: string[];
  license: string | null;
  sourceUrl: string | null;
  issuesUrl: string | null;
  discordUrl: string | null;
  /** Raw stored value — Modrinth CDN URL or Storage path (data-model §2); the page resolves it. */
  iconUrl: string | null;
  publishedAt: string | null;
  /** Raw `projects.gallery` jsonb — the page parses it tolerantly (`parseGalleryEntries`). */
  gallery: Json;
  /** Null when no override row exists yet — the form renders empty defaults. */
  override: {
    featured: boolean;
    featuredOrder: number | null;
    hidden: boolean;
    titleOverride: string | null;
    descriptionOverride: string | null;
    notesMd: string | null;
    commentsEnabled: boolean;
    extraGallery: AdminGalleryEntry[];
    /** ADR-0038 D3 — per-image hide / rename of the synced gallery, keyed by url. */
    galleryOverrides: GalleryOverride[];
  } | null;
  /** The manual CurseForge link (Q39), when set. */
  curseforgeLink: AdminProjectLink | null;
  /** The `modrinth` link of an `odsens` row (ADR-0037 D1/D8); always null on synced rows. */
  modrinthLink: AdminProjectLink | null;
};

/** One `project_links` row as the editor shows it (URL + `formatCount(downloads)`). */
export type AdminProjectLink = { externalId: string; url: string; downloads: number };

/**
 * One project by id (any status the session may read — 02 §1.3), with its override row and
 * platform links (ONE `project_links` read serves both platforms — ADR-0037 D8). Null = unknown
 * id OR filtered by RLS (moderators on hidden/draft rows,
 * 05 T-RLS-17/18) — the page maps both to `notFound()` (02 §1.3 Files cell). React-`cache()`d
 * so `generateMetadata` and the page share one read per request.
 */
export const getAdminProject = cache(async (id: string): Promise<AdminProjectDetail | null> => {
  const db = await createServerClient();
  const project = await db
    .from('projects')
    .select(
      'id, slug, title, description, project_type, source, status, external_id, downloads_modrinth, downloads_curseforge, downloads_direct, body_md, categories, loaders, game_versions, license, source_url, issues_url, discord_url, icon_url, published_at, gallery',
    )
    .eq('id', id)
    .maybeSingle();
  if (project.error) throw new Error(`admin project read failed: ${project.error.code}`);
  if (project.data === null) return null;

  const [override, links] = await Promise.all([
    db
      .from('project_overrides')
      .select(
        'featured, featured_order, hidden, title_override, description_override, notes_md, comments_enabled, extra_gallery, gallery_overrides',
      )
      .eq('project_id', id)
      .maybeSingle(),
    db.from('project_links').select('platform, external_id, url, downloads').eq('project_id', id),
  ]);
  if (override.error) throw new Error(`admin override read failed: ${override.error.code}`);
  if (links.error) throw new Error(`admin links read failed: ${links.error.code}`);

  const linkFor = (platform: 'modrinth' | 'curseforge'): AdminProjectLink | null => {
    const row = links.data.find((link) => link.platform === platform);
    return row ? { externalId: row.external_id, url: row.url, downloads: row.downloads } : null;
  };

  return {
    id: project.data.id,
    slug: project.data.slug,
    title: project.data.title,
    description: project.data.description,
    projectType: project.data.project_type,
    source: project.data.source,
    status: project.data.status,
    externalId: project.data.external_id,
    downloadsTotal: combinedDownloads(project.data),
    bodyMd: project.data.body_md,
    categories: project.data.categories,
    loaders: project.data.loaders,
    gameVersions: project.data.game_versions,
    license: project.data.license,
    sourceUrl: project.data.source_url,
    issuesUrl: project.data.issues_url,
    discordUrl: project.data.discord_url,
    iconUrl: project.data.icon_url,
    publishedAt: project.data.published_at,
    gallery: project.data.gallery,
    override: override.data
      ? {
          featured: override.data.featured,
          featuredOrder: override.data.featured_order,
          hidden: override.data.hidden,
          titleOverride: override.data.title_override,
          descriptionOverride: override.data.description_override,
          notesMd: override.data.notes_md,
          commentsEnabled: override.data.comments_enabled,
          extraGallery: parseExtraGallery(override.data.extra_gallery),
          galleryOverrides: parseGalleryOverrides(override.data.gallery_overrides),
        }
      : null,
    curseforgeLink: linkFor('curseforge'),
    modrinthLink: linkFor('modrinth'),
  };
});

// ---- /admin/projects/[id] versions & files (S1.3 exclusive editor) ---------------------------

export type AdminVersionFile = {
  id: string;
  filename: string;
  sizeBytes: number;
  sha512: string | null;
  storagePath: string | null;
  url: string | null;
  primary: boolean;
  downloadCount: number;
  /** ADR-0037 D6 per-file home: hosted (`storage_path`) → `direct`, else the Modrinth CDN row. */
  kind: FileKind;
};

export type AdminVersion = {
  id: string;
  versionNumber: string;
  name: string | null;
  versionType: 'release' | 'beta' | 'alpha';
  gameVersions: string[];
  loaders: string[];
  datePublished: string;
  changelogMd: string | null;
  files: AdminVersionFile[];
};

/**
 * Every version of one project with its files embedded, in the `VersionsTable` order (05
 * T-UNIT-30 via `sortVersionsForTable`): versions newest-first, files `hostedFirst` (ADR-0037
 * D6 — each file's `kind` is derived from `storage_path`). One select — `project_files` rides
 * the `project_versions` FK embed. Read on every source since S1.5a (the file well renders on
 * synced rows too). Same RLS story as `getAdminProject`: a moderator on a draft/hidden project
 * never reaches this call (the page 404s first).
 */
export async function listAdminProjectVersions(projectId: string): Promise<AdminVersion[]> {
  const db = await createServerClient();
  const { data, error } = await db
    .from('project_versions')
    .select(
      'id, version_number, name, version_type, game_versions, loaders, date_published, changelog_md, project_files ( id, filename, size_bytes, sha512, storage_path, url, primary, download_count )',
    )
    .eq('project_id', projectId)
    .order('date_published', { ascending: false });
  if (error) throw new Error(`admin versions read failed: ${error.code}`);

  return sortVersionsForTable(
    data.map((row) => ({
      id: row.id,
      versionNumber: row.version_number,
      name: row.name,
      versionType: row.version_type,
      gameVersions: row.game_versions,
      loaders: row.loaders,
      datePublished: row.date_published,
      changelogMd: row.changelog_md,
      files: row.project_files.map((file) => ({
        id: file.id,
        filename: file.filename,
        sizeBytes: file.size_bytes,
        sha512: file.sha512,
        storagePath: file.storage_path,
        url: file.url,
        primary: file.primary,
        downloadCount: file.download_count,
        kind: file.storage_path !== null ? 'direct' : 'modrinth',
      })),
    })),
  );
}

// ---- /admin dashboard ------------------------------------------------------------------------

/**
 * `projects` count where `status='draft'` (02 §1.3 `/admin` Data cell — the dashboard's S1.2
 * `StatTile`). Draft rows are admin-only RLS (05 T-RLS-17) — a moderator session counts 0, the
 * read-only degradation 02 §1.3 accepts (the `listSyncStatus` precedent). Head-only count: no
 * rows cross the wire.
 */
export async function countDraftProjects(): Promise<number> {
  const db = await createServerClient();
  const { count, error } = await db
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'draft');
  if (error) throw new Error(`admin draft count failed: ${error.code}`);
  return count ?? 0;
}

// ---- /admin dashboard videos list (S1.6; 02 §1.3 `/admin` row; ADR-0002 #20; ADR-0043 D11) ----

export type AdminVideoListItem = {
  id: string;
  /** The natural key `updateVideo` takes (04 §1.8 `updateVideoInput.youtube_id`). */
  youtubeId: string;
  title: string;
  publishedAt: string;
  /** Null on an RSS-only row (04 §3.3 — no `YOUTUBE_API_KEY`). */
  durationSeconds: number | null;
  hidden: boolean;
  /** The EFFECTIVE flag every public reader filters on (= `override ?? heuristic`, ADR-0043 D1). */
  isShort: boolean;
  /** Oliver's override of the 04 §5.3 heuristic; null = the heuristic decides (ADR-0043 D1). */
  isShortOverride: boolean | null;
};

/** Cap for the dashboard list — the channel has ~21 uploads (00 S1.6.AC1); engineering call. */
export const ADMIN_VIDEOS_LIMIT = 200;

/**
 * The `/admin` videos list (02 §1.3 `/admin` Data cell: "`videos` … read newest first on the
 * request-cookie client incl. `is_short_override`"). Newest first by `published_at` (the
 * `videos_published_at_idx` order), long videos and Shorts together — the Short `Toggle` is a
 * column of this list. RLS (05 T-RLS-48/49): an `admin` session reads every row incl. hidden; a
 * `moderator` session gets the visible rows only, so every row a moderator sees reads LIVE — the
 * read-only degradation 02 §1.3 accepts (the `countDraftProjects` / `listSyncStatus` precedent).
 */
export async function listAdminVideos(
  limit: number = ADMIN_VIDEOS_LIMIT,
): Promise<AdminVideoListItem[]> {
  const db = await createServerClient();
  const { data, error } = await db
    .from('videos')
    .select(
      'id, youtube_id, title, published_at, duration_seconds, hidden, is_short, is_short_override',
    )
    .order('published_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`admin videos read failed: ${error.code}`);

  return data.map((row) => ({
    id: row.id,
    youtubeId: row.youtube_id,
    title: row.title,
    publishedAt: row.published_at,
    durationSeconds: row.duration_seconds,
    hidden: row.hidden,
    isShort: row.is_short,
    isShortOverride: row.is_short_override,
  }));
}

// ---- Sync status (`sync_runs`) ---------------------------------------------------------------

/** 04 J-S staleness window: no `ok=true` run in the last 6 h ⇒ the source is stale. */
export const SYNC_STALE_WINDOW_MS = 6 * 60 * 60 * 1000;

/** The sources `/admin/projects` shows (02 §1.3 Data cell: `sync_runs` (modrinth/curseforge)). */
export const PROJECT_SYNC_SOURCES = ['modrinth', 'curseforge'] as const;
export type ProjectSyncSource = (typeof PROJECT_SYNC_SOURCES)[number];

/**
 * The sources the `/admin` dashboard shows (02 §1.3 `/admin` Data cell: `sync_runs` (latest per
 * source); 03 §2.10 `SyncStatus` Slice cell "S1.2 (Modrinth/CF) · S1.6 (YouTube) · S1.8"). YouTube
 * joins here only — `/admin/projects` keeps `PROJECT_SYNC_SOURCES` (its Data cell names
 * modrinth/curseforge).
 */
export const DASHBOARD_SYNC_SOURCES = ['modrinth', 'curseforge', 'youtube'] as const;
export type DashboardSyncSource = (typeof DASHBOARD_SYNC_SOURCES)[number];

export type AdminSyncSource<TSource extends string = string> = {
  source: TSource;
  /**
   * Latest `sync_runs` row, shaped for 03 §2.10 `SyncStatus.lastRun`. An open row (`finished_at`
   * null — SC-11 insert-then-finalize) reads `ok: true` / `items: 0`: not-yet-failed is not FAILED.
   */
  lastRun: {
    startedAt: string;
    finishedAt: string | null;
    ok: boolean;
    items: number;
    error: string | null;
  } | null;
  /** True when no `ok=true` run finished inside `SYNC_STALE_WINDOW_MS` (04 J-S). */
  stale: boolean;
};

/**
 * Latest run + staleness per source. `sync_runs` SELECT is admin-only RLS (05 T-RLS-111) — a
 * moderator session gets `lastRun: null` rows (rendered STALE), which is the read-only degradation
 * 02 §1.3 accepts for moderators.
 */
export async function listSyncStatus<TSource extends string>(
  sources: readonly TSource[],
  now: number = Date.now(),
): Promise<AdminSyncSource<TSource>[]> {
  const db = await createServerClient();
  return Promise.all(
    sources.map(async (source) => {
      const [latest, latestOk] = await Promise.all([
        db
          .from('sync_runs')
          .select('started_at, finished_at, ok, items, error')
          .eq('source', source)
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from('sync_runs')
          .select('finished_at')
          .eq('source', source)
          .eq('ok', true)
          .not('finished_at', 'is', null)
          .order('finished_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (latest.error) throw new Error(`sync_runs read failed: ${latest.error.code}`);
      if (latestOk.error) throw new Error(`sync_runs read failed: ${latestOk.error.code}`);

      const okFinishedAt = latestOk.data?.finished_at ?? null;
      const stale = okFinishedAt === null || Date.parse(okFinishedAt) < now - SYNC_STALE_WINDOW_MS;
      return {
        source,
        lastRun: latest.data
          ? {
              startedAt: latest.data.started_at,
              finishedAt: latest.data.finished_at,
              ok: latest.data.ok ?? true,
              items: latest.data.items ?? 0,
              error: latest.data.error,
            }
          : null,
        stale,
      };
    }),
  );
}

// ---- /admin/comments — the moderation queue (S1.4; 02 §1.3 row; 00 S1.4.AC14) -----------------

/**
 * `comments` count where `status='held'` (02 §1.3 `/admin` Data cell; the sidebar count of
 * 03 `AdminShell`). Moderators read every comment row (data-model §4) — no degradation here.
 */
export async function countHeldComments(): Promise<number> {
  const db = await createServerClient();
  const { count, error } = await db
    .from('comments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'held');
  if (error) throw new Error(`admin held count failed: ${error.code}`);
  return count ?? 0;
}

export type ModerationQueueRow = {
  id: string;
  body: string;
  status: 'published' | 'held' | 'hidden';
  createdAt: string;
  editedAt: string | null;
  likeCount: number;
  /** Unresolved reports (from RPC `moderator_thread`; 0 when the row is not in its result). */
  reportCount: number;
  /** The author's `profiles.comment_count = 0` (RPC `moderator_thread`; held rows only matter). */
  isFirstComment: boolean;
  author: CommentAuthor | null;
  /** The comment's project through `projects_public`; null when the view no longer shows it. */
  target: { type: 'project'; id: string; title: string; slug: string } | null;
};

const QUEUE_ORDER: Record<ModerationQueueRow['status'], number> = {
  held: 0,
  published: 1,
  hidden: 2,
};

/**
 * The moderation queue (02 §1.3 `/admin/comments` Data cell: `comments` (all statuses but
 * deleted) + `public_profiles`, `comment_reports` (unresolved, via RPC `moderator_thread` per
 * target — the mods-only read, ADR-0002 A2), `projects_public` (target titles)). Order: held
 * first, then reported, then hidden, then published — newest first inside each group; capped at
 * `limit` rows after ordering. Session-backed, moderator or admin (the layout gate).
 */
export async function listModerationQueue(limit = 100): Promise<ModerationQueueRow[]> {
  const db = await createServerClient();
  const { data: rows, error } = await db
    .from('comments')
    .select(
      'id, target_type, target_id, author_id, body, status, created_at, edited_at, like_count',
    )
    .neq('status', 'deleted')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) throw new Error(`admin comments read failed: ${error.code}`);

  const targetIds = [...new Set(rows.map((row) => row.target_id))];
  const authorIds = [...new Set(rows.flatMap((row) => (row.author_id ? [row.author_id] : [])))];

  const [threads, profiles, projects] = await Promise.all([
    Promise.all(
      targetIds.map(async (targetId) => {
        const { data, error: rpcError } = await db.rpc('moderator_thread', {
          p_target_type: 'project',
          p_target_id: targetId,
        });
        if (rpcError) throw new Error(`moderator_thread failed: ${rpcError.code}`);
        return data;
      }),
    ),
    authorIds.length > 0
      ? db.from('public_profiles').select('id, handle, avatar_path, role').in('id', authorIds)
      : Promise.resolve({ data: [], error: null }),
    targetIds.length > 0
      ? db.from('projects_public').select('id, slug, title').in('id', targetIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (profiles.error) throw new Error(`admin profiles read failed: ${profiles.error.code}`);
  if (projects.error) throw new Error(`admin projects read failed: ${projects.error.code}`);

  const flags = new Map<string, { reportCount: number; isFirstComment: boolean }>();
  for (const row of threads.flat()) {
    flags.set(row.id, { reportCount: row.report_count, isFirstComment: row.is_first_comment });
  }
  const authors = new Map<string, CommentAuthor>();
  for (const profile of profiles.data) {
    if (profile.id === null || profile.handle === null || profile.role === null) continue;
    authors.set(profile.id, {
      id: profile.id,
      handle: profile.handle,
      avatarUrl: avatarUrlFor(profile.avatar_path),
      role: profile.role,
    });
  }
  const targets = new Map<string, { id: string; slug: string; title: string }>();
  for (const project of projects.data) {
    if (project.id === null || project.slug === null || project.title === null) continue;
    targets.set(project.id, { id: project.id, slug: project.slug, title: project.title });
  }

  const queue: ModerationQueueRow[] = rows.flatMap((row) => {
    if (row.status === 'deleted') return [];
    const flag = flags.get(row.id);
    const target = targets.get(row.target_id);
    return [
      {
        id: row.id,
        body: row.body,
        status: row.status,
        createdAt: row.created_at,
        editedAt: row.edited_at,
        likeCount: row.like_count,
        reportCount: flag?.reportCount ?? 0,
        isFirstComment: flag?.isFirstComment ?? false,
        author: row.author_id ? (authors.get(row.author_id) ?? null) : null,
        target: target ? { type: 'project', ...target } : null,
      },
    ];
  });

  const group = (row: ModerationQueueRow): number =>
    row.status === 'held' ? 0 : row.reportCount > 0 ? 1 : QUEUE_ORDER[row.status] + 1;
  return queue
    .sort(
      (a, b) =>
        group(a) - group(b) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0),
    )
    .slice(0, limit);
}

// ---- /admin/settings (S1.5; 02 §2.8; 03 §2.10 `NotificationMatrix`; ADR-0030 D5) -------------

export type ModerationMode = Database['public']['Enums']['moderation_mode'];

/**
 * What `/admin/settings` renders (02 §2.8 Data: `site_settings` row + `notification_matrix`). The
 * webhook URL never leaves the server — `webhookMasked` is `maskSecret(url)` (`…<last 4>`) or
 * `null` when unset, exactly the 03 §2.10 `webhookMasked` prop; `webhookSet` is the boolean twin.
 */
export type AdminSettings = {
  moderationMode: ModerationMode;
  /** Explicit admin addresses (`admin_notify_emails`) — rendered as chips, never from Google (00 S1.5.AC4). */
  adminNotifyEmails: string[];
  kofiPage: string | null;
  commentsClosedDefault: boolean;
  announcementMd: string | null;
  webhookSet: boolean;
  webhookMasked: string | null;
  /** The 16 `(kind, channel)` cells in `matrixDefaults` order (missing cells fall back to the defaults). */
  matrix: MatrixEntry[];
  /** The greyed COMING LATER rows (03 §2.10 `comingLater` prop). */
  comingLater: ComingLaterKind[];
};

const MATRIX_ORDER = new Map(
  MATRIX_KINDS.flatMap((kind) =>
    DELIVERY_CHANNELS.map((channel, index) => [
      `${kind} ${channel}`,
      MATRIX_KINDS.indexOf(kind) * DELIVERY_CHANNELS.length + index,
    ]),
  ),
);

/**
 * `notification_matrix` rows → the 16 grid cells in `matrixDefaults` order (kind-major, email then
 * discord). Rows outside the eight matrix kinds or the two v1 channels (Phase 2 `inapp`/`push`,
 * log-only kinds) are dropped; a missing cell reads its documented default so the grid never
 * renders a hole. Pure — exported for `updateSettings`' return value and tests.
 */
export function sortMatrixEntries(
  rows: readonly { kind: string; channel: string; enabled: boolean }[],
): MatrixEntry[] {
  const byKey = new Map<string, MatrixEntry>();
  for (const row of rows) {
    if (!isMatrixKind(row.kind) || !isDeliveryChannel(row.channel)) continue;
    byKey.set(`${row.kind} ${row.channel}`, {
      kind: row.kind,
      channel: row.channel,
      enabled: row.enabled,
    });
  }
  return matrixDefaults
    .map((entry) => byKey.get(`${entry.kind} ${entry.channel}`) ?? { ...entry })
    .sort(
      (a, b) =>
        (MATRIX_ORDER.get(`${a.kind} ${a.channel}`) ?? 0) -
        (MATRIX_ORDER.get(`${b.kind} ${b.channel}`) ?? 0),
    );
}

/**
 * The `/admin/settings` read on the request-cookie client — `site_settings` select is admin-only
 * RLS (05 T-RLS-12), so this is called only after the page's RP-04 admin check (a moderator
 * session would see no row and this throws — the page 404s moderators first, 02 §2.8). The raw
 * `discord_webhook_url` is read here to mask it and is NEVER returned (04 §1.3; 01 INV-43).
 */
export async function getAdminSettings(): Promise<AdminSettings> {
  const db = await createServerClient();
  const [settings, matrix] = await Promise.all([
    db
      .from('site_settings')
      .select(
        'moderation_mode, admin_notify_emails, discord_webhook_url, kofi_page, comments_closed_default, announcement_md',
      )
      .eq('id', 1)
      .maybeSingle(),
    db.from('notification_matrix').select('kind, channel, enabled'),
  ]);
  if (settings.error) throw new Error(`admin settings read failed: ${settings.error.code}`);
  if (matrix.error) throw new Error(`admin matrix read failed: ${matrix.error.code}`);
  if (settings.data === null) throw new Error('admin settings read failed: no row');

  const url = settings.data.discord_webhook_url;
  return {
    moderationMode: settings.data.moderation_mode,
    adminNotifyEmails: settings.data.admin_notify_emails,
    kofiPage: settings.data.kofi_page,
    commentsClosedDefault: settings.data.comments_closed_default,
    announcementMd: settings.data.announcement_md,
    webhookSet: url !== null && url !== '',
    webhookMasked: url !== null && url !== '' ? maskSecret(url) : null,
    matrix: sortMatrixEntries(matrix.data),
    comingLater: [...COMING_LATER_KINDS],
  };
}

export type ModeratorRow = {
  id: string;
  handle: string;
  role: 'moderator' | 'admin';
};

const MODERATOR_RANK: Record<ModeratorRow['role'], number> = { admin: 2, moderator: 1 };

/**
 * The Moderators table (02 §2.8 §3): `public_profiles where role <> 'user'` — the only cross-user
 * read (01 INV-45; `id, handle, role`). Admins first, then moderators, handle A→Z (case-insensitive)
 * — sorted here because PostgREST orders enum columns by declaration order. A staff row without a
 * handle (onboarding incomplete) is skipped: `setUserRole` addresses people by handle.
 */
export async function listModerators(): Promise<ModeratorRow[]> {
  const db = await createServerClient();
  const { data, error } = await db
    .from('public_profiles')
    .select('id, handle, role')
    .neq('role', 'user');
  if (error) throw new Error(`admin moderators read failed: ${error.code}`);

  const rows: ModeratorRow[] = [];
  for (const row of data) {
    if (row.id === null || row.handle === null || row.role === null || row.role === 'user')
      continue;
    rows.push({ id: row.id, handle: row.handle, role: row.role });
  }
  return rows.sort(
    (a, b) =>
      MODERATOR_RANK[b.role] - MODERATOR_RANK[a.role] ||
      a.handle.toLowerCase().localeCompare(b.handle.toLowerCase()) ||
      a.handle.localeCompare(b.handle),
  );
}

// ---- /admin/mentions (S1.8; 02 §1.3 `/admin/mentions` row; 04 §1.6; ADR-0045) ----------------
// ---- S1.8 block START ------------------------------------------------------------------------

type MentionPlatform = Database['public']['Enums']['mention_platform'];
type MentionStatus = Database['public']['Enums']['mention_status'];

/**
 * The one worded status per `/admin/mentions` row (DESIGN.md §12.2 "FEATURED / LIVE / HIDDEN
 * worded tags"; 00 S1.8 Scope IN). DRAFT, SUGGESTED and HIDDEN read as themselves; a published row is
 * FEATURED when it feeds the Home strip, else LIVE. The values are a subset of 03 §2.2
 * `StatusPill.status`.
 */
export function adminMentionStatus(
  status: MentionStatus,
  featured: boolean,
): 'draft' | 'suggested' | 'hidden' | 'featured' | 'live' {
  if (status === 'published') return featured ? 'featured' : 'live';
  return status;
}

export type AdminMentionListItem = {
  id: string;
  platform: MentionPlatform;
  url: string;
  /** For `youtube` the 11-char video id `refreshMentions` asks the Data API for (04 §3.4). */
  externalId: string | null;
  title: string;
  creatorName: string;
  creatorUrl: string | null;
  publishedAt: string | null;
  viewCount: number | null;
  status: MentionStatus;
  featured: boolean;
  /** Order of the featured mentions on the Home strip — what `updateMention({reorder})` writes. */
  sortOrder: number;
  /** `null` = "About OddSense generally". */
  projectId: string | null;
  /**
   * The attached project's title: the public one (`title_override ?? title`) when the project is
   * visible, else the stored `projects.title` as far as the session's RLS shows it; `null` for a
   * general mention or a project this session cannot read.
   */
  projectTitle: string | null;
  createdAt: string;
};

/** Cap for the list = the `updateMention` reorder maximum (04 §1.6 "max 200"). */
export const ADMIN_MENTIONS_LIMIT = 200;

/**
 * The `/admin/mentions` list (02 §1.3 Data cell: "`mentions` (all statuses)") on the request-cookie
 * client, newest-added first (`created_at` desc, `id` breaks a tie) — deliberately NOT by
 * `sort_order`, so a reorder of the featured list never reshuffles the table under the pointer.
 * RLS (05 T-RLS-102/103): an `admin` session reads every status; a `moderator` session gets the
 * published rows only, so every row a moderator sees reads LIVE or FEATURED — the read-only
 * degradation ADR-0045 records (the `listAdminVideos` precedent; the policy is never widened).
 * Project titles come from ONE `projects_public` read; an id the view does not show (a hidden or
 * draft project) falls back to `projects.title` under the same session's RLS.
 */
export async function listAdminMentions(
  limit: number = ADMIN_MENTIONS_LIMIT,
): Promise<AdminMentionListItem[]> {
  const db = await createServerClient();
  const { data, error } = await db
    .from('mentions')
    .select(
      'id, project_id, platform, url, external_id, title, creator_name, creator_url, published_at, view_count, status, featured, sort_order, created_at',
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`admin mentions read failed: ${error.code}`);

  const projectIds = [...new Set(data.flatMap((row) => (row.project_id ? [row.project_id] : [])))];
  const titles = new Map<string, string>();
  if (projectIds.length > 0) {
    const visible = await db.from('projects_public').select('id, title').in('id', projectIds);
    if (visible.error) throw new Error(`admin projects read failed: ${visible.error.code}`);
    for (const project of visible.data) {
      if (project.id !== null && project.title !== null) titles.set(project.id, project.title);
    }
    const unseen = projectIds.filter((id) => !titles.has(id));
    if (unseen.length > 0) {
      const stored = await db.from('projects').select('id, title').in('id', unseen);
      if (stored.error) throw new Error(`admin projects read failed: ${stored.error.code}`);
      for (const project of stored.data) titles.set(project.id, project.title);
    }
  }

  return data.map((row) => ({
    id: row.id,
    platform: row.platform,
    url: row.url,
    externalId: row.external_id,
    title: row.title,
    creatorName: row.creator_name,
    creatorUrl: row.creator_url,
    publishedAt: row.published_at,
    viewCount: row.view_count,
    status: row.status,
    featured: row.featured,
    sortOrder: row.sort_order,
    projectId: row.project_id,
    projectTitle: row.project_id === null ? null : (titles.get(row.project_id) ?? null),
    createdAt: row.created_at,
  }));
}

/**
 * The `MentionPreview` "Assign to" options (02 §1.3 Data cell: "`projects_public` (assign
 * select)"; 03 §2.8 `projects: { id; title }[]`): every publicly visible project, title A→Z
 * (case-insensitive, `id` breaks a tie — sorted here, locale-free, so the order never depends on
 * the database collation). The caller puts "About OddSense generally" (`project_id: null`) first.
 */
export async function listMentionProjectOptions(): Promise<{ id: string; title: string }[]> {
  const db = await createServerClient();
  const { data, error } = await db.from('projects_public').select('id, title');
  if (error) throw new Error(`admin projects read failed: ${error.code}`);

  const options: { id: string; title: string }[] = [];
  for (const row of data) {
    if (row.id !== null && row.title !== null) options.push({ id: row.id, title: row.title });
  }
  return options.sort((a, b) => {
    const [left, right] = [a.title.toLowerCase(), b.title.toLowerCase()];
    if (left !== right) return left < right ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The source `/admin/mentions` shows a `SyncStatus` row for (03 §2.10 `SyncStatus` Slice cell
 * "… · S1.8"; ADR-0045): `refreshMentions` writes `sync_runs.source = 'mentions'` (04 §3.4) and
 * `triggerSync({ source: 'mentions' })` runs it. `DASHBOARD_SYNC_SOURCES` stays as it is — the
 * mentions row lives beside the mentions, not on `/admin`. Feed it to `listSyncStatus`.
 */
export const MENTIONS_SYNC_SOURCES = ['mentions'] as const;
export type MentionsSyncSource = (typeof MENTIONS_SYNC_SOURCES)[number];

// ---- S1.8 block END --------------------------------------------------------------------------

// ---- /admin/stats (S1.9; 02 §1.3 row; ADR-0049 D14) ---------------------------------------------------

/**
 * The sources `/admin/stats` shows a `SyncStatus` row for (03 §2.10 `SyncStatus`; ADR-0049 D14): every job
 * that feeds the numbers — the three platform syncs, the mentions refresh and `snapshotStats` itself
 * (`sync_runs.source = 'stats'`, 04 §3.5) — so the page shows the whole picture and a dead snapshot
 * cron is visible on its own row (ADR-0049 D11); "Sync now" on the `stats` row runs `snapshotStats` through
 * `triggerSync({ source: 'stats' })` (ADR-0049 D9). Feed it to `listSyncStatus`.
 */
export const STATS_SYNC_SOURCES = [
  'modrinth',
  'curseforge',
  'youtube',
  'mentions',
  'stats',
] as const; // ADR-0049 D14
export type StatsSyncSource = (typeof STATS_SYNC_SOURCES)[number];

// ---- /admin/skins + /admin/art (S1.7; 02 §1.3 rows; 04 §1.5; ADR-0048 D19 / D27 / D12) ----------
// ---- S1.7 block START ------------------------------------------------------------------------

type SkinModel = Database['public']['Enums']['skin_model'];
type SkinStatus = Database['public']['Enums']['skin_status'];
type ArtKind = Database['public']['Enums']['art_kind'];
type ArtStatus = Database['public']['Enums']['art_status'];

/**
 * One `/admin/skins` row — the table (Skin thumb + name + slug · Model · Downloads · Status ·
 * Actions), the ORDER list and the `SkinForm` edit pre-fill share it (`getAdminSkin` returns the
 * same shape). URLs are resolved here (03 C-19): `textureUrl` is the 40 px pixelated thumb and
 * `bustUrl` the cached render or `null` (not rendered yet — 04 §3.8).
 */
export type AdminSkinListItem = {
  id: string;
  slug: string;
  name: string;
  /** The Markdown SOURCE (the form's textarea value); `null` = no description. */
  descriptionMd: string | null;
  model: SkinModel;
  textureUrl: string;
  bustUrl: string | null;
  exclusive: boolean;
  status: SkinStatus;
  /** What `updateSkin({ reorder })` writes (04 §1.5). */
  sortOrder: number;
  /** The `record_skin_download` counter (04 §2.3 D4). */
  downloads: number;
  createdAt: string;
  updatedAt: string;
};

/** Cap for the list = the `updateSkin` reorder maximum (04 §1.5 "max 200"). */
export const ADMIN_SKINS_LIMIT = 200;

const ADMIN_SKIN_SELECT =
  'id, slug, name, description_md, texture_path, model, render_bust_path, is_exclusive, status, sort_order, downloads, created_at, updated_at';

type AdminSkinRow = {
  id: string;
  slug: string;
  name: string;
  description_md: string | null;
  texture_path: string;
  model: SkinModel;
  render_bust_path: string | null;
  is_exclusive: boolean;
  status: SkinStatus;
  sort_order: number;
  downloads: number;
  created_at: string;
  updated_at: string;
};

function toAdminSkin(row: AdminSkinRow): AdminSkinListItem {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    descriptionMd: row.description_md,
    model: row.model,
    textureUrl: publicStorageUrl(row.texture_path),
    bustUrl: row.render_bust_path === null ? null : publicStorageUrl(row.render_bust_path),
    exclusive: row.is_exclusive,
    status: row.status,
    sortOrder: row.sort_order,
    downloads: row.downloads,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The `/admin/skins` list (02 §1.3 Data cell: "`skins` (all statuses)") on the request-cookie
 * client, newest-added first (`created_at` desc, `id` breaks a tie) — deliberately NOT by
 * `sort_order`, so a reorder never reshuffles the table under the pointer (the page's ORDER
 * section sorts the published rows by `sortOrder` itself). RLS (05 T-RLS-53/54): an `admin`
 * session reads every status; a `moderator` session gets the RLS-filtered PUBLISHED rows only, so
 * every row a moderator sees reads LIVE — the read-only degradation 02 §1.3 accepts (the
 * `listAdminVideos` / `listAdminMentions` precedent; the policy is never widened).
 */
export async function listAdminSkins(
  limit: number = ADMIN_SKINS_LIMIT,
): Promise<AdminSkinListItem[]> {
  const db = await createServerClient();
  const { data, error } = await db
    .from('skins')
    .select(ADMIN_SKIN_SELECT)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`admin skins read failed: ${error.code}`);
  return data.map(toAdminSkin);
}

/**
 * One skin by id for `/admin/skins?edit=<id>` (the `SkinForm` pre-fill). `null` = unknown id OR
 * filtered by RLS (a moderator on a draft — 05 T-RLS-54); the page treats both as "nothing to edit".
 */
export async function getAdminSkin(id: string): Promise<AdminSkinListItem | null> {
  const db = await createServerClient();
  const { data, error } = await db
    .from('skins')
    .select(ADMIN_SKIN_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`admin skin read failed: ${error.code}`);
  return data === null ? null : toAdminSkin(data);
}

/**
 * One `/admin/art` row — the table (Art thumb · Title · Kind · Size `w×h` · Status · Actions),
 * the ORDER list and the `ArtForm` edit pre-fill share it (`getAdminArt` returns the same shape).
 * `imageUrl` is resolved here (03 C-19); `imagePath` is the stored `art/<id>/<hash16>.<ext>` the
 * form shows beside "Replace image" (never a user input — the commit derives the next one).
 */
export type AdminArtListItem = {
  id: string;
  slug: string;
  title: string;
  kind: ArtKind;
  imageUrl: string;
  imagePath: string;
  /** Natural size, server-derived at commit (04 §1.5). */
  width: number;
  height: number;
  year: number | null;
  /** A handle, never a real name. */
  credit: string | null;
  downloadable: boolean;
  status: ArtStatus;
  /** What `updateArt({ reorder })` writes (04 §1.5). */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/** Cap for the list — art grows faster than skins; engineering call (ADR-0048 D12). */
export const ADMIN_ART_LIMIT = 500;

const ADMIN_ART_SELECT =
  'id, slug, title, kind, image_path, width, height, year, credit, downloadable, status, sort_order, created_at, updated_at';

type AdminArtRow = {
  id: string;
  slug: string;
  title: string;
  kind: ArtKind;
  image_path: string;
  width: number;
  height: number;
  year: number | null;
  credit: string | null;
  downloadable: boolean;
  status: ArtStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function toAdminArt(row: AdminArtRow): AdminArtListItem {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    kind: row.kind,
    imageUrl: publicStorageUrl(row.image_path),
    imagePath: row.image_path,
    width: row.width,
    height: row.height,
    year: row.year,
    credit: row.credit,
    downloadable: row.downloadable,
    status: row.status,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The `/admin/art` list (02 §1.3 Data cell: "`art` (all statuses)") on the request-cookie client,
 * newest-added first (`created_at` desc, `id` breaks a tie) — not by `sort_order`, for the
 * `listAdminSkins` reason. RLS (05 T-RLS-58/59): an `admin` session reads every status; a
 * `moderator` session gets the RLS-filtered PUBLISHED rows only, so every row a moderator sees
 * reads LIVE — the read-only degradation 02 §1.3 accepts; the policy is never widened.
 */
export async function listAdminArt(limit: number = ADMIN_ART_LIMIT): Promise<AdminArtListItem[]> {
  const db = await createServerClient();
  const { data, error } = await db
    .from('art')
    .select(ADMIN_ART_SELECT)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`admin art read failed: ${error.code}`);
  return data.map(toAdminArt);
}

/**
 * One piece by id for `/admin/art?edit=<id>` (the `ArtForm` pre-fill). `null` = unknown id OR
 * filtered by RLS (a moderator on a draft — 05 T-RLS-59).
 */
export async function getAdminArt(id: string): Promise<AdminArtListItem | null> {
  const db = await createServerClient();
  const { data, error } = await db.from('art').select(ADMIN_ART_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`admin art read failed: ${error.code}`);
  return data === null ? null : toAdminArt(data);
}

// ---- S1.7 block END --------------------------------------------------------------------------
