/**
 * tests/helpers/globalSetup.e2e.ts — Playwright `globalSetup` (docs/build/05-test-plan.md §1.5 CI-5,
 * §3 SEED-13; ADR-0048 D31). The e2e run reads the seed as truth but never resets the database
 * (that is the db project's H-1 job); what it MUST do is put the SEED-13 storage objects behind the
 * seed rows' paths, because `seed.sql` carries no bytes and the CI `e2e` job starts from a fresh
 * `supabase start`. Locally this is an idempotent upsert over whatever the last db run left.
 * Without it the seeded skin textures answer 400, `SkinViewer3D.loadSkin` rejects and the stage
 * reports `unsupported` — which T-E2E-7 treats as a loud failure (PR #35 round 1, mistaken for a
 * WebGL flag problem until the trace showed the 400).
 */
import { uploadSeedObjects } from './seedObjects';

export default async function globalSetup(): Promise<void> {
  await uploadSeedObjects();
  console.log(
    '[e2e] SEED-13 storage objects uploaded (project-files + project-media + skins + art)',
  );
}
