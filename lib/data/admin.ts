/**
 * lib/data/admin.ts — read-side queries for the dynamic admin surfaces (02 §1.3 Data columns:
 * `/admin` = `sync_runs` (latest per source) + `projects` count where `status='draft'` (the
 * held-comments count is S1.4, the videos list S1.6 — the row's Slice cell); `/admin/projects` =
 * `projects` (all statuses) + `project_overrides` + `project_links` + `sync_runs`
 * (modrinth/curseforge); `/admin/projects/[id]` = the same, by id, plus the S1.3 exclusive-editor
 * columns and `project_versions` + `project_files` (`listAdminProjectVersions`); `/admin/settings`
 * (S1.5) = `site_settings` row 1 (webhook masked, never raw — 04 §1.3 / 01 INV-43) +
 * `notification_matrix` (`getAdminSettings`) and `public_profiles where role <> 'user'`
 * (`listModerators`, 01 INV-45); 01 INV-12 "reads go through `lib/data/<area>.ts`"; registry Modules
 * `data/<area>.ts` — `admin` added 2026-08-27, registry add-first rule).
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
import { combinedDownloads } from '@/lib/format/downloads';
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
import { sortVersionsForTable } from '@/lib/versions';

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
  ordering: number;
};

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
  /** `modrinth + curseforge + direct` (05 T-UNIT-11 `combinedDownloads`). */
  downloadsTotal: number;
  /** Override-derived; a project without an override row reads `false` / `null` / `false`. */
  featured: boolean;
  featuredOrder: number | null;
  hidden: boolean;
};

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
        'id, slug, title, project_type, source, status, downloads_modrinth, downloads_curseforge, downloads_direct',
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
  } | null;
  /** The manual CurseForge link (Q39), when set. */
  curseforgeLink: { externalId: string; url: string; downloads: number } | null;
};

/**
 * One project by id (any status the session may read — 02 §1.3), with its override row and
 * CurseForge link. Null = unknown id OR filtered by RLS (moderators on hidden/draft rows,
 * 05 T-RLS-17/18) — the page maps both to `notFound()` (02 §1.3 Files cell). React-`cache()`d
 * so `generateMetadata` and the page share one read per request.
 */
export const getAdminProject = cache(async (id: string): Promise<AdminProjectDetail | null> => {
  const db = await createServerClient();
  const project = await db
    .from('projects')
    .select(
      'id, slug, title, description, project_type, source, status, downloads_modrinth, downloads_curseforge, downloads_direct, body_md, categories, loaders, game_versions, license, source_url, issues_url, discord_url, icon_url, published_at, gallery',
    )
    .eq('id', id)
    .maybeSingle();
  if (project.error) throw new Error(`admin project read failed: ${project.error.code}`);
  if (project.data === null) return null;

  const [override, link] = await Promise.all([
    db
      .from('project_overrides')
      .select(
        'featured, featured_order, hidden, title_override, description_override, notes_md, comments_enabled, extra_gallery',
      )
      .eq('project_id', id)
      .maybeSingle(),
    db
      .from('project_links')
      .select('external_id, url, downloads')
      .eq('project_id', id)
      .eq('platform', 'curseforge')
      .maybeSingle(),
  ]);
  if (override.error) throw new Error(`admin override read failed: ${override.error.code}`);
  if (link.error) throw new Error(`admin link read failed: ${link.error.code}`);

  return {
    id: project.data.id,
    slug: project.data.slug,
    title: project.data.title,
    description: project.data.description,
    projectType: project.data.project_type,
    source: project.data.source,
    status: project.data.status,
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
        }
      : null,
    curseforgeLink: link.data
      ? {
          externalId: link.data.external_id,
          url: link.data.url,
          downloads: link.data.downloads,
        }
      : null,
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
 * T-UNIT-30 via `sortVersionsForTable`): versions newest-first, files primary-first. One select —
 * `project_files` rides the `project_versions` FK embed. Same RLS story as `getAdminProject`:
 * a moderator on a draft/hidden project never reaches this call (the page 404s first).
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

// ---- Sync status (`sync_runs`) ---------------------------------------------------------------

/** 04 J-S staleness window: no `ok=true` run in the last 6 h ⇒ the source is stale. */
export const SYNC_STALE_WINDOW_MS = 6 * 60 * 60 * 1000;

/** The sources `/admin/projects` shows (02 §1.3 Data cell: `sync_runs` (modrinth/curseforge)). */
export const PROJECT_SYNC_SOURCES = ['modrinth', 'curseforge'] as const;
export type ProjectSyncSource = (typeof PROJECT_SYNC_SOURCES)[number];

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
