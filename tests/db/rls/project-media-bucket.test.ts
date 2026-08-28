/**
 * tests/db/rls/project-media-bucket.test.ts — Storage matrix for the public-read `project-media`
 * bucket (docs/build/05-test-plan.md §7.1 T-RLS-120; data-model §3; 01 INV-33, INV-51/52).
 * Bucket: supabase/migrations/20260827200200_project_buckets.sql — `public = true` with a select
 * policy for anon + authenticated and NO insert/update/delete policy on `storage.objects` — only
 * the service role (the upload actions' commit phase, 04 §1.4.5) writes here. Cell order:
 * anon | user | banned | mod | admin | svc.
 *
 * Objects are placed via `uploadFixture` (service) under the seed exclusive project's icon folder
 * with `t_` names and removed in `afterAll`; the SEED-13 seed icon in the same folder stays
 * untouched. Allowed types are image/png|jpeg|webp → fixture images/icon-256.png.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { requireTestEnv } from '@/tests/helpers/envTest';
import { fixtureBytes } from '@/tests/helpers/fixtures';
import { listObjects, removeObjects, uploadFixture } from '@/tests/helpers/storage';
import { SEED_PROJECTS } from '@/tests/helpers/seedIds';

const ALL_ROLES = [
  'anon',
  'user',
  'banned',
  'mod',
  'admin',
  'service',
] as const satisfies readonly TestRole[];
const NON_SERVICE = [
  'anon',
  'user',
  'banned',
  'mod',
  'admin',
] as const satisfies readonly TestRole[];

// Storage API object paths carry NO bucket prefix (the DB's media paths do — 04 SC-21).
const FOLDER = `${SEED_PROJECTS.seedExclusivePack}/icon`;
const READ_PATH = `${FOLDER}/t_rls120.png`;
const WRITE_PATH = (role: string): string => `${FOLDER}/t_rls120_${role}.png`;
const SERVICE_PATH = `${FOLDER}/t_rls120_service.png`;

let fixture: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  fixture = await fixtureBytes('images', 'icon-256.png');
  await uploadFixture('project-media', READ_PATH, 'images/icon-256.png');
});

afterAll(async () => {
  const mine = (await listObjects('project-media', FOLDER)).filter((p) => /\/t_rls120/.test(p));
  await removeObjects('project-media', mine);
});

async function exists(path: string): Promise<boolean> {
  return (await listObjects('project-media', FOLDER)).includes(path);
}

// ---------------------------------------------------------------------------------------------
// T-RLS-120 read public — A | A | A | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-120 project-media read', () => {
  it.each(ALL_ROLES)('T-RLS-120 %s downloads media through the Storage API', async (role) => {
    const { data, error } = await asRole(role).storage.from('project-media').download(READ_PATH);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const bytes = new Uint8Array(await data!.arrayBuffer());
    expect(bytes).toEqual(fixture);
  });

  it('T-RLS-120 the public URL serves the object with no key at all (what <img> does)', async () => {
    const url = `${requireTestEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/public/project-media/${READ_PATH}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(fixture);
    // The same template the project card / detail pages build for icons and gallery images.
    expect(
      asRole('anon').storage.from('project-media').getPublicUrl(READ_PATH).data.publicUrl,
    ).toBe(url);
  });

  it('T-RLS-120 anon can list the bucket folder (metadata is public by design)', async () => {
    const { data, error } = await asRole('anon').storage.from('project-media').list(FOLDER);
    expect(error).toBeNull();
    expect((data ?? []).map((o) => o.name)).toContain('t_rls120.png');
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-120 write (direct upload) — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-120 project-media write', () => {
  it.each(NON_SERVICE)('T-RLS-120 %s cannot upload, overwrite, or remove', async (role) => {
    const bucket = asRole(role).storage.from('project-media');

    const upload = await bucket.upload(WRITE_PATH(role), fixture, { contentType: 'image/png' });
    expect(upload.error).not.toBeNull();
    expect(upload.data).toBeNull();
    expect(await exists(WRITE_PATH(role))).toBe(false);

    // Upsert onto the existing object = update → denied too.
    const overwrite = await bucket.upload(READ_PATH, fixture, {
      contentType: 'image/png',
      upsert: true,
    });
    expect(overwrite.error).not.toBeNull();

    // remove() is silently filtered by RLS (no error, nothing removed) — the object must survive.
    const removed = await bucket.remove([READ_PATH]);
    expect(removed.error).toBeNull();
    expect(removed.data ?? []).toEqual([]);
    expect(await exists(READ_PATH)).toBe(true);

    // move/copy are writes as well.
    const moved = await bucket.move(READ_PATH, `${FOLDER}/t_rls120_moved_${role}.png`);
    expect(moved.error).not.toBeNull();
    expect(await exists(READ_PATH)).toBe(true);
  });

  it('T-RLS-120 service uploads, overwrites and removes', async () => {
    const bucket = asRole('service').storage.from('project-media');
    const upload = await bucket.upload(SERVICE_PATH, fixture, { contentType: 'image/png' });
    expect(upload.error).toBeNull();
    expect(await exists(SERVICE_PATH)).toBe(true);

    const overwrite = await bucket.upload(SERVICE_PATH, fixture, {
      contentType: 'image/png',
      upsert: true,
    });
    expect(overwrite.error).toBeNull();

    const removed = await bucket.remove([SERVICE_PATH]);
    expect(removed.error).toBeNull();
    expect(removed.data?.map((o) => o.name)).toEqual([SERVICE_PATH]);
    expect(await exists(SERVICE_PATH)).toBe(false);
  });

  it('T-RLS-120 the bucket rejects anything that is not an allowed image type, even from service', async () => {
    const zip = await fixtureBytes('files', 'pack.zip');
    const { error } = await asRole('service')
      .storage.from('project-media')
      .upload(`${FOLDER}/t_rls120_zip.zip`, zip, { contentType: 'application/zip' });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/mime type/i);
    expect(await exists(`${FOLDER}/t_rls120_zip.zip`)).toBe(false);
  });
});
