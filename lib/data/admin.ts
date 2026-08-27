/**
 * lib/data/admin.ts — read-side queries for the dynamic admin surfaces (02 §1.3 Data columns:
 * `/admin/projects` = `projects` (all statuses) + `project_overrides` + `project_links` +
 * `sync_runs` (modrinth/curseforge); `/admin/projects/[id]` = the same, by id; 01 INV-12 "reads
 * go through `lib/data/<area>.ts`"; registry Modules `data/<area>.ts` — `admin` added 2026-08-27,
 * registry add-first rule).
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
import { combinedDownloads } from '@/lib/format/downloads';
import { createServerClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/types';

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
      'id, slug, title, description, project_type, source, status, downloads_modrinth, downloads_curseforge, downloads_direct',
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
