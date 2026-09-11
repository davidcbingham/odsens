/**
 * lib/jobs/runner.ts — `runJob({source, job, opts, work})`, the one lock → insert → work → finalize →
 * revalidate → J-F sequence every job runs through (04 §3 preamble + J-F; SC-11/SC-13 via
 * lib/jobs/runs.ts; SC-07 tags; 01 INV-71; 00 S1.5 "wired into the shared job runner";
 * ADR-0030 D1; 05 T-ACT-45, T-ACT-70, T-ACT-74).
 *
 * Owning a run (`opts.runId` absent — the cron route and `triggerSync`):
 *   1. SC-13 lock: an open `sync_runs` row younger than `JOB_LOCK_MINUTES` → `{ok:true,
 *      skipped:'running'}` with the open run's id, no new row, no work.
 *   2. SC-11 insert `{source, started_at}`.
 *   3. `work(ctx)` — the job body; it returns `JobWorkResult` or throws (a throw is `ok:false`
 *      with the message as `error`; jobs keep their own J-P catch so partial counters survive).
 *   4. SC-11 finalize on every path (`finally`): `{finished_at, ok, items, error}` — `error` is null
 *      on success unless the job passes one with `ok:true` (the §3.2 no-key run stores
 *      `'not configured'`, 01 env-matrix wording).
 *   5. SC-07 `revalidateTag(tag, 'max')` for every tag the work listed, after the row is final.
 *   6. One log line: `skipped` (reason `not_configured`) · `done` · `failed` (01 INV-42).
 *   7. J-F edge emission (ADR-0030 D1): when `ok=false` and the latest OTHER **finalized** `sync_runs`
 *      row for the source has `ok = true` or no such row exists → `emit('sync.failed',
 *      {subject_type:'sync_run', subject_id: run_id, payload:{source, run_id, error(≤300),
 *      started_at}})`. An unfinalized older row (`ok IS NULL` — a run killed at `maxDuration` or
 *      crashed before finalize) is a crash, not a run result: it never had the chance to emit, so it
 *      is skipped when looking for the predecessor (otherwise an outage that begins with a crash
 *      would never reach the allay — 01 INV-71). A lock skip and the `not_configured` run never emit
 *      (both are `ok:true`). An `emit` failure is logged (`msg:'emit_failed'`) and never thrown — the
 *      job's own outcome stands.
 *
 * Nested (`opts.runId` present — the §2.4 notify pair under `runNotify`, ADR-0030 D2): the caller
 * owns the row, so there is no lock check (the caller's own open row IS the lock), no insert, no
 * finalize and no J-F emission here — the work runs and its summary is returned with the caller's
 * `run_id`; the owning runner finalizes and emits for the combined outcome. (04 §3's "`runId?` —
 * an existing row to finalize instead of inserting" reads as this ownership rule: one row, one
 * finalize.)
 *
 * The summary is 04 §3's `JobSummary`: `{ok, source, run_id, items, ms}` + `error` when failed +
 * `skipped` (the SC-13/§3.2 marker or §3.1's numeric count) + the job's `extra` keys.
 */
import 'server-only';
import { revalidateTag } from 'next/cache';
import { findOpenRun, finalizeRun, insertRun } from '@/lib/jobs/runs';
import type { JobOptions, JobSummary, SyncSource } from '@/lib/jobs/types';
import { log } from '@/lib/log';
import { emit } from '@/lib/notify/emit';
import { createAdminClient } from '@/lib/supabase/admin';

/** The service client type without importing `@supabase/supabase-js` (01 INV-85). */
export type JobDb = ReturnType<typeof createAdminClient>;

/** J-F payload `error(≤300)`. */
const EMIT_ERROR_LIMIT = 300;

export type JobWorkContext = {
  db: JobDb;
  /** The `sync_runs.id` this work runs under (own or the caller's). */
  runId: string;
  /** `Date.now()` at entry — for the summary's `ms` and time budgets. */
  started: number;
  trigger: JobOptions['trigger'];
  full: boolean;
  /** False when the caller passed `opts.runId` (nested — no lock/insert/finalize/J-F here). */
  ownsRun: boolean;
};

export type JobWorkResult = {
  ok: boolean;
  /** `sync_runs.items` and `summary.items`. */
  items: number;
  /** `sync_runs.error` / `summary.error`. Null on success; an `ok:true` value is stored as given. */
  error?: string | null;
  /** SC-13/§3.2 marker (`'running'`, `'not_configured'`) or §3.1's numeric skipped-types count. */
  skipped?: string | number;
  /** Extra summary keys (`hidden`, `versions`, `files`, `errors[]`, `links`, …). */
  extra?: Record<string, unknown>;
  /** SC-07 tags to revalidate after finalize, in order (deduplicated here). */
  tags?: string[];
  /** Extra `meta` keys for the `done` / `failed` log line (counts only — never addresses, INV-43). */
  logMeta?: Record<string, unknown>;
};

export type RunJobInput = {
  source: SyncSource;
  /** The log line's `job` (the function name — `syncModrinth`, `notifyFanOut`, …). */
  job: string;
  opts: JobOptions;
  work: (ctx: JobWorkContext) => Promise<JobWorkResult>;
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * J-F: `sync.failed` is edge-triggered — emitted only when this run failed AND the latest other
 * FINALIZED `sync_runs` row for the source was ok (or none exists); an open/crashed row (`ok IS NULL`)
 * is not a predecessor (file header, step 7). Never throws.
 */
async function emitSyncFailed(
  db: JobDb,
  job: string,
  source: SyncSource,
  runId: string,
  errorText: string,
): Promise<void> {
  try {
    const previous = await db
      .from('sync_runs')
      .select('ok')
      .eq('source', source)
      .neq('id', runId)
      .not('ok', 'is', null) // a crashed run (never finalized) is skipped, not a "not ok" verdict
      .order('started_at', { ascending: false })
      .limit(1);
    if (previous.error)
      throw new Error(`sync_runs previous read failed: ${previous.error.message}`);
    const last = previous.data[0];
    if (last !== undefined && last.ok !== true) return; // still inside the same failure episode

    const own = await db.from('sync_runs').select('started_at').eq('id', runId).single();
    if (own.error) throw new Error(`sync_runs own read failed: ${own.error.message}`);

    await emit('sync.failed', {
      subjectType: 'sync_run',
      subjectId: runId,
      payload: {
        source,
        run_id: runId,
        error: errorText.slice(0, EMIT_ERROR_LIMIT),
        started_at: new Date(own.data.started_at).toISOString(),
      },
    });
  } catch (error) {
    // The job's outcome stands; a lost `sync.failed` is logged, never thrown (ADR-0030 D1).
    log.error({ job, id: runId, msg: 'emit_failed', meta: { error: message(error) } });
  }
}

/** 04 §3 / ADR-0030 D1 — see the file header for the sequence. */
export async function runJob({ source, job, opts, work }: RunJobInput): Promise<JobSummary> {
  const started = Date.now();
  const db = createAdminClient();
  const ownsRun = opts.runId === undefined;

  if (ownsRun) {
    // SC-13 — an open run younger than JOB_LOCK_MINUTES holds the lock: no work, no new row.
    const openRun = await findOpenRun(db, source);
    if (openRun !== null) {
      log.info({
        job,
        id: openRun,
        msg: 'skipped',
        meta: { reason: 'running', trigger: opts.trigger },
      });
      return {
        ok: true,
        source,
        run_id: openRun,
        items: 0,
        ms: Date.now() - started,
        skipped: 'running',
      };
    }
  }

  const runId = opts.runId ?? (await insertRun(db, source));
  const ctx: JobWorkContext = {
    db,
    runId,
    started,
    trigger: opts.trigger,
    full: opts.full === true,
    ownsRun,
  };

  let result: JobWorkResult = { ok: false, items: 0, error: 'failed' };
  try {
    result = await work(ctx);
  } catch (error) {
    // Jobs catch their own per-item and list failures (J-P); this is the last resort.
    result = { ok: false, items: 0, error: message(error) };
  } finally {
    if (ownsRun) {
      // SC-11 — exactly one row per invocation, finalized on every path including thrown errors.
      await finalizeRun(db, runId, {
        ok: result.ok,
        items: result.items,
        error: result.ok ? (result.error ?? null) : (result.error ?? 'failed'),
      });
    }
  }

  // SC-07 — after the run row is final; the 'max' profile is Next 16.3's required second argument
  // (on-demand expiry of long-lived tagged entries — outside a Server Action `updateTag` is unavailable).
  if (result.tags !== undefined && result.tags.length > 0) {
    for (const tag of new Set(result.tags)) revalidateTag(tag, 'max');
  }

  const errorText = result.error ?? 'failed';
  if (result.skipped === 'not_configured') {
    log.info({
      job,
      id: runId,
      msg: 'skipped',
      meta: { reason: 'not_configured', trigger: opts.trigger },
    });
  } else if (result.ok) {
    log.info({
      job,
      id: runId,
      msg: 'done',
      meta: { trigger: opts.trigger, items: result.items, ...result.logMeta },
    });
  } else {
    log.error({
      job,
      id: runId,
      msg: 'failed',
      meta: { trigger: opts.trigger, error: errorText, ...result.logMeta },
    });
  }

  // J-F — only a run that owns its row reports its own failure (ADR-0030 D1/D2).
  if (ownsRun && !result.ok) await emitSyncFailed(db, job, source, runId, errorText);

  const summary: JobSummary = {
    ok: result.ok,
    source,
    run_id: runId,
    items: result.items,
    ms: Date.now() - started,
    ...result.extra,
  };
  if (result.skipped !== undefined) summary.skipped = result.skipped;
  if (!result.ok) summary.error = errorText;
  return summary;
}
