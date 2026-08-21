/**
 * tests/helpers/seedReset.ts — restore a SEED-3 profile after a `mutatesSeed` test (05 H-1).
 *
 * `restoreSeedProfile(id, fields)` removes every avatar object under `avatars/<id>/`, writes the
 * given columns through the service client (trusted session — `profiles_guard` lets it rename and
 * clear `handle_changed_at`) and drops the user's `rate_limit_hits` rows, so back-to-back local runs
 * never trip the 10-per-10-minutes `onboarding` scope (CI starts from a fresh DB; locally the e2e
 * lane reuses it). `readSeedProfile(id)` is the matching read for assertions.
 * Playwright-safe: no `import.meta`, no Vitest imports (05 §1.3 rule for helpers specs may import).
 *
 *   test.afterAll(() => restoreSeedProfile(SEED_USERS.seed_user, { handle: 'seed_user' }));
 */
import { asRole, loose } from './asRole';
import { listObjects, removeObjects } from './storage';

export type SeedProfileColumns = {
  handle: string | null;
  avatar_path: string | null;
  handle_changed_at: string | null;
};

export async function readSeedProfile(id: string): Promise<SeedProfileColumns | null> {
  const { data, error } = await loose(asRole('service'))
    .from('profiles')
    .select('handle, avatar_path, handle_changed_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`readSeedProfile(${id}): ${error.message}`);
  return (data as SeedProfileColumns | null) ?? null;
}

/** `avatar_path` and `handle_changed_at` default to NULL (the SEED-3 values for every seed user). */
export async function restoreSeedProfile(
  id: string,
  fields: Pick<SeedProfileColumns, 'handle'> & Partial<SeedProfileColumns>,
): Promise<void> {
  const objects = await listObjects('avatars', id);
  await removeObjects('avatars', objects);
  const service = loose(asRole('service'));
  const { error } = await service
    .from('profiles')
    .update({ avatar_path: null, handle_changed_at: null, ...fields })
    .eq('id', id);
  if (error) throw new Error(`restoreSeedProfile(${id}): ${error.message}`);
  // Service-only counter table (04 SC-08); keyed by the user id for every accounts scope.
  const { error: hitsError } = await service.from('rate_limit_hits').delete().eq('key', id);
  if (hitsError) throw new Error(`restoreSeedProfile(${id}) rate_limit_hits: ${hitsError.message}`);
}
