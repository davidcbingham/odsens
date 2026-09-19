/**
 * lib/jobs/syncYoutube.ts — hourly YouTube uploads sync (04 §3.3 as amended by ADR-0043 D1/D2; §3
 * pipeline through `lib/jobs/runner.ts` `runJob` — SC-11/SC-13, SC-07 tags, J-F edge emission
 * (ADR-0030 D1); SC-16 no-key degradation; SC-25 adapter built from `lib/env.ts` once per run;
 * J-P/J-I/J-D; 01 INV-24/INV-54/INV-71; 00 S1.6 AC1/AC9/AC11; 05 T-ACT-45, T-ACT-53, T-ACT-71,
 * T-ACT-74, T-ADP-13).
 *
 * Idempotency key: `videos.youtube_id` (04 §3.3).
 *
 * Order — GATHER, THEN WRITE (ADR-0043 D2). Every upstream list is read into memory before the
 * first row is written, so a list-call failure changes no row (05 T-ACT-45) and a live / upcoming
 * upload never gets a stub row that J-D would then keep for ever:
 *   1. Read the existing `videos` rows (paged — PostgREST caps a read at 1,000 rows). "Table empty"
 *      (04 §3.3 step 3) is decided here, before anything is written.
 *   2. `fetchRss()` — keyless, 0 units, the newest 15 uploads (04 §3.3 step 1). This is "the list
 *      call" of J-P / AC11.
 *   3. Key set AND (`full` OR table empty): `listUploads()` walks the uploads playlist so every
 *      upload is known, not only the feed's 15 (AC1 "all channel uploads"; 04 §3.3 step 3).
 *   4. Key set: `listVideos(existing ∪ rss ∪ walk)` in batches of ≤ 50 (04 §3.3 step 2). The adapter
 *      drops live / upcoming items (ADR-0002 #77), so an id that does not come back mapped is
 *      deleted, private, live or upcoming.
 *   Any of 1–4 failing → `ok=false`, the message as `error`, ZERO writes, no tags; the runner then
 *   emits `sync.failed` per J-F (edge-triggered — 05 T-ACT-74 youtube, ADR-0043 D10).
 *   5. Writes, one id at a time (J-P: a per-item error is counted in `summary.errors[]` ≤ 20 and
 *      never rethrown; the run is `ok=false` only when > 50 % of the attempted ids failed):
 *      - Keyed run: for each MAPPED video that was asked for — unknown id → insert; known id →
 *        update when a synced column differs, else only `synced_at` moves (J-I). An RSS id that did
 *        not come back mapped is NOT inserted (live / upcoming never get a row — ADR-0043 D2); a
 *        known row that did not come back is left exactly as it is (never hidden, never removed —
 *        04 §3.3 step 4, J-D). A mapped id nobody asked about is ignored.
 *      - No-key run (`summary.degraded='no_key'`, run `ok=true`, no `skipped` marker, `error` NULL —
 *        04 §3.3 Quota row, 05 T-ACT-71): RSS-only. Unknown id → minimal row `{title, published_at,
 *        thumbnail_url}`; known id → only `title` / `published_at` may change. An RSS-only run never
 *        downgrades Data-API fields (`description`, best thumbnail, duration, counts stay as stored).
 *        The playlist walk needs the key, so `full` / an empty table is silently RSS-only too.
 *
 * Admin-owned columns (04 §1.8 `updateVideo`, ADR-0002 #20): `hidden` and `is_short_override` are
 * never part of a payload this file writes — not on insert (the column defaults apply), not on
 * update. The effective flag readers filter on is `is_short = is_short_override ?? isShort(v)`
 * (ADR-0043 D1; 04 §5.3 heuristic from the adapter), so an override survives every run while the
 * heuristic keeps following upstream for rows without one. New rows go in with
 * `onConflict: 'youtube_id'` + `ignoreDuplicates` — a row that appeared since step 1 is left alone
 * rather than overwritten.
 *
 * Thumbnails (01 INV-54 allows `i.ytimg.com` only): the feed's `media:thumbnail@url` lives on
 * `i1…i4.ytimg.com`, so it is never stored — an RSS-minimal row gets the 04 §3.3 literal
 * `https://i.ytimg.com/vi/<id>/hqdefault.jpg`, which is also the fallback when the Data API sends no
 * thumbnail at all (`videos.thumbnail_url` is NOT NULL).
 *
 * J-D: this job never removes a `videos` row — a video absent from a `full` walk stays (04 §3.3
 * step 4).
 *
 * Quota (04 §3.3; AC9): 1 RSS (0 units) + ceil(N/50) `videos.list` units; a walk adds ceil(N/50).
 * `summary.units` and the run's `done` / `failed` log line (`meta.units`) carry what the adapter
 * counted (`unitsUsed`) — never the key (SC-15).
 *
 * Revalidate (04 §3.3, 02 §5): `videos` — only when a row was inserted or changed; none on a
 * no-change run (same rule as §3.1/§3.2, 05 T-ACT-51).
 */
import 'server-only';
import { createYoutube, isShort, type MappedVideo, type RssVideo } from '@/lib/adapters/youtube';
import { env } from '@/lib/env';
import { runJob, type JobDb } from '@/lib/jobs/runner';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';

const JOB = 'syncYoutube';
const SOURCE = 'youtube' as const;

/** J-P: at most 20 entries in `summary.errors[]`. */
const ERRORS_LIMIT = 20;
const ERROR_ENTRY_LIMIT = 300;

/** PostgREST answers at most 1,000 rows per read (`supabase/config.toml` `max_rows`). */
const READ_PAGE = 1000;

/** J-I `synced_at`-only touches go out in chunks so the `in (…)` filter stays a short URL. */
const TOUCH_CHUNK = 50;

/** The columns step 1 reads: the synced ones (for the J-I compare) + the admin override (read only). */
const EXISTING_COLUMNS =
  'youtube_id, title, description, thumbnail_url, published_at, duration_seconds, is_short, is_short_override, view_count, like_count';

type ExistingVideo = {
  youtube_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string;
  published_at: string;
  duration_seconds: number | null;
  is_short: boolean;
  is_short_override: boolean | null;
  view_count: number | null;
  like_count: number | null;
};

/** What a keyed run writes — every synced column, and nothing admin-owned. */
type SyncedColumns = {
  title: string;
  description: string | null;
  thumbnail_url: string;
  published_at: string;
  duration_seconds: number | null;
  is_short: boolean;
  view_count: number | null;
  like_count: number | null;
};

/** What an RSS-minimal insert carries (04 §3.3 step 1); a keyed insert adds the rest. */
type MinimalColumns = Pick<SyncedColumns, 'title' | 'thumbnail_url' | 'published_at'> &
  Partial<SyncedColumns>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushError(errors: string[], entry: string): void {
  if (errors.length < ERRORS_LIMIT) errors.push(entry.slice(0, ERROR_ENTRY_LIMIT));
}

/** 04 §3.3 step 1 literal — the one thumbnail host 01 INV-54 allows. */
function hqDefault(youtubeId: string): string {
  return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
}

/** Postgres prints `+00:00`, the adapter `Z` — compare instants, not strings. */
function sameInstant(a: string, b: string): boolean {
  return Date.parse(a) === Date.parse(b);
}

/** Step 1 — every existing row, paged in a stable order. */
async function readExisting(db: JobDb): Promise<Map<string, ExistingVideo>> {
  const rows = new Map<string, ExistingVideo>();
  for (let from = 0; ; from += READ_PAGE) {
    const page = await db
      .from('videos')
      .select(EXISTING_COLUMNS)
      .order('youtube_id', { ascending: true })
      .range(from, from + READ_PAGE - 1);
    if (page.error) throw new Error(`videos read failed: ${page.error.message}`);
    for (const row of page.data) rows.set(row.youtube_id, row);
    if (page.data.length < READ_PAGE) return rows;
  }
}

/** INV-54 — only an `i.ytimg.com` https URL is stored; anything else falls back to `hqdefault`. */
function pinnedThumbnail(video: MappedVideo): string {
  const url = video.thumbnail_url;
  if (url !== null && url !== undefined && url.startsWith('https://i.ytimg.com/')) return url;
  return hqDefault(video.youtube_id);
}

/** Keyed run: the Data-API columns, with the effective `is_short` (ADR-0043 D1). */
function keyedColumns(video: MappedVideo, existing: ExistingVideo | undefined): SyncedColumns {
  return {
    title: video.title,
    description: video.description,
    thumbnail_url: pinnedThumbnail(video),
    published_at: video.published_at,
    duration_seconds: video.duration_seconds,
    is_short: existing?.is_short_override ?? isShort(video),
    view_count: video.view_count,
    like_count: video.like_count,
  };
}

function differs(next: SyncedColumns, row: ExistingVideo): boolean {
  return (
    next.title !== row.title ||
    next.description !== row.description ||
    next.thumbnail_url !== row.thumbnail_url ||
    !sameInstant(next.published_at, row.published_at) ||
    next.duration_seconds !== row.duration_seconds ||
    next.is_short !== row.is_short ||
    next.view_count !== row.view_count ||
    next.like_count !== row.like_count
  );
}

/**
 * 04 §3.3 — hourly YouTube sync. `opts.full` (the route's `?full=1`, `triggerSync`'s `full:true`)
 * forces the uploads-playlist walk. Lock, `sync_runs` row, revalidation, logging and J-F come from
 * `runJob` (ADR-0030 D1).
 */
export async function syncYoutube(opts: JobOptions): Promise<JobSummary> {
  return runJob({
    source: SOURCE,
    job: JOB,
    opts,
    work: async ({ db, full }) => {
      let ok = true;
      let errorText: string | null = null;
      let inserted = 0;
      let updated = 0;
      let rssCount = 0;
      let walked = 0;
      let units = 0;
      let hasKey = env.YOUTUBE_API_KEY !== undefined;
      const errors: string[] = [];

      try {
        const youtube = createYoutube({ env });
        hasKey = youtube.hasKey;

        // ---- Gather (steps 1–4): nothing is written until every list is in memory. ----
        let rss: RssVideo[] = [];
        let mapped: MappedVideo[] = [];
        const asked = new Set<string>();
        let existing: Map<string, ExistingVideo>;
        try {
          existing = await readExisting(db);
          const tableEmpty = existing.size === 0;

          rss = await youtube.fetchRss();
          rssCount = rss.length;

          if (hasKey) {
            for (const id of existing.keys()) asked.add(id);
            for (const entry of rss) asked.add(entry.youtube_id);
            if (full || tableEmpty) {
              const uploads = await youtube.listUploads();
              walked = uploads.length;
              for (const id of uploads) asked.add(id);
            }
            mapped = await youtube.listVideos([...asked]);
          }
        } finally {
          // AC9: units are reported on the failure path too (a failed `videos.list` still cost one).
          units = youtube.unitsUsed;
        }

        // ---- Write (step 5): per-id J-P; admin-owned columns never appear in a payload. ----
        let attempted = 0;
        let failedItems = 0;
        const unchanged: string[] = [];
        const syncedAt = new Date().toISOString();

        const insertRow = async (youtubeId: string, columns: MinimalColumns) => {
          const write = await db
            .from('videos')
            .upsert(
              { youtube_id: youtubeId, ...columns, synced_at: syncedAt },
              { onConflict: 'youtube_id', ignoreDuplicates: true },
            )
            .select('youtube_id');
          if (write.error) throw new Error(`videos insert failed: ${write.error.message}`);
          // A row another run inserted since the read is skipped (ignoreDuplicates) and comes back
          // as zero rows — it is not this run's insert, so it earns no item and no revalidation.
          inserted += write.data.length;
        };
        // ADR-0043 D21 — the override was read at step 1, before the network gather; `updateVideo`
        // may have flipped it since. The write is guarded on the override AS READ: when no row
        // matches, the admin's `is_short` stands — the other synced columns still land and the next
        // run reconciles the flag.
        const updateRow = async (row: ExistingVideo, columns: Partial<SyncedColumns>) => {
          const guarded = db
            .from('videos')
            .update({ ...columns, synced_at: syncedAt })
            .eq('youtube_id', row.youtube_id);
          const write = await (
            row.is_short_override === null
              ? guarded.is('is_short_override', null)
              : guarded.eq('is_short_override', row.is_short_override)
          ).select('youtube_id');
          if (write.error) throw new Error(`videos update failed: ${write.error.message}`);
          if (write.data.length === 0) {
            const rest: Partial<SyncedColumns> = { ...columns };
            delete rest.is_short;
            const retry = await db
              .from('videos')
              .update({ ...rest, synced_at: syncedAt })
              .eq('youtube_id', row.youtube_id);
            if (retry.error) throw new Error(`videos update failed: ${retry.error.message}`);
          }
          updated += 1;
        };
        const each = async (youtubeId: string, write: () => Promise<void>) => {
          attempted += 1;
          try {
            await write();
          } catch (error) {
            // J-P: the row keeps its old values and the error is counted, never rethrown.
            failedItems += 1;
            pushError(errors, `${youtubeId}: ${message(error)}`);
          }
        };

        if (hasKey) {
          const seen = new Set<string>();
          for (const video of mapped) {
            // Only ids this run asked about, once each — an unrequested item is not ours to write.
            if (!asked.has(video.youtube_id) || seen.has(video.youtube_id)) continue;
            seen.add(video.youtube_id);
            const row = existing.get(video.youtube_id);
            const columns = keyedColumns(video, row);
            if (row === undefined)
              await each(video.youtube_id, () => insertRow(video.youtube_id, columns));
            else if (differs(columns, row))
              await each(video.youtube_id, () => updateRow(row, columns));
            else unchanged.push(video.youtube_id);
          }
        } else {
          const seen = new Set<string>();
          for (const entry of rss) {
            if (seen.has(entry.youtube_id)) continue;
            seen.add(entry.youtube_id);
            const row = existing.get(entry.youtube_id);
            if (row === undefined) {
              // 04 §3.3 step 1 minimal row — the feed's own thumbnail host is never stored (INV-54).
              await each(entry.youtube_id, () =>
                insertRow(entry.youtube_id, {
                  title: entry.title,
                  published_at: entry.published_at,
                  thumbnail_url: hqDefault(entry.youtube_id),
                }),
              );
              continue;
            }
            // Known row: title / published_at only — Data-API fields are never downgraded. The
            // effective flag follows the new title over the STORED duration and description.
            const isShortNow =
              row.is_short_override ??
              isShort({
                duration_seconds: row.duration_seconds,
                title: entry.title,
                description: row.description,
              });
            if (
              entry.title !== row.title ||
              !sameInstant(entry.published_at, row.published_at) ||
              isShortNow !== row.is_short
            ) {
              await each(entry.youtube_id, () =>
                updateRow(row, {
                  title: entry.title,
                  published_at: entry.published_at,
                  is_short: isShortNow,
                }),
              );
            } else unchanged.push(entry.youtube_id);
          }
        }

        // J-I — confirmed-unchanged rows: only `synced_at` moves.
        for (let start = 0; start < unchanged.length; start += TOUCH_CHUNK) {
          const chunk = unchanged.slice(start, start + TOUCH_CHUNK);
          attempted += chunk.length;
          const touched = await db
            .from('videos')
            .update({ synced_at: syncedAt })
            .in('youtube_id', chunk);
          if (touched.error) {
            failedItems += chunk.length;
            pushError(
              errors,
              `${String(chunk.length)} rows: videos touch failed: ${touched.error.message}`,
            );
          }
        }

        // J-P: the run fails only when a list call failed or > 50 % of the attempted ids failed.
        if (failedItems > attempted / 2) {
          ok = false;
          errorText = `${String(failedItems)}/${String(attempted)} items failed: ${errors.join('; ')}`;
        }
      } catch (error) {
        ok = false;
        errorText = message(error);
        pushError(errors, errorText);
      }

      const items = inserted + updated;
      const degraded = hasKey ? {} : { degraded: 'no_key' };

      return {
        ok,
        items,
        error: ok ? null : (errorText ?? 'failed'),
        extra: {
          inserted,
          updated,
          rss: rssCount,
          walked,
          full,
          units,
          errors,
          ...degraded,
        },
        // 04 §3.3 revalidate (through the runner, after the row is final) — nothing on a no-change run.
        tags: items > 0 ? ['videos'] : [],
        logMeta: { units, inserted, updated, errors: errors.length, ...degraded },
      };
    },
  });
}
