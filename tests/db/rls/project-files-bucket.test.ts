/**
 * tests/db/rls/project-files-bucket.test.ts — Storage matrix for the private `project-files` bucket
 * (docs/build/05-test-plan.md §7.1 T-RLS-117/118/119; data-model §3; 01 INV-33, INV-51/52; 04 §1.4.5).
 * Bucket: supabase/migrations/20260827200200_project_buckets.sql — `public = false` with NO select
 * policy (objects are reachable only via the 60 s signed URLs the download route mints, T-RLS-118)
 * and NO write policy on `storage.objects` (browser uploads ride a server-issued signed upload URL —
 * a token, not a policy). Cell order: anon | user | banned | mod | admin | svc.
 *
 * Objects are placed via `uploadFixture` (service) under the seed exclusive project's version folder
 * with `t_` names and removed in `afterAll`; the SEED-13 seed object in the same folder stays
 * untouched. The bucket accepts only application/zip → fixture files/pack.zip.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessTokenFor, asRole, type TestRole } from '@/tests/helpers/asRole';
import { requireTestEnv } from '@/tests/helpers/envTest';
import { fixtureBytes } from '@/tests/helpers/fixtures';
import { listObjects, removeObjects, uploadFixture } from '@/tests/helpers/storage';
import { SEED_PROJECTS, SEED_VERSIONS } from '@/tests/helpers/seedIds';

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

// Storage API object paths carry NO bucket prefix (the DB's `storage_path` column does — 04 SC-16).
const FOLDER = `${SEED_PROJECTS.seedExclusivePack}/${SEED_VERSIONS.exclusive_1_0_0}`;
const READ_PATH = `${FOLDER}/t_rls117.zip`;
const WRITE_PATH = (role: string): string => `${FOLDER}/t_rls119_${role}.zip`;
const SERVICE_PATH = `${FOLDER}/t_rls119_service.zip`;

let fixture: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  fixture = await fixtureBytes('files', 'pack.zip');
  await uploadFixture('project-files', READ_PATH, 'files/pack.zip');
});

afterAll(async () => {
  const mine = (await listObjects('project-files', FOLDER)).filter((p) => /\/t_rls11[789]/.test(p));
  await removeObjects('project-files', mine);
});

async function exists(path: string): Promise<boolean> {
  return (await listObjects('project-files', FOLDER)).includes(path);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The credential each role would carry on a raw HTTP fetch (anon = none at all). */
async function fetchHeadersFor(role: TestRole): Promise<Record<string, string>> {
  if (role === 'anon') return {};
  if (role === 'service') {
    return { authorization: `Bearer ${requireTestEnv('SUPABASE_SERVICE_ROLE_KEY')}` };
  }
  return { authorization: `Bearer ${await accessTokenFor(role)}` };
}

// ---------------------------------------------------------------------------------------------
// T-RLS-117 read via public URL / download() (bucket private) — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-117 project-files read', () => {
  it.each(NON_SERVICE)(
    'T-RLS-117 %s cannot download or even list (no select policy)',
    async (role) => {
      const bucket = asRole(role).storage.from('project-files');

      const { data, error } = await bucket.download(READ_PATH);
      expect(error).not.toBeNull();
      expect(data).toBeNull();

      // Metadata is invisible too: an RLS-filtered list() is empty with no error.
      const listed = await bucket.list(FOLDER);
      expect(listed.error).toBeNull();
      expect(listed.data ?? []).toEqual([]);
    },
  );

  it('T-RLS-117 the public URL does not serve the object (what a leaked <a href> would try)', async () => {
    const url = `${requireTestEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/public/project-files/${READ_PATH}`;
    // getPublicUrl() builds the same template regardless of bucket privacy — fetching it must fail.
    expect(
      asRole('anon').storage.from('project-files').getPublicUrl(READ_PATH).data.publicUrl,
    ).toBe(url);
    const res = await fetch(url);
    expect(res.status).not.toBe(200);
    expect(res.ok).toBe(false);
  });

  it('T-RLS-117 service downloads the object through the Storage API', async () => {
    const { data, error } = await asRole('service')
      .storage.from('project-files')
      .download(READ_PATH);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const bytes = new Uint8Array(await data!.arrayBuffer());
    expect(bytes).toEqual(fixture);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-118 read via signed URL created by svc — A (all roles: the URL carries its own auth)
// ---------------------------------------------------------------------------------------------
describe('T-RLS-118 project-files signed URL', () => {
  let signedUrl: string;

  beforeAll(async () => {
    const { data, error } = await asRole('service')
      .storage.from('project-files')
      .createSignedUrl(READ_PATH, 60);
    if (error || !data) throw new Error(`createSignedUrl failed: ${error?.message ?? 'no data'}`);
    signedUrl = data.signedUrl;
  });

  it('T-RLS-118 only service can mint one (createSignedUrl is a read — RLS hides the object)', async () => {
    const { data, error } = await asRole('user')
      .storage.from('project-files')
      .createSignedUrl(READ_PATH, 60);
    expect(error).not.toBeNull();
    expect(data).toBeNull();
  });

  it.each(ALL_ROLES)('T-RLS-118 %s fetches the svc-signed URL within TTL → 200', async (role) => {
    const res = await fetch(signedUrl, { headers: await fetchHeadersFor(role) });
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(fixture);
  });

  it('T-RLS-118 after expiry the fetch is not 200 (Supabase returns 400 InvalidJWT)', async () => {
    // tests/helpers/time.ts fakes the app clock only (and is an S1.4 stub) — it cannot age a live
    // server's JWT check, so this uses a real 1 s TTL and sleeps past it (FLK-safe: 0.5 s slack).
    const { data, error } = await asRole('service')
      .storage.from('project-files')
      .createSignedUrl(READ_PATH, 1);
    if (error || !data) throw new Error(`createSignedUrl failed: ${error?.message ?? 'no data'}`);
    await sleep(1500);
    const res = await fetch(data.signedUrl);
    expect(res.status).not.toBe(200);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/InvalidJWT|expired/i);
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-119 write (direct upload(); two-phase flow uses a server-issued signed upload URL,
// not a policy — 04 §1.4.5) — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-119 project-files write', () => {
  it.each(NON_SERVICE)('T-RLS-119 %s cannot upload, overwrite, or remove', async (role) => {
    const bucket = asRole(role).storage.from('project-files');

    const upload = await bucket.upload(WRITE_PATH(role), fixture, {
      contentType: 'application/zip',
    });
    expect(upload.error).not.toBeNull();
    expect(upload.data).toBeNull();
    expect(await exists(WRITE_PATH(role))).toBe(false);

    // Upsert onto the existing object = update → denied too.
    const overwrite = await bucket.upload(READ_PATH, fixture, {
      contentType: 'application/zip',
      upsert: true,
    });
    expect(overwrite.error).not.toBeNull();

    // remove() is silently filtered by RLS (no error, nothing removed) — the object must survive.
    const removed = await bucket.remove([READ_PATH]);
    expect(removed.error).toBeNull();
    expect(removed.data ?? []).toEqual([]);
    expect(await exists(READ_PATH)).toBe(true);

    // move/copy are writes as well.
    const moved = await bucket.move(READ_PATH, `${FOLDER}/t_rls119_moved_${role}.zip`);
    expect(moved.error).not.toBeNull();
    expect(await exists(READ_PATH)).toBe(true);
  });

  it('T-RLS-119 service uploads, overwrites and removes', async () => {
    const bucket = asRole('service').storage.from('project-files');
    const upload = await bucket.upload(SERVICE_PATH, fixture, { contentType: 'application/zip' });
    expect(upload.error).toBeNull();
    expect(await exists(SERVICE_PATH)).toBe(true);

    const overwrite = await bucket.upload(SERVICE_PATH, fixture, {
      contentType: 'application/zip',
      upsert: true,
    });
    expect(overwrite.error).toBeNull();

    const removed = await bucket.remove([SERVICE_PATH]);
    expect(removed.error).toBeNull();
    expect(removed.data?.map((o) => o.name)).toEqual([SERVICE_PATH]);
    expect(await exists(SERVICE_PATH)).toBe(false);
  });

  it('T-RLS-119 the bucket rejects anything that is not application/zip, even from service', async () => {
    const png = await fixtureBytes('images', 'icon-256.png');
    const { error } = await asRole('service')
      .storage.from('project-files')
      .upload(`${FOLDER}/t_rls119_png.png`, png, { contentType: 'image/png' });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/mime type/i);
    expect(await exists(`${FOLDER}/t_rls119_png.png`)).toBe(false);
  });
});
