/**
 * lib/jobs/refreshMentions.ts — hourly view-count refresh for YouTube mentions (04 §3.4 as amended
 * by ADR-0045; §3 pipeline through `lib/jobs/runner.ts` `runJob` — SC-11/SC-13, SC-07 tags, J-F edge
 * emission (ADR-0030 D1); SC-16 no-key skip; SC-25 adapter built from `lib/env.ts` once per run;
 * J-P/J-I/J-D; 01 INV-24/INV-71; 00 S1.8 AC7; 05 T-ACT-33, T-ACT-54, T-ACT-71, T-ACT-74, T-ADP-13).
 *
 * Precondition: `YOUTUBE_API_KEY` set; else the run still writes its `sync_runs` row (SC-11) with
 * `ok=true, error='not configured'` (the §3.2 wording) and returns
 * `{ok:true, items:0, skipped:'not_configured'}` — no adapter is constructed, no request is made,
 * no row is read, no `sync.failed` (the runner emits only for `ok=false`).
 *
 * Idempotency key: `mentions.id` (04 §3.4). The ONLY column this file writes is `view_count`.
 *
 * Order — GATHER, THEN WRITE (the ADR-0043 D2 posture). Everything the run needs is in memory
 * before the first row is written, so a failure while gathering changes no row (05 T-ACT-45 rule):
 *   1. Read the eligible rows (paged — PostgREST caps a read at 1,000 rows): `platform = 'youtube'`
 *      AND `external_id IS NOT NULL` AND `status` in `MENTION_REFRESH_STATUSES` (draft, published).
 *      Hidden and suggested mentions, and every non-YouTube mention, are never read, never asked
 *      about and never written (04 §3.4 "Non-YouTube mentions are never refreshed in v1").
 *   2. `youtube.listVideoStats(<distinct external_ids>)` — `videos.list part=statistics` in batches
 *      of ≤ 50 ids, one quota unit each (the adapter owns the batching — `VIDEOS_BATCH`; AC7). This
 *      is "the list call" of J-P: ANY batch failing fails the whole gather — nothing from the
 *      batches that did answer is written either (they are simply asked again next hour).
 *   3. Decide the changes: a row changes only when the API answered ITS id with a non-null count
 *      that differs from the stored one. Id missing from the response (deleted / private video) →
 *      unchanged (04 §3.4 Idempotency). Count hidden by the creator (`view_count: null`) →
 *      unchanged: a stored number — possibly typed by the admin in `createMention` — is never
 *      overwritten with NULL (ADR-0045). Same number → unchanged.
 *   4. Read `projects.slug` for the rows that will change (chunked), so every write already knows
 *      its `project:<slug>` tag. A no-change run stops at one DB read.
 *   Any of 1–4 failing → `ok=false`, the message as `error`, ZERO writes, no tags; the runner then
 *   emits `sync.failed` per J-F (edge-triggered — 05 T-ACT-74 refreshMentions, 00 S1.8 AC7).
 *   5. Writes, one row at a time (J-P: a per-row error keeps the old number, is counted in
 *      `summary.errors[]` ≤ 20 and never rethrown; the run is `ok=false` only when > 50 % of the
 *      attempted rows failed). Each write is guarded on the `external_id` AS READ: `updateMention`
 *      may have re-pointed the row at another video since step 1, and the old video's count must not
 *      land on it — no row matched → counted `unchanged`, the next run reconciles (the ADR-0043 D21
 *      guard, for the same read-then-network-then-write window).
 *
 * J-I: `mentions` has no `synced_at` — a run with unchanged upstream numbers writes NOTHING (the
 * `updated_at` trigger never fires) and revalidates nothing. Two mentions of one video are asked
 * about once and written separately.
 *
 * J-D: this job never removes a `mentions` row (01 INV-24).
 *
 * Quota (04 §3.4; `backend-reviewer` focus): ceil(N / 50) `videos.list` units per run for N distinct
 * ids. `summary.units` and the run's `done` / `failed` log line (`meta.units`) carry what the adapter
 * counted (`unitsUsed`) — on the failure path too (a failed batch still cost its unit) — never the
 * key (SC-15; the adapter redacts it as `key=[redacted]` in every error text).
 *
 * Revalidate (04 §3.4, 02 §1.4 — through the runner, after the row is final): `mentions` once +
 * `project:<slug>` per changed mention that hangs on a project — only when ≥ 1 row changed (the
 * §3.1/§3.2/§3.3 rule, 05 T-ACT-51). A general mention (`project_id` NULL) adds no project tag.
 *
 * Summary (ADR-0045): `{items: <rows updated>, mentions, asked, returned, updated, unchanged, units,
 * errors[]}` — `mentions` rows selected; `asked` distinct ids handed to the adapter (the
 * `mentions_youtube_external_id_format` CHECK keeps every stored id sendable); `returned` how many
 * of those the API answered; `mentions = updated + unchanged + <failed writes>`.
 */
import 'server-only';
import { createYoutube } from '@/lib/adapters/youtube';
import { env } from '@/lib/env';
import { MENTION_REFRESH_STATUSES } from '@/lib/jobs/constants';
import { runJob, type JobDb } from '@/lib/jobs/runner';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';

const JOB = 'refreshMentions';
const SOURCE = 'mentions' as const;

/** J-P: at most 20 entries in `summary.errors[]`. */
const ERRORS_LIMIT = 20;
const ERROR_ENTRY_LIMIT = 300;

/** PostgREST answers at most 1,000 rows per read (`supabase/config.toml` `max_rows`). */
const READ_PAGE = 1000;

/** Step 4 asks for slugs in chunks so the `in (…)` filter stays a short URL. */
const SLUG_CHUNK = 50;

/** What step 1 reads — `external_id` narrowed to non-null (the select filters on it). */
type EligibleMention = {
  id: string;
  project_id: string | null;
  external_id: string;
  view_count: number | null;
};

/** Step 3's verdict for one row: the number the API answered, which differs from the stored one. */
type Change = { row: EligibleMention; next: number };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushError(errors: string[], entry: string): void {
  if (errors.length < ERRORS_LIMIT) errors.push(entry.slice(0, ERROR_ENTRY_LIMIT));
}

/** Step 1 — the 04 §3.4 select, paged in a stable order. */
async function readEligible(db: JobDb): Promise<EligibleMention[]> {
  const rows: EligibleMention[] = [];
  for (let from = 0; ; from += READ_PAGE) {
    const page = await db
      .from('mentions')
      .select('id, project_id, external_id, view_count')
      .eq('platform', 'youtube')
      .not('external_id', 'is', null)
      .in('status', MENTION_REFRESH_STATUSES)
      .order('id', { ascending: true })
      .range(from, from + READ_PAGE - 1);
    if (page.error) throw new Error(`mentions read failed: ${page.error.message}`);
    for (const row of page.data) {
      if (row.external_id !== null) rows.push({ ...row, external_id: row.external_id });
    }
    if (page.data.length < READ_PAGE) return rows;
  }
}

/** Step 4 — `projects.id → slug` for the projects whose mentions are about to change. */
async function readSlugs(db: JobDb, projectIds: string[]): Promise<Map<string, string>> {
  const slugById = new Map<string, string>();
  for (let start = 0; start < projectIds.length; start += SLUG_CHUNK) {
    const chunk = projectIds.slice(start, start + SLUG_CHUNK);
    const page = await db.from('projects').select('id, slug').in('id', chunk);
    if (page.error) throw new Error(`projects read failed: ${page.error.message}`);
    for (const project of page.data) slugById.set(project.id, project.slug);
  }
  return slugById;
}

/**
 * 04 §3.4 — hourly mention view counts. `opts.full` is a youtube-only flag and is ignored here.
 * Lock, `sync_runs` row, revalidation, logging and J-F come from `runJob` (ADR-0030 D1).
 */
export async function refreshMentions(opts: JobOptions): Promise<JobSummary> {
  return runJob({
    source: SOURCE,
    job: JOB,
    opts,
    work: async ({ db }) => {
      // 04 §3.4 precondition — the skipped run still writes its SC-11 row: ok=true, error='not configured'.
      if (env.YOUTUBE_API_KEY === undefined) {
        return { ok: true, items: 0, error: 'not configured', skipped: 'not_configured' };
      }

      let ok = true;
      let errorText: string | null = null;
      let mentions = 0;
      let asked = 0;
      let returned = 0;
      let updated = 0;
      let unchanged = 0;
      let units = 0;
      const errors: string[] = [];
      const changedSlugs = new Set<string>();

      try {
        const youtube = createYoutube({ env });

        // ---- Gather (steps 1–4): nothing is written until all of it is in memory. ----
        const changes: Change[] = [];
        let slugById: Map<string, string>;
        try {
          const rows = await readEligible(db);
          mentions = rows.length;

          const ids = [...new Set(rows.map((row) => row.external_id))];
          asked = ids.length;
          const stats = await youtube.listVideoStats(ids);
          const counts = new Map(stats.map((video) => [video.youtube_id, video.view_count]));
          returned = ids.filter((id) => counts.has(id)).length;

          for (const row of rows) {
            const next = counts.get(row.external_id);
            // Missing id · hidden count · same number → the stored value stands (04 §3.4; J-I).
            if (next === undefined || next === null || next === row.view_count) continue;
            changes.push({ row, next });
          }
          unchanged = rows.length - changes.length;

          const projectIds = new Set<string>();
          for (const { row } of changes) {
            if (row.project_id !== null) projectIds.add(row.project_id);
          }
          slugById = await readSlugs(db, [...projectIds]);
        } finally {
          // Units are reported on the failure path too (a failed `videos.list` still cost one).
          units = youtube.unitsUsed;
        }

        // ---- Write (step 5): per-row J-P; `view_count` is the only column in the payload. ----
        let failedItems = 0;
        for (const { row, next } of changes) {
          try {
            const write = await db
              .from('mentions')
              .update({ view_count: next })
              .eq('id', row.id)
              .eq('external_id', row.external_id)
              .select('id');
            if (write.error) throw new Error(`mentions update failed: ${write.error.message}`);
            if (write.data.length === 0) {
              // Re-pointed at another video since step 1 — not this run's number to write.
              unchanged += 1;
              continue;
            }
            updated += 1;
            const slug = row.project_id === null ? undefined : slugById.get(row.project_id);
            if (slug !== undefined) changedSlugs.add(slug);
          } catch (error) {
            // J-P: the row keeps its old number and the error is counted, never rethrown.
            failedItems += 1;
            pushError(errors, `${row.id}: ${message(error)}`);
          }
        }

        // J-P: the run fails only when the gather failed or > 50 % of the attempted rows failed.
        if (failedItems > changes.length / 2) {
          ok = false;
          errorText = `${String(failedItems)}/${String(changes.length)} items failed: ${errors.join('; ')}`;
        }
      } catch (error) {
        ok = false;
        errorText = message(error);
        pushError(errors, errorText);
      }

      // 04 §3.4 revalidate (through the runner, after the row is final) — `mentions` once +
      // `project:<slug>` per changed mention; nothing on a no-change run.
      const tags =
        updated > 0 ? ['mentions', ...[...changedSlugs].map((slug) => `project:${slug}`)] : [];

      return {
        ok,
        items: updated,
        error: ok ? null : (errorText ?? 'failed'),
        extra: { mentions, asked, returned, updated, unchanged, units, errors },
        tags,
        logMeta: { units, mentions, asked, returned, updated, unchanged, errors: errors.length },
      };
    },
  });
}
