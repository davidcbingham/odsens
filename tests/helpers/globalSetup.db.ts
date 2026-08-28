/**
 * tests/helpers/globalSetup.db.ts — Vitest `db` project globalSetup (docs/build/05-test-plan.md §1.5 H-1).
 * Runs `supabase db reset` ONCE per run: applies supabase/migrations/* + supabase/seed.sql against the
 * local stack (API :54321, DB :54322). Set SKIP_DB_RESET=1 to reuse the current local state.
 * Then uploads the SEED-13 storage objects (`seed.sql` never carries bytes): the exclusive project's
 * file + icon — the reset wiped `storage.objects`, so this runs on every reset (and harmlessly
 * upserts when the reset was skipped). Skin/art objects join in S1.7 with their fixtures.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadEnvTest } from './envTest';
import { fixturePath } from './fixtures';
import { SEED_PROJECTS, SEED_VERSIONS } from './seedIds';
import { uploadFixture } from './storage';

/** SEED-13: the objects the seed rows point at (paths WITHOUT the bucket prefix). */
async function uploadSeedObjects(): Promise<void> {
  // globalSetup runs in its own process, before any setupFiles — load `.env.test` itself.
  loadEnvTest();
  const projectId = SEED_PROJECTS.seedExclusivePack;
  const versionId = SEED_VERSIONS.exclusive_1_0_0;

  await uploadFixture(
    'project-files',
    `${projectId}/${versionId}/seed-exclusive-pack-1.0.0.zip`,
    'files/pack.zip',
  );

  // The icon path's `{hash16}` segment is content-addressed (04 SC-21) — derive it from the fixture
  // bytes so it always equals the literal `seed.sql` stores (F-8 keeps the two in sync).
  const iconBytes = await readFile(fixturePath('images', 'icon-256.png'));
  const hash16 = createHash('sha256').update(iconBytes).digest('hex').slice(0, 16);
  await uploadFixture('project-media', `${projectId}/icon/${hash16}.png`, 'images/icon-256.png');
  console.log('[db] SEED-13 storage objects uploaded (project-files + project-media)');
}

export default async function globalSetup(): Promise<void> {
  if (process.env.SKIP_DB_RESET === '1') {
    console.log(
      '[db] SKIP_DB_RESET=1 — reusing the current local database state (H-1 reset skipped)',
    );
    await uploadSeedObjects();
    return;
  }
  console.log('[db] supabase db reset (H-1: once per run)…');
  const result = spawnSync('supabase', ['db', 'reset'], { stdio: 'inherit', timeout: 240_000 });
  if (result.error) {
    throw new Error(
      `[db] could not run "supabase db reset": ${result.error.message}. ` +
        'Install the Supabase CLI and run `supabase start` first (docs/dev-tooling.md).',
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `[db] "supabase db reset" exited with status ${String(result.status)} (signal ${String(result.signal)}). ` +
        'Is the local stack running? Check `supabase status`.',
    );
  }
  await uploadSeedObjects();
}
