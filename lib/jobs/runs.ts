/**
 * lib/jobs/runs.ts — shared `sync_runs` bookkeeping for every job (04 SC-11 insert-then-finalize;
 * SC-13 lock; 01 INV-24; registry Modules `jobs/*`). Service client only — `sync_runs` has no
 * insert policy for JWT roles (05 T-RLS-112), so jobs write it with `lib/supabase/admin.ts`
 * (allowed importer per 01 INV-14), and only after the caller's entry check (SC-06: cron secret in
 * the route / `requireRole('admin')` in `triggerSync`).
 */
import 'server-only';
import { JOB_LOCK_MINUTES } from '@/lib/jobs/constants';
import type { SyncSource } from '@/lib/jobs/types';
import { createAdminClient } from '@/lib/supabase/admin';

/** The service client type without importing `@supabase/supabase-js` (01 INV-85). */
type Db = ReturnType<typeof createAdminClient>;

/** SC-11: `error` is stored at ≤ 2000 chars (adapter messages are already secret-redacted). */
const ERROR_LIMIT = 2000;

export function clipError(text: string): string {
  return text.slice(0, ERROR_LIMIT);
}

/**
 * SC-13: the id of an open run (`finished_at IS NULL`, `started_at > now() - JOB_LOCK_MINUTES`)
 * for `source`, else null. An older open row is a crashed run — it does not hold the lock.
 */
export async function findOpenRun(db: Db, source: SyncSource): Promise<string | null> {
  const cutoff = new Date(Date.now() - JOB_LOCK_MINUTES * 60_000).toISOString();
  const { data, error } = await db
    .from('sync_runs')
    .select('id')
    .eq('source', source)
    .is('finished_at', null)
    .gt('started_at', cutoff)
    .limit(1);
  if (error) throw new Error(`sync_runs lock check failed: ${error.message}`);
  return data[0]?.id ?? null;
}

/** SC-11 step 1: insert `{source, started_at}` (started_at defaults to now()) and return the id. */
export async function insertRun(db: Db, source: SyncSource): Promise<string> {
  const { data, error } = await db.from('sync_runs').insert({ source }).select('id').single();
  if (error) throw new Error(`sync_runs insert failed: ${error.message}`);
  return data.id;
}

/**
 * SC-11 step 2: update `{finished_at, ok, items, error}` — called from the job's `finally`, on every
 * path including thrown errors. `error` is null on success except the §3.2 no-key run, which stores
 * `'not configured'` with `ok=true` (01 env matrix wording) — callers pass the value explicitly.
 */
export async function finalizeRun(
  db: Db,
  runId: string,
  result: { ok: boolean; items: number; error: string | null },
): Promise<void> {
  const { error } = await db
    .from('sync_runs')
    .update({
      finished_at: new Date().toISOString(),
      ok: result.ok,
      items: result.items,
      error: result.error === null ? null : clipError(result.error),
    })
    .eq('id', runId);
  if (error) throw new Error(`sync_runs finalize failed: ${error.message}`);
}
