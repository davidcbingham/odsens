/**
 * tests/helpers/arrange.ts — service-client helpers to ARRANGE and INSPECT state around an action call
 * (05 §1.3 "service = arrange state and prove 'service can'"). Never used to assert a policy.
 *
 *   readProfile(id)                 → the full `profiles` row (RLS bypass) or null
 *   patchProfile(id, patch)         → service update (e.g. restore a seed row — H-1 `mutatesSeed`,
 *                                     or move `handle_changed_at` back 8 days for the 7-day rule)
 *   clearRateLimitHits(scope, key)  → forget the hits for one key (so validation loops never trip a limit)
 *   clearRateLimitHitsFor(scopes, keys) → the same for several scopes × keys (seed users across files, S1.4)
 *   countRateLimitHits(scope, key)  → rows in `rate_limit_hits` for one key
 *   freeHandle()                    → `t_<8 hex>` — passes H1/H3, never collides with seed handles
 *   touchSeedSyncRuns()             → re-assert SEED-12's "one ok run per source, 30 min ago" (S1.5 F0 files)
 */
import { randomBytes } from 'node:crypto';
import type { Database } from '@/lib/supabase/types';
import { asRole } from './asRole';
import { SEED_SYNC_RUNS } from './seedIds';

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];
export type ProfilePatch = Database['public']['Tables']['profiles']['Update'];

export async function readProfile(id: string): Promise<ProfileRow | null> {
  const { data, error } = await asRole('service')
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`readProfile(${id}): ${error.message}`);
  return data;
}

export async function patchProfile(id: string, patch: ProfilePatch): Promise<void> {
  const { error } = await asRole('service').from('profiles').update(patch).eq('id', id);
  if (error) throw new Error(`patchProfile(${id}): ${error.message}`);
}

export async function clearRateLimitHits(scope: string, key: string): Promise<void> {
  const { error } = await asRole('service')
    .from('rate_limit_hits')
    .delete()
    .eq('scope', scope)
    .eq('key', key);
  if (error) throw new Error(`clearRateLimitHits(${scope}, ${key}): ${error.message}`);
}

/** Forgets every hit of the given scopes for the given keys (seed roles shared by many files). */
export async function clearRateLimitHitsFor(
  scopes: readonly string[],
  keys: readonly string[],
): Promise<void> {
  if (scopes.length === 0 || keys.length === 0) return;
  const { error } = await asRole('service')
    .from('rate_limit_hits')
    .delete()
    .in('scope', [...scopes])
    .in('key', [...keys]);
  if (error) throw new Error(`clearRateLimitHitsFor(${scopes.join(',')}): ${error.message}`);
}

export async function countRateLimitHits(scope: string, key: string): Promise<number> {
  const { count, error } = await asRole('service')
    .from('rate_limit_hits')
    .select('*', { count: 'exact', head: true })
    .eq('scope', scope)
    .eq('key', key);
  if (error) throw new Error(`countRateLimitHits(${scope}, ${key}): ${error.message}`);
  return count ?? 0;
}

/** A fresh handle that passes H1 + H3 and is not a seed handle. */
export function freeHandle(prefix = 't_'): string {
  return `${prefix}${randomBytes(4).toString('hex')}`;
}

/**
 * SEED-12 is "one ok run per source finished 30 minutes ago" — relative to the reset. Under
 * `SKIP_DB_RESET=1` (or any run longer than 6 h after a reset) the rows age past the J-S window and
 * F0 emits an extra `sync.stale` per tick, shifting every count in the F0-dependent files
 * (notifyFanOut, notify, cron-notify). Re-assert the seed's documented shape before the content
 * snapshot so those files hold whenever they run (05 §3 SEED-12 / H-1 `mutatesSeed`; the snapshot
 * then restores these values).
 */
export async function touchSeedSyncRuns(): Promise<void> {
  const { error } = await asRole('service')
    .from('sync_runs')
    .update({
      started_at: new Date(Date.now() - 35 * 60_000).toISOString(),
      finished_at: new Date(Date.now() - 30 * 60_000).toISOString(),
    })
    .in('id', Object.values(SEED_SYNC_RUNS));
  if (error) throw new Error(`touchSeedSyncRuns: ${error.message}`);
}
