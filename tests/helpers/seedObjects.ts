/**
 * tests/helpers/seedObjects.ts — `uploadSeedObjects()` (docs/build/05-test-plan.md §3 SEED-13, §1.5 CI-5).
 * `seed.sql` never carries bytes: the objects its rows point at are uploaded here through the service
 * client (`uploadFixture`, upsert — safe to run on every start). Called by BOTH globalSetups:
 * `globalSetup.db.ts` after its reset, and `globalSetup.e2e.ts` before the Playwright run — the CI `e2e`
 * job starts a fresh stack that the db job never touched, so without this the seed textures answer
 * 400 and `SkinViewer3D` falls to `unsupported` (ADR-0048 D31, PR #35 round 2).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadEnvTest } from './envTest';
import { fixturePath } from './fixtures';
import { SEED_ART, SEED_PROJECTS, SEED_SKINS, SEED_VERSIONS } from './seedIds';
import { uploadFixture } from './storage';

/** SEED-13: the objects the seed rows point at (paths WITHOUT the bucket prefix). */
export async function uploadSeedObjects(): Promise<void> {
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

  // S1.7 (SEED-7/8 + their SEED-13 objects): both textures are the 64×64 brand skin; …0601's bust is
  // "any PNG" (the 16:9 thumb — the card only needs an <img>); the art paths carry the fixtures'
  // own `{hash16}` (F-8 keeps them equal to the `seed.sql` literals). Object paths carry no bucket
  // prefix — the DB rows do (`skins/…`, `art/…`; 04 SC-21).
  await uploadFixture('skins', `${SEED_SKINS.skinA}/texture.png`, 'images/skin-64.png');
  await uploadFixture('skins', `${SEED_SKINS.skinB}/texture.png`, 'images/skin-64.png');
  await uploadFixture('skins', `${SEED_SKINS.skinA}/bust.png`, 'images/thumb-1280x720.png');
  const thumbBytes = await readFile(fixturePath('images', 'thumb-1280x720.png'));
  const thumbHash16 = createHash('sha256').update(thumbBytes).digest('hex').slice(0, 16);
  await uploadFixture('art', `${SEED_ART.avatar}/${hash16}.png`, 'images/icon-256.png');
  await uploadFixture('art', `${SEED_ART.thumb}/${thumbHash16}.png`, 'images/thumb-1280x720.png');
}
