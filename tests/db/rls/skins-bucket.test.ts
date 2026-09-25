/**
 * tests/db/rls/skins-bucket.test.ts — Storage matrix for the public-read `skins` bucket
 * (docs/build/05-test-plan.md §7.1 T-RLS-121; data-model §3 "64 KB texture / 512 KB bust";
 * 01 INV-33). Bucket: supabase/migrations/20260925120000_skins_art.sql — `public = true`, PNG only,
 * `file_size_limit` 524288 (the bust ceiling; the texture's 64 KB is `validateUpload`'s, 04 U4),
 * with a select policy for anon + authenticated and NO insert/update/delete policy on
 * `storage.objects` — only the service role (the skin actions, the `renderSkinBust` job, the bulk
 * script) writes here. Cell order: anon | user | banned | mod | admin | svc.
 *
 * The read cells also fetch the SEED-13 seed texture (`<…0601>/texture.png` ← `images/skin-64.png`)
 * — the object `/skins` and `/api/download/[fileId]` serve — by API and by public URL. Test objects
 * are placed via `uploadFixture` (service) in the seed skin's folder with `t_` names and removed in
 * `afterAll`; the seed objects stay untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { requireTestEnv } from '@/tests/helpers/envTest';
import { fixtureBytes } from '@/tests/helpers/fixtures';
import { SEED_SKINS } from '@/tests/helpers/seedIds';
import { listObjects, removeObjects, uploadFixture } from '@/tests/helpers/storage';

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

// Storage API object paths carry NO bucket prefix (the DB's `skins/<id>/…` paths do — 04 SC-21).
const FOLDER = SEED_SKINS.skinA;
const SEED_TEXTURE = `${FOLDER}/texture.png`;
const READ_PATH = `${FOLDER}/t_rls121.png`;
const WRITE_PATH = (role: string): string => `${FOLDER}/t_rls121_${role}.png`;
const SERVICE_PATH = `${FOLDER}/t_rls121_service.png`;

let fixture: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  fixture = await fixtureBytes('images', 'skin-64.png');
  await uploadFixture('skins', READ_PATH, 'images/skin-64.png');
});

afterAll(async () => {
  const mine = (await listObjects('skins', FOLDER)).filter((p) => /\/t_rls121/.test(p));
  await removeObjects('skins', mine);
});

async function exists(path: string): Promise<boolean> {
  return (await listObjects('skins', FOLDER)).includes(path);
}

// ---------------------------------------------------------------------------------------------
// T-RLS-121 read public — A | A | A | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-121 skins read', () => {
  it.each(ALL_ROLES)('T-RLS-121 %s downloads a texture through the Storage API', async (role) => {
    const { data, error } = await asRole(role).storage.from('skins').download(READ_PATH);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const bytes = new Uint8Array(await data!.arrayBuffer());
    expect(bytes).toEqual(fixture);
  });

  it.each(ALL_ROLES)(
    'T-RLS-121 %s reads the SEED-13 seed texture (what the viewer and the download serve)',
    async (role) => {
      const { data, error } = await asRole(role).storage.from('skins').download(SEED_TEXTURE);
      expect(error).toBeNull();
      expect(new Uint8Array(await data!.arrayBuffer())).toEqual(fixture);
    },
  );

  it('T-RLS-121 the public URL serves the texture with no key at all (what skinview3d and <img> do)', async () => {
    const url = `${requireTestEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/public/skins/${SEED_TEXTURE}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(fixture);
    // The same template `lib/data/skins.ts` builds for `textureUrl` / `bustUrl`.
    expect(asRole('anon').storage.from('skins').getPublicUrl(SEED_TEXTURE).data.publicUrl).toBe(
      url,
    );
  });

  it('T-RLS-121 the public URL honours `?download=<name>` — the 04 §2.3 kind-skin 302 target (ADR-0048 D22)', async () => {
    const url = `${requireTestEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/public/skins/${SEED_TEXTURE}?download=seed-skin-a.png`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment/);
    expect(res.headers.get('content-disposition')).toContain('seed-skin-a.png');
  });

  it('T-RLS-121 anon can list the bucket folder (metadata is public by design)', async () => {
    const { data, error } = await asRole('anon').storage.from('skins').list(FOLDER);
    expect(error).toBeNull();
    expect((data ?? []).map((o) => o.name)).toContain('t_rls121.png');
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-121 write (direct upload) — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-121 skins write', () => {
  it.each(NON_SERVICE)('T-RLS-121 %s cannot upload, overwrite, or remove', async (role) => {
    const bucket = asRole(role).storage.from('skins');

    const upload = await bucket.upload(WRITE_PATH(role), fixture, { contentType: 'image/png' });
    expect(upload.error).not.toBeNull();
    expect(upload.data).toBeNull();
    expect(await exists(WRITE_PATH(role))).toBe(false);

    // Upsert onto the existing object = update → denied too (even the admin: the actions write).
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

    // move/copy are writes as well — and the seed texture stays where the seed row points.
    const moved = await bucket.move(SEED_TEXTURE, `${FOLDER}/t_rls121_moved_${role}.png`);
    expect(moved.error).not.toBeNull();
    expect(await exists(SEED_TEXTURE)).toBe(true);
  });

  it('T-RLS-121 service uploads, overwrites and removes', async () => {
    const bucket = asRole('service').storage.from('skins');
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

  it('T-RLS-121 the bucket rejects anything that is not a PNG, even from service (a JPEG, a zip)', async () => {
    const jpg = await fixtureBytes('images', 'tiny.jpg');
    const asJpeg = await asRole('service')
      .storage.from('skins')
      .upload(`${FOLDER}/t_rls121_jpg.jpg`, jpg, { contentType: 'image/jpeg' });
    expect(asJpeg.error).not.toBeNull();
    expect(asJpeg.error?.message).toMatch(/mime type/i);
    expect(await exists(`${FOLDER}/t_rls121_jpg.jpg`)).toBe(false);

    const zip = await fixtureBytes('files', 'pack.zip');
    const asZip = await asRole('service')
      .storage.from('skins')
      .upload(`${FOLDER}/t_rls121_zip.zip`, zip, { contentType: 'application/zip' });
    expect(asZip.error).not.toBeNull();
    expect(asZip.error?.message).toMatch(/mime type/i);
    expect(await exists(`${FOLDER}/t_rls121_zip.zip`)).toBe(false);
  });
});
