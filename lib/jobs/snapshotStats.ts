/**
 * lib/jobs/snapshotStats.ts — the daily 03:00 UTC stats snapshot + housekeeping (04 §3.5; §3 pipeline
 * through `lib/jobs/runner.ts` `runJob` — SC-11 row, SC-13 lock, J-F `sync.failed` emission (ADR-0030
 * D1); 04 §1.4.5 U1 orphan cleanup; 04 §5.8 tunables in `lib/jobs/constants.ts`; 01 INV-24 (the only
 * deletions in `lib/jobs/` are this file's housekeeping — RPC purges + `storage.remove()`, never a
 * `.delete(`), INV-68 (UTC days), INV-71; 00 S1.9 AC1 / AC9; 05 T-ACT-33, T-ACT-45, T-ACT-55,
 * T-ACT-70, T-ACT-74, T-ACT-75; ADR-0049 D5..ADR-0049 D7, ADR-0049 D19..ADR-0049 D21).
 *
 * Idempotency key: `stats_daily (day, metric, source, entity_type, entity_id)` — every write is
 * `upsert … onConflict` (`insert … on conflict do update set value = excluded.value`), `day` = the
 * UTC date of the run, site and channel rows carry the sentinel `entity_id` (`SITE_ENTITY_ID`).
 * Running twice on one day rewrites the same rows (AC1 "twice = same rows").
 *
 * Order — GATHER, THEN WRITE, THEN HOUSEKEEPING (ADR-0049 D5):
 *   1. Reads through the service client, paged at 1,000 where a table can grow (`readPaged`):
 *      `projects` (every row, any status — `id`, the three `downloads_*` totals), `videos` (`id`,
 *      `view_count`, `like_count`), `comments` head-counts for `published` / `held`,
 *      `comments.like_count` → sum, `profiles` head-count where `handle is not null` (ONE aggregate
 *      number — ADR-0002 #68, never a per-user row), published `mentions` (`view_count` → count +
 *      sum, nulls = 0), `project_downloads` on the completed UTC day before the run (ADR-0049 D19 window
 *      `[day−1 00:00Z, day 00:00Z)`) → count per project. Last, ONLY when `YOUTUBE_API_KEY` is set:
 *      `channels.list part=statistics` once (1 unit, ADR-0049 D20) — a failure there is a J-P per-item
 *      error (`errors[]`, channel rows skipped, `ok` unaffected); without the key both channel rows
 *      are skipped with `units` 0 and the run is NOT a `not_configured` skip (the key gates one
 *      optional metric group, not the job).
 *   2. `buildSnapshotRows` (pure — exported for the unit-testable core, §4.3 row rules) and the
 *      upsert in chunks of `STATS_UPSERT_CHUNK`. Any read or upsert failure → `ok=false`, the message
 *      as `error`, `items` 0, housekeeping skipped (ADR-0049 D21). Rows a chunk already upserted before a
 *      later chunk failed are the same idempotent rows the next run rewrites.
 *   3. Housekeeping (04 §3.5): `purge_project_downloads(PROJECT_DOWNLOADS_RETENTION_DAYS)`,
 *      `purge_rate_limit_hits(RATE_LIMIT_HITS_RETENTION_DAYS)` (both return the deleted count), then
 *      the U1 orphan sweep (below). Each step is independent and all three are attempted; any
 *      failure → an `errors[]` entry AND `ok=false` with the failures joined as `error` (01 INV-71 —
 *      a failure the allay must hear about) while the snapshot rows already written stay.
 *
 * U1 orphan sweep (04 §1.4.5; ADR-0049 D6): an object with no committed row is garbage. Buckets scanned =
 * `ORPHAN_BUCKETS` (`project-files`, `project-media`, `art`); `avatars` and `skins` are never listed.
 * Referenced objects = `project_files.storage_path`, `projects.icon_url` and `projects.gallery[].url`
 * when they start with `project-media/`, `project_overrides.extra_gallery[].path`, `art.image_path` —
 * every value that starts with a scanned bucket's prefix, kept bucket-prefixed as the DB stores them
 * (SC-21). Candidates per bucket come from the RPC `list_stale_objects(bucket, ORPHAN_MIN_AGE_HOURS,
 * ORPHAN_CLEANUP_MAX)` (objects older than 24 h, oldest first; names WITHOUT the bucket prefix — the
 * job re-attaches it). `planOrphanRemovals` (pure, exported) subtracts the referenced set and caps
 * the whole run at `ORPHAN_CLEANUP_MAX` removals (`capped: true` when the cap stopped it); removal is
 * `storage.from(bucket).remove(names)` in chunks of `REMOVE_CHUNK`. A failed reference read removes
 * NOTHING (an incomplete reference set could name a live object an orphan); a failed list or remove
 * is recorded per bucket / chunk and the sweep goes on with the rest. Supabase Studio's
 * `.emptyFolderPlaceholder` markers are skipped — they are folder markers, not failed uploads.
 *
 * Revalidate: none (04 §3.5) — `tags: []`.
 *
 * Summary (ADR-0049 D7): `{ ok, source: 'stats', run_id, items, ms, day, rows: { project, site, video,
 * channel, direct_days }, purged: { project_downloads, rate_limit_hits }, orphans: { scanned,
 * removed, capped }, units, errors: string[] }` — `items` = rows upserted, `errors` ≤ 20 entries of
 * ≤ 300 chars (the `pushError` pattern), `orphans.scanned` = stale candidates listed across the
 * buckets. Log meta = counts only.
 */
import 'server-only';
import { createYoutube, type ChannelStats } from '@/lib/adapters/youtube';
import { env } from '@/lib/env';
import {
  ORPHAN_BUCKETS,
  ORPHAN_CLEANUP_MAX,
  ORPHAN_MIN_AGE_HOURS,
  PROJECT_DOWNLOADS_RETENTION_DAYS,
  RATE_LIMIT_HITS_RETENTION_DAYS,
  STATS_UPSERT_CHUNK,
} from '@/lib/jobs/constants';
import { runJob, type JobDb } from '@/lib/jobs/runner';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';
import {
  addDays,
  SITE_ENTITY_ID,
  utcDay,
  type StatsEntityType,
  type StatsMetric,
  type StatsSource,
} from '@/lib/stats';

const JOB = 'snapshotStats';
const SOURCE = 'stats' as const;

/** J-P: at most 20 entries in `summary.errors[]`, each ≤ 300 chars. */
const ERRORS_LIMIT = 20;
const ERROR_ENTRY_LIMIT = 300;

/** PostgREST answers at most 1,000 rows per read (`supabase/config.toml` `max_rows`). */
const READ_PAGE = 1000;

/** Object names per `storage.remove()` request (ADR-0049 D6 "chunks ≤ 100"). */
const REMOVE_CHUNK = 100;

/** Supabase Studio's zero-byte folder marker — never an orphan. */
const PLACEHOLDER_SUFFIX = '.emptyFolderPlaceholder';

// ---------------------------------------------------------------------------------------------
// Pinned shapes (§4.3)
// ---------------------------------------------------------------------------------------------

/** One `stats_daily` row as the job upserts it (the `Insert` shape narrowed to the registry vocabulary). */
export type SnapshotRow = {
  day: string;
  metric: StatsMetric;
  source: StatsSource;
  entity_type: StatsEntityType;
  entity_id: string;
  value: number;
};

/** Everything step 1 gathers — `buildSnapshotRows` turns it into rows without touching the DB. */
export type SnapshotInput = {
  /** The UTC date of the run (`YYYY-MM-DD`). */
  day: string;
  projects: {
    id: string;
    downloads_modrinth: number;
    downloads_curseforge: number;
    downloads_direct: number;
  }[];
  videos: { id: string; view_count: number | null; like_count: number | null }[];
  commentsPublished: number;
  commentsHeld: number;
  likes: number;
  users: number;
  reach: number;
  mentions: number;
  /** `project_id` → `project_downloads` rows on day − 1 (ADR-0049 D19; only projects with ≥ 1 row). */
  directDownloadsByProject: Map<string, number>;
  /** `channels.list` answer, or null when the key is unset / the call failed (ADR-0049 D20). */
  channel: { views: number; subs: number | null } | null;
};

/** ADR-0049 D7 `rows` — how many rows of each group the run built. */
export type SnapshotRowCounts = {
  project: number;
  site: number;
  video: number;
  channel: number;
  direct_days: number;
};

/** One stale object the RPC listed: the bucket it came from + its name inside that bucket. */
export type OrphanCandidate = { bucket: string; name: string };

/** `planOrphanRemovals` verdict: the objects to remove, in candidate order, and whether the cap cut it. */
export type OrphanPlan = { remove: OrphanCandidate[]; capped: boolean };

// ---------------------------------------------------------------------------------------------
// Pure core
// ---------------------------------------------------------------------------------------------

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushError(errors: string[], entry: string): void {
  if (errors.length < ERRORS_LIMIT) errors.push(entry.slice(0, ERROR_ENTRY_LIMIT));
}

/**
 * 04 §3.5 row rules (§4.3 of the S1.9 brief) — pure. Per project always the three `downloads` rows
 * (0 allowed); the 10 site rows (`downloads` ×3 sums + `comments`, `comments_held`, `likes`,
 * `users`, `reach/youtube`, `mentions`, `tips/kofi` = 0); per video `views/youtube` and
 * `likes/youtube` only when the column is non-null; channel rows per ADR-0049 D20 (`subs` skipped when
 * null, both skipped without an answer); `direct_downloads_day/direct` per project with ≥ 1
 * `project_downloads` row on day − 1 — dated day − 1, the UTC day the count describes (ADR-0049 D19).
 */
export function buildSnapshotRows(input: SnapshotInput): SnapshotRow[] {
  const { day } = input;
  const rows: SnapshotRow[] = [];
  const push = (
    metric: StatsMetric,
    source: StatsSource,
    entity_type: StatsEntityType,
    entity_id: string,
    value: number,
    rowDay: string = day,
  ): void => {
    rows.push({ day: rowDay, metric, source, entity_type, entity_id, value });
  };

  // (a) per project — current totals, always three rows.
  let modrinth = 0;
  let curseforge = 0;
  let direct = 0;
  for (const project of input.projects) {
    push('downloads', 'modrinth', 'project', project.id, project.downloads_modrinth);
    push('downloads', 'curseforge', 'project', project.id, project.downloads_curseforge);
    push('downloads', 'direct', 'project', project.id, project.downloads_direct);
    modrinth += project.downloads_modrinth;
    curseforge += project.downloads_curseforge;
    direct += project.downloads_direct;
  }

  // (b) site — sums + counts, the sentinel id.
  push('downloads', 'modrinth', 'site', SITE_ENTITY_ID, modrinth);
  push('downloads', 'curseforge', 'site', SITE_ENTITY_ID, curseforge);
  push('downloads', 'direct', 'site', SITE_ENTITY_ID, direct);
  push('comments', 'odsens', 'site', SITE_ENTITY_ID, input.commentsPublished);
  push('comments_held', 'odsens', 'site', SITE_ENTITY_ID, input.commentsHeld);
  push('likes', 'odsens', 'site', SITE_ENTITY_ID, input.likes);
  push('users', 'odsens', 'site', SITE_ENTITY_ID, input.users);
  push('reach', 'youtube', 'site', SITE_ENTITY_ID, input.reach);
  push('mentions', 'odsens', 'site', SITE_ENTITY_ID, input.mentions);
  // (f) tips — 0 in v1 (the Ko-fi webhook is S2.1).
  push('tips', 'kofi', 'site', SITE_ENTITY_ID, 0);

  // (c) per video — only the counts YouTube answered.
  for (const video of input.videos) {
    if (video.view_count !== null) push('views', 'youtube', 'video', video.id, video.view_count);
    if (video.like_count !== null) push('likes', 'youtube', 'video', video.id, video.like_count);
  }

  // (d) channel — ADR-0049 D20.
  if (input.channel !== null) {
    push('views', 'youtube', 'channel', SITE_ENTITY_ID, input.channel.views);
    if (input.channel.subs !== null) {
      push('subs', 'youtube', 'channel', SITE_ENTITY_ID, input.channel.subs);
    }
  }

  // (e) direct downloads per project on the completed day — ADR-0049 D19.
  const yesterday = addDays(day, -1);
  for (const [projectId, count] of input.directDownloadsByProject) {
    if (count > 0) push('direct_downloads_day', 'direct', 'project', projectId, count, yesterday);
  }

  return rows;
}

/** ADR-0049 D7 `rows`: the built rows counted per group. */
export function countSnapshotRows(rows: readonly SnapshotRow[]): SnapshotRowCounts {
  const counts: SnapshotRowCounts = { project: 0, site: 0, video: 0, channel: 0, direct_days: 0 };
  for (const row of rows) {
    if (row.metric === 'direct_downloads_day') counts.direct_days += 1;
    else if (row.entity_type === 'project') counts.project += 1;
    else if (row.entity_type === 'site') counts.site += 1;
    else if (row.entity_type === 'video') counts.video += 1;
    else counts.channel += 1;
  }
  return counts;
}

/**
 * U1 (ADR-0049 D6) — pure: which of the stale candidates to remove. A candidate is kept when its
 * bucket-prefixed path (`<bucket>/<name>`) is in `referenced` or when it is a Studio folder
 * marker; the rest are removed in candidate order (oldest first per bucket) until `max` removals,
 * after which `capped` is true and nothing more is planned.
 */
export function planOrphanRemovals(
  candidates: readonly OrphanCandidate[],
  referenced: ReadonlySet<string>,
  max: number,
): OrphanPlan {
  const limit = Math.max(0, Math.floor(max));
  const remove: OrphanCandidate[] = [];
  let capped = false;
  for (const candidate of candidates) {
    if (candidate.name.endsWith(PLACEHOLDER_SUFFIX)) continue;
    if (referenced.has(`${candidate.bucket}/${candidate.name}`)) continue;
    if (remove.length >= limit) {
      capped = true;
      break;
    }
    remove.push(candidate);
  }
  return { remove, capped };
}

/** Adds `value` to the referenced set when it is a path inside a scanned bucket (SC-21 shape). */
function addReferenced(referenced: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  for (const bucket of ORPHAN_BUCKETS) {
    if (value.startsWith(`${bucket}/`)) {
      referenced.add(value);
      return;
    }
  }
}

/** Every `url` / `path` of a gallery-shaped jsonb (`projects.gallery`, `project_overrides.extra_gallery`). */
function addGalleryReferences(referenced: Set<string>, json: unknown): void {
  if (!Array.isArray(json)) return;
  for (const item of json) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    addReferenced(referenced, record['url']);
    addReferenced(referenced, record['path']);
  }
}

// ---------------------------------------------------------------------------------------------
// Step 1 — gather (service client; every read throws on failure → the run is ok=false, no write)
// ---------------------------------------------------------------------------------------------

type Page<T> = { data: T[] | null; error: { message: string } | null };

/** A whole table (or filter) in `READ_PAGE` slices — the `refreshMentions` `readEligible` pattern. */
async function readPaged<T>(
  what: string,
  query: (from: number, to: number) => PromiseLike<Page<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const page = await query(from, from + READ_PAGE - 1);
    if (page.error) throw new Error(`${what} read failed: ${page.error.message}`);
    const data = page.data ?? [];
    rows.push(...data);
    if (data.length < READ_PAGE) return rows;
  }
}

/** A `head: true, count: 'exact'` read → the number. */
async function readCount(
  what: string,
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>,
): Promise<number> {
  const result = await query;
  if (result.error) throw new Error(`${what} count failed: ${result.error.message}`);
  return result.count ?? 0;
}

/** The DB half of `SnapshotInput` (`channel` is filled by `readChannel`). */
async function gather(db: JobDb, day: string): Promise<SnapshotInput> {
  const projects = await readPaged('projects', (from, to) =>
    db
      .from('projects')
      .select('id, downloads_modrinth, downloads_curseforge, downloads_direct')
      .order('id', { ascending: true })
      .range(from, to),
  );
  const videos = await readPaged('videos', (from, to) =>
    db
      .from('videos')
      .select('id, view_count, like_count')
      .order('id', { ascending: true })
      .range(from, to),
  );
  const commentsPublished = await readCount(
    'comments published',
    db.from('comments').select('id', { count: 'exact', head: true }).eq('status', 'published'),
  );
  const commentsHeld = await readCount(
    'comments held',
    db.from('comments').select('id', { count: 'exact', head: true }).eq('status', 'held'),
  );
  const likeRows = await readPaged('comments likes', (from, to) =>
    db.from('comments').select('like_count').order('id', { ascending: true }).range(from, to),
  );
  let likes = 0;
  for (const row of likeRows) likes += row.like_count;
  const users = await readCount(
    'profiles',
    db.from('profiles').select('id', { count: 'exact', head: true }).not('handle', 'is', null),
  );
  const mentionRows = await readPaged('mentions', (from, to) =>
    db
      .from('mentions')
      .select('view_count')
      .eq('status', 'published')
      .order('id', { ascending: true })
      .range(from, to),
  );
  let reach = 0;
  for (const row of mentionRows) reach += row.view_count ?? 0;

  // ADR-0049 D19: the completed UTC day before the run — `[day−1 00:00Z, day 00:00Z)`.
  const downloadRows = await readPaged('project_downloads', (from, to) =>
    db
      .from('project_downloads')
      .select('project_id')
      .gte('created_at', `${addDays(day, -1)}T00:00:00Z`)
      .lt('created_at', `${day}T00:00:00Z`)
      .order('id', { ascending: true })
      .range(from, to),
  );
  const directDownloadsByProject = new Map<string, number>();
  for (const row of downloadRows) {
    directDownloadsByProject.set(
      row.project_id,
      (directDownloadsByProject.get(row.project_id) ?? 0) + 1,
    );
  }

  return {
    day,
    projects,
    videos,
    commentsPublished,
    commentsHeld,
    likes,
    users,
    reach,
    mentions: mentionRows.length,
    directDownloadsByProject,
    channel: null,
  };
}

/**
 * ADR-0049 D20 — `channels.list part=statistics` once (1 unit) when the key is set. A failure is a per-item
 * error: recorded in `errors`, the channel rows are skipped, the run's `ok` is unaffected. The unit is
 * reported on the failure path too (a failed list still cost it).
 */
async function readChannel(
  errors: string[],
): Promise<{ channel: ChannelStats | null; units: number }> {
  if (env.YOUTUBE_API_KEY === undefined) return { channel: null, units: 0 };
  const youtube = createYoutube({ env });
  try {
    return { channel: await youtube.channelStats(), units: youtube.unitsUsed };
  } catch (error) {
    pushError(errors, `channel stats: ${message(error)}`);
    return { channel: null, units: youtube.unitsUsed };
  }
}

// ---------------------------------------------------------------------------------------------
// Step 2 — write
// ---------------------------------------------------------------------------------------------

/** The idempotent upsert, `STATS_UPSERT_CHUNK` rows a request (04 §3.5 idempotency key). */
async function writeRows(db: JobDb, rows: readonly SnapshotRow[]): Promise<void> {
  for (let start = 0; start < rows.length; start += STATS_UPSERT_CHUNK) {
    const chunk = rows.slice(start, start + STATS_UPSERT_CHUNK);
    const write = await db
      .from('stats_daily')
      .upsert(chunk, { onConflict: 'day,metric,source,entity_type,entity_id' });
    if (write.error) throw new Error(`stats_daily upsert failed: ${write.error.message}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Step 3 — housekeeping
// ---------------------------------------------------------------------------------------------

/** A purge RPC's answer (the deleted count), or a thrown error naming the RPC. */
async function purged(
  what: string,
  call: PromiseLike<{ data: number | null; error: { message: string } | null }>,
): Promise<number> {
  const result = await call;
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return result.data ?? 0;
}

/** U1: every bucket-prefixed object path a committed row references (ADR-0049 D6's five columns). */
async function readReferencedObjects(db: JobDb): Promise<Set<string>> {
  const referenced = new Set<string>();
  const files = await readPaged('project_files', (from, to) =>
    db
      .from('project_files')
      .select('storage_path')
      .not('storage_path', 'is', null)
      .order('id', { ascending: true })
      .range(from, to),
  );
  for (const file of files) addReferenced(referenced, file.storage_path);
  const projects = await readPaged('projects media', (from, to) =>
    db
      .from('projects')
      .select('icon_url, gallery')
      .order('id', { ascending: true })
      .range(from, to),
  );
  for (const project of projects) {
    addReferenced(referenced, project.icon_url);
    addGalleryReferences(referenced, project.gallery);
  }
  const overrides = await readPaged('project_overrides', (from, to) =>
    db
      .from('project_overrides')
      .select('extra_gallery')
      .order('project_id', { ascending: true })
      .range(from, to),
  );
  for (const override of overrides) addGalleryReferences(referenced, override.extra_gallery);
  const art = await readPaged('art', (from, to) =>
    db.from('art').select('image_path').order('id', { ascending: true }).range(from, to),
  );
  for (const piece of art) addReferenced(referenced, piece.image_path);
  return referenced;
}

type OrphanResult = { scanned: number; removed: number; capped: boolean; failures: string[] };

/**
 * U1 orphan sweep (ADR-0049 D6). A failed reference read removes nothing; a failed list or remove is one
 * failure entry and the sweep continues with the other buckets / chunks.
 */
async function cleanupOrphans(db: JobDb): Promise<OrphanResult> {
  const result: OrphanResult = { scanned: 0, removed: 0, capped: false, failures: [] };
  let referenced: Set<string>;
  try {
    referenced = await readReferencedObjects(db);
  } catch (error) {
    result.failures.push(`orphan references: ${message(error)}`);
    return result;
  }

  const candidates: OrphanCandidate[] = [];
  for (const bucket of ORPHAN_BUCKETS) {
    const list = await db.rpc('list_stale_objects', {
      p_bucket: bucket,
      p_min_age_hours: ORPHAN_MIN_AGE_HOURS,
      p_limit: ORPHAN_CLEANUP_MAX,
    });
    if (list.error) {
      result.failures.push(`list_stale_objects ${bucket} failed: ${list.error.message}`);
      continue;
    }
    for (const row of list.data) candidates.push({ bucket, name: row.name });
  }
  result.scanned = candidates.length;

  const plan = planOrphanRemovals(candidates, referenced, ORPHAN_CLEANUP_MAX);
  result.capped = plan.capped;
  for (const bucket of ORPHAN_BUCKETS) {
    const names = plan.remove.filter((entry) => entry.bucket === bucket).map((entry) => entry.name);
    for (let start = 0; start < names.length; start += REMOVE_CHUNK) {
      const chunk = names.slice(start, start + REMOVE_CHUNK);
      const removal = await db.storage.from(bucket).remove(chunk);
      if (removal.error) {
        result.failures.push(`storage remove ${bucket} failed: ${removal.error.message}`);
        continue;
      }
      result.removed += removal.data.length;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// The job
// ---------------------------------------------------------------------------------------------

/**
 * 04 §3.5 — the daily snapshot. `opts.full` is a youtube-only flag and is ignored here. Lock,
 * `sync_runs` row, logging and J-F come from `runJob` (ADR-0030 D1).
 */
export async function snapshotStats(opts: JobOptions): Promise<JobSummary> {
  return runJob({
    source: SOURCE,
    job: JOB,
    opts,
    work: async ({ db }) => {
      // 04 §3.5 / 01 INV-68: `day` = the UTC calendar date of the run, fixed at entry.
      const day = utcDay(new Date());
      const errors: string[] = [];
      let ok = true;
      let errorText: string | null = null;
      let items = 0;
      let units = 0;
      let rows: SnapshotRowCounts = { project: 0, site: 0, video: 0, channel: 0, direct_days: 0 };
      const purges = { project_downloads: 0, rate_limit_hits: 0 };
      const orphans = { scanned: 0, removed: 0, capped: false };

      // ---- Gather (step 1), then write (step 2): a failure in either → ok=false, nothing else runs. ----
      try {
        const input = await gather(db, day);
        const channel = await readChannel(errors);
        units = channel.units;
        input.channel = channel.channel;

        const built = buildSnapshotRows(input);
        rows = countSnapshotRows(built);
        await writeRows(db, built);
        items = built.length;
      } catch (error) {
        ok = false;
        errorText = message(error);
        pushError(errors, errorText);
        rows = { project: 0, site: 0, video: 0, channel: 0, direct_days: 0 };
      }

      // ---- Housekeeping (step 3): every step attempted; any failure → ok=false (ADR-0049 D21). ----
      if (ok) {
        const failures: string[] = [];
        try {
          purges.project_downloads = await purged(
            'purge_project_downloads',
            db.rpc('purge_project_downloads', { p_days: PROJECT_DOWNLOADS_RETENTION_DAYS }),
          );
        } catch (error) {
          failures.push(message(error));
        }
        try {
          purges.rate_limit_hits = await purged(
            'purge_rate_limit_hits',
            db.rpc('purge_rate_limit_hits', { p_days: RATE_LIMIT_HITS_RETENTION_DAYS }),
          );
        } catch (error) {
          failures.push(message(error));
        }
        const sweep = await cleanupOrphans(db);
        orphans.scanned = sweep.scanned;
        orphans.removed = sweep.removed;
        orphans.capped = sweep.capped;
        failures.push(...sweep.failures);

        if (failures.length > 0) {
          ok = false;
          errorText = failures.join('; ');
          for (const failure of failures) pushError(errors, failure);
        }
      }

      return {
        ok,
        items,
        error: ok ? null : (errorText ?? 'failed'),
        extra: { day, rows, purged: purges, orphans, units, errors },
        tags: [], // 04 §3.5 revalidates nothing
        logMeta: {
          units,
          project: rows.project,
          site: rows.site,
          video: rows.video,
          channel: rows.channel,
          direct_days: rows.direct_days,
          purged_project_downloads: purges.project_downloads,
          purged_rate_limit_hits: purges.rate_limit_hits,
          orphans_scanned: orphans.scanned,
          orphans_removed: orphans.removed,
          orphans_capped: orphans.capped,
          errors: errors.length,
        },
      };
    },
  });
}
