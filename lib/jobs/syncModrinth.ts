/**
 * lib/jobs/syncModrinth.ts — hourly Modrinth sync (04 §3.1 steps 1–5 verbatim; §3 pipeline;
 * SC-11/SC-13 via lib/jobs/runs.ts; J-P/J-I/J-D; 01 INV-24/INV-72; ADR-0002 #66/#77/A8;
 * 05 T-ACT-45..51, T-ACT-70).
 *
 * Pipeline: lock (SC-13) → insert `sync_runs` → work → finalize (SC-11, try/finally) → revalidate
 * tags → return `JobSummary`. Idempotency keys: `projects (source='modrinth', external_id)`,
 * `project_versions.external_id`, `project_files (version_id, filename)` — matched in code because
 * only the projects pair has a DB unique constraint. J-I: every write is preceded by a column
 * compare, so a run with unchanged upstream data touches nothing but `synced_at` (and the
 * `set_updated_at` trigger's `updated_at`). Versions/files absent upstream are kept (ADR-0002 #66);
 * projects absent from the list go `status='hidden'`, never removed (step 4, skipped when the list
 * call failed). `project_overrides` is never touched (step 2). No notification events in S1.2 —
 * failures go to `log.error` + `sync_runs.error` only (ADR-0002 A8).
 *
 * Revalidate (04 §3.1): `projects`; `project:<slug>` for every upserted/hidden slug — none on a
 * no-change run (05 T-ACT-51). A slug whose versions/files changed revalidates too (the detail page
 * renders them).
 */
import 'server-only';
import { revalidateTag } from 'next/cache';
import { sleep } from '@/lib/adapters/http';
import {
  createModrinth,
  mapProject,
  mapVersion,
  type ModrinthVersion,
  type ProjectRow,
  type VersionFileRow,
  type VersionRow,
} from '@/lib/adapters/modrinth';
import { env } from '@/lib/env';
import { MODRINTH_CALL_SPACING_MS } from '@/lib/jobs/constants';
import { findOpenRun, finalizeRun, insertRun } from '@/lib/jobs/runs';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';
import { log } from '@/lib/log';
import { createAdminClient } from '@/lib/supabase/admin';

const JOB = 'syncModrinth';
const SOURCE = 'modrinth' as const;

/** J-P: at most 20 entries in `summary.errors[]`; each clipped so no giant body lands in JSON. */
const ERRORS_LIMIT = 20;
const ERROR_ENTRY_LIMIT = 300;

/** The 04 §3.1 step-2 sync-owned columns (+ id/external_id for matching, status for step 4). */
const PROJECT_COLUMNS =
  'id, external_id, slug, project_type, title, description, body_md, icon_url, gallery, ' +
  'categories, loaders, game_versions, license, source_url, issues_url, discord_url, ' +
  'downloads_modrinth, followers, published_at, external_updated_at, status';

const VERSION_COLUMNS =
  'id, external_id, version_number, name, changelog_md, game_versions, loaders, version_type, ' +
  'date_published, downloads';

const FILE_COLUMNS = 'id, filename, size_bytes, sha512, url, primary, storage_path';

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushError(errors: string[], entry: string): void {
  if (errors.length < ERRORS_LIMIT) errors.push(entry.slice(0, ERROR_ENTRY_LIMIT));
}

function isoOrNull(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** Deep key-sort before stringify: jsonb re-orders object keys, so raw stringify would lie. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) out[key] = sortKeysDeep(record[key]);
    return out;
  }
  return value;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeysDeep(a)) === JSON.stringify(sortKeysDeep(b));
}

/** The step-2 write payload — sync-owned columns only (`project_overrides` untouched). */
function projectPayload(mapped: ProjectRow) {
  return {
    slug: mapped.slug,
    // step 2 imports only P1–P4 rows, so the type is never null here.
    project_type: mapped.project_type as NonNullable<ProjectRow['project_type']>,
    title: mapped.title,
    description: mapped.description,
    // `projects.body_md` is NOT NULL (data-model §2.2); a Modrinth project with no body maps to ''.
    body_md: mapped.body_md ?? '',
    icon_url: mapped.icon_url,
    gallery: mapped.gallery,
    categories: mapped.categories,
    loaders: mapped.loaders,
    game_versions: mapped.game_versions,
    license: mapped.license,
    source_url: mapped.source_url,
    issues_url: mapped.issues_url,
    discord_url: mapped.discord_url,
    downloads_modrinth: mapped.downloads_modrinth,
    followers: mapped.followers,
    published_at: isoOrNull(mapped.published_at),
    external_updated_at: isoOrNull(mapped.external_updated_at),
    status: 'published' as const,
  };
}

type ExistingProject = Record<string, unknown> & {
  id: string;
  external_id: string | null;
  slug: string;
  status: string;
};

/** Same-shape view of a DB row for the change compare (timestamps normalized to ISO UTC). */
function projectFingerprint(row: ExistingProject): Record<string, unknown> {
  return {
    slug: row.slug,
    project_type: row['project_type'],
    title: row['title'],
    description: row['description'],
    body_md: row['body_md'],
    icon_url: row['icon_url'],
    gallery: row['gallery'],
    categories: row['categories'],
    loaders: row['loaders'],
    game_versions: row['game_versions'],
    license: row['license'],
    source_url: row['source_url'],
    issues_url: row['issues_url'],
    discord_url: row['discord_url'],
    downloads_modrinth: row['downloads_modrinth'],
    followers: row['followers'],
    published_at: isoOrNull(row['published_at'] as string | null),
    external_updated_at: isoOrNull(row['external_updated_at'] as string | null),
    status: row.status,
  };
}

function versionPayload(version: VersionRow, fallbackDate: string | null) {
  return {
    external_id: version.external_id,
    version_number: version.version_number,
    name: version.name,
    changelog_md: version.changelog_md,
    game_versions: version.game_versions,
    loaders: version.loaders,
    version_type: version.version_type,
    // `date_published` is NOT NULL; a raw version without one keeps the stored date (or now).
    date_published:
      version.date_published?.toISOString() ?? fallbackDate ?? new Date().toISOString(),
    downloads: version.downloads,
  };
}

function filePayload(file: VersionFileRow) {
  return {
    filename: file.filename,
    size_bytes: file.size_bytes,
    sha512: file.sha512,
    url: file.url,
    primary: file.primary,
    storage_path: file.storage_path,
  };
}

type Db = ReturnType<typeof createAdminClient>;

/**
 * Step 3: upsert versions on `external_id` (fallback: `version_number`, the DB unique pair) and
 * files on `(version_id, filename)`. Absent-upstream rows are kept (ADR-0002 #66); `download_count`
 * is never written by sync. Returns changed-row counts (unchanged rows get no write — J-I).
 */
async function upsertVersions(
  db: Db,
  projectId: string,
  rawVersions: ModrinthVersion[],
): Promise<{ versions: number; files: number }> {
  const { data: existing, error } = await db
    .from('project_versions')
    .select(VERSION_COLUMNS)
    .eq('project_id', projectId);
  if (error) throw new Error(`project_versions read failed: ${error.message}`);

  let versionsChanged = 0;
  let filesChanged = 0;
  for (const raw of rawVersions) {
    const { version, files } = mapVersion(raw);
    const current =
      existing.find((row) => row.external_id === version.external_id) ??
      existing.find((row) => row.version_number === version.version_number);
    const payload = versionPayload(version, current?.date_published ?? null);

    let versionId: string;
    if (current === undefined) {
      const inserted = await db
        .from('project_versions')
        .insert({ project_id: projectId, ...payload })
        .select('id')
        .single();
      if (inserted.error) {
        throw new Error(`project_versions insert failed: ${inserted.error.message}`);
      }
      versionId = inserted.data.id;
      versionsChanged += 1;
    } else {
      versionId = current.id;
      const fingerprint = {
        external_id: current.external_id,
        version_number: current.version_number,
        name: current.name,
        changelog_md: current.changelog_md,
        game_versions: current.game_versions,
        loaders: current.loaders,
        version_type: current.version_type,
        date_published: isoOrNull(current.date_published),
        downloads: current.downloads,
      };
      if (!same(fingerprint, { ...payload, date_published: isoOrNull(payload.date_published) })) {
        const updated = await db.from('project_versions').update(payload).eq('id', versionId);
        if (updated.error) {
          throw new Error(`project_versions update failed: ${updated.error.message}`);
        }
        versionsChanged += 1;
      }
    }

    filesChanged += await upsertFiles(db, versionId, files);
  }
  return { versions: versionsChanged, files: filesChanged };
}

async function upsertFiles(db: Db, versionId: string, files: VersionFileRow[]): Promise<number> {
  const { data: existing, error } = await db
    .from('project_files')
    .select(FILE_COLUMNS)
    .eq('version_id', versionId);
  if (error) throw new Error(`project_files read failed: ${error.message}`);

  let changed = 0;
  for (const file of files) {
    const payload = filePayload(file);
    const current = existing.find((row) => row.filename === file.filename);
    if (current === undefined) {
      const inserted = await db.from('project_files').insert({ version_id: versionId, ...payload });
      if (inserted.error) throw new Error(`project_files insert failed: ${inserted.error.message}`);
      changed += 1;
    } else {
      const fingerprint = {
        filename: current.filename,
        size_bytes: current.size_bytes,
        sha512: current.sha512,
        url: current.url,
        primary: current.primary,
        storage_path: current.storage_path,
      };
      if (!same(fingerprint, payload)) {
        const updated = await db.from('project_files').update(payload).eq('id', current.id);
        if (updated.error) throw new Error(`project_files update failed: ${updated.error.message}`);
        changed += 1;
      }
    }
  }
  return changed;
}

/** 04 §3.1 — hourly Modrinth sync. `opts.full` is a youtube-only flag and is ignored here. */
export async function syncModrinth(opts: JobOptions): Promise<JobSummary> {
  const started = Date.now();
  const db = createAdminClient();

  // SC-13 — an open run younger than JOB_LOCK_MINUTES holds the lock: no work, no new row.
  const openRun = await findOpenRun(db, SOURCE);
  if (openRun !== null) {
    log.info({ job: JOB, id: openRun, msg: 'skipped', meta: { reason: 'running', trigger: opts.trigger } });
    return { ok: true, source: SOURCE, run_id: openRun, items: 0, ms: Date.now() - started, skipped: 'running' };
  }

  const runId = opts.runId ?? (await insertRun(db, SOURCE));

  let ok = true;
  let errorText: string | null = null;
  let upserted = 0;
  let hidden = 0;
  let skipped = 0;
  let versions = 0;
  let files = 0;
  const errors: string[] = [];
  const changedSlugs = new Set<string>();

  try {
    const modrinth = createModrinth({ env });

    // Step 1 — one list call returns full Project objects (gallery, body, license included).
    let list: Awaited<ReturnType<typeof modrinth.listUserProjects>> | null = null;
    try {
      list = await modrinth.listUserProjects(env.MODRINTH_USER);
    } catch (error) {
      // J-P: a failed list call fails the run; steps 2–5 (including hiding) are skipped.
      ok = false;
      errorText = `list: ${message(error)}`;
      pushError(errors, errorText);
    }

    if (list !== null) {
      const existingRead = await db.from('projects').select(PROJECT_COLUMNS).eq('source', SOURCE);
      if (existingRead.error) throw new Error(`projects read failed: ${existingRead.error.message}`);
      const existingRows = existingRead.data as ExistingProject[];
      const byExternalId = new Map<string, ExistingProject>();
      for (const row of existingRows) {
        if (row.external_id !== null) byExternalId.set(row.external_id, row);
      }

      let attempted = 0;
      let failedItems = 0;
      for (const raw of list) {
        // Step 2 — only the two publicly-listable Modrinth statuses are imported.
        if (raw.status !== 'approved' && raw.status !== 'archived') continue;
        const mapped = mapProject(raw);
        if (mapped.project_type === null) {
          // Step 5 / §5.2 P5 — modpack/shader/other: not imported, counted, not an error.
          skipped += 1;
          continue;
        }
        attempted += 1;
        try {
          const payload = projectPayload(mapped);
          const syncedAt = new Date().toISOString();
          const existing = byExternalId.get(mapped.external_id);
          let projectId: string;
          if (existing === undefined) {
            const inserted = await db
              .from('projects')
              .insert({ source: SOURCE, external_id: mapped.external_id, ...payload, synced_at: syncedAt })
              .select('id')
              .single();
            if (inserted.error) throw new Error(`projects insert failed: ${inserted.error.message}`);
            projectId = inserted.data.id;
            upserted += 1;
            changedSlugs.add(payload.slug);
          } else {
            projectId = existing.id;
            if (same(projectFingerprint(existing), payload)) {
              // J-I — unchanged upstream data: only `synced_at` moves.
              const touched = await db.from('projects').update({ synced_at: syncedAt }).eq('id', projectId);
              if (touched.error) throw new Error(`projects touch failed: ${touched.error.message}`);
            } else {
              const updated = await db
                .from('projects')
                .update({ ...payload, synced_at: syncedAt })
                .eq('id', projectId);
              if (updated.error) throw new Error(`projects update failed: ${updated.error.message}`);
              upserted += 1;
              changedSlugs.add(payload.slug);
              // A renamed slug invalidates the old detail page too.
              if (existing.slug !== payload.slug) changedSlugs.add(existing.slug);
            }
          }

          // Step 3 — sequential version calls with 100 ms spacing (04 §5.8).
          await sleep(MODRINTH_CALL_SPACING_MS);
          const rawVersions = await modrinth.listVersions(raw.id);
          const counts = await upsertVersions(db, projectId, rawVersions);
          versions += counts.versions;
          files += counts.files;
          if (counts.versions > 0 || counts.files > 0) changedSlugs.add(payload.slug);
        } catch (error) {
          // J-P: a per-item error keeps old data and is counted, never rethrown.
          failedItems += 1;
          pushError(errors, `${raw.slug}: ${message(error)}`);
        }
      }

      // Step 4 — rows absent from the list go hidden (never removed, J-D). Already-hidden rows
      // stay untouched so a rerun changes nothing (T-ACT-49/T-ACT-51).
      const listedIds = new Set(list.map((project) => project.id));
      for (const row of existingRows) {
        if (row.external_id === null || listedIds.has(row.external_id) || row.status === 'hidden') {
          continue;
        }
        const hid = await db.from('projects').update({ status: 'hidden' }).eq('id', row.id);
        if (hid.error) throw new Error(`projects hide failed: ${hid.error.message}`);
        hidden += 1;
        changedSlugs.add(row.slug);
      }

      // J-P: the run fails only when the list call failed or > 50 % of items failed.
      if (failedItems > attempted / 2) {
        ok = false;
        errorText = `${String(failedItems)}/${String(attempted)} items failed: ${errors.join('; ')}`;
      }
    }
  } catch (error) {
    ok = false;
    errorText = message(error);
    pushError(errors, errorText);
  } finally {
    // SC-11 — exactly one row per invocation, finalized on every path including thrown errors.
    await finalizeRun(db, runId, { ok, items: upserted, error: ok ? null : (errorText ?? 'failed') });
  }

  // 04 §3.1 revalidate — after the run row is finalized; nothing on a no-change run.
  if (changedSlugs.size > 0) {
    revalidateTag('projects');
    for (const slug of changedSlugs) revalidateTag(`project:${slug}`);
  }

  if (ok) {
    log.info({
      job: JOB,
      id: runId,
      msg: 'done',
      meta: { trigger: opts.trigger, items: upserted, hidden, skipped, versions, files, errors: errors.length },
    });
  } else {
    // ADR-0002 A8 — S1.2 jobs log failures only; `sync.failed` emission starts in S1.5.
    log.error({
      job: JOB,
      id: runId,
      msg: 'failed',
      meta: { trigger: opts.trigger, error: errorText ?? 'failed', errors: errors.length },
    });
  }

  const summary: JobSummary = {
    ok,
    source: SOURCE,
    run_id: runId,
    items: upserted,
    ms: Date.now() - started,
    hidden,
    skipped,
    versions,
    files,
    errors,
  };
  if (!ok) summary.error = errorText ?? 'failed';
  return summary;
}
