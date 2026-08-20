/**
 * tests/helpers/arrange.ts — service-client helpers to ARRANGE and INSPECT state around an action call
 * (05 §1.3 "service = arrange state and prove 'service can'"). Never used to assert a policy.
 *
 *   readProfile(id)                 → the full `profiles` row (RLS bypass) or null
 *   patchProfile(id, patch)         → service update (e.g. restore a seed row — H-1 `mutatesSeed`,
 *                                     or move `handle_changed_at` back 8 days for the 7-day rule)
 *   clearRateLimitHits(scope, key)  → forget the hits for one key (so validation loops never trip a limit)
 *   countRateLimitHits(scope, key)  → rows in `rate_limit_hits` for one key
 *   freeHandle()                    → `t_<8 hex>` — passes H1/H3, never collides with seed handles
 */
import { randomBytes } from 'node:crypto';
import type { Database } from '@/lib/supabase/types';
import { asRole } from './asRole';

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
