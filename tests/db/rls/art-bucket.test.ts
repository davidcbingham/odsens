/**
 * tests/db/rls/art-bucket.test.ts — Storage matrix for the public-read `art` bucket
 * (docs/build/05-test-plan.md §7.1 T-RLS-122; data-model §3 "10 MB"; 01 INV-33, INV-51/52).
 * Bucket: supabase/migrations/20260925120000_skins_art.sql — `public = true`, png / jpeg / webp,
 * `file_size_limit` 10485760, with a select policy for anon + authenticated and NO insert/update/
 * delete policy on `storage.objects` — only the service role (the `createArt` / `updateArt` commit
 * phase, 04 §1.4.5) writes here; the browser's `begin` PUT rides a server-issued signed upload
 * token, never a policy. Cell order: anon | user | banned | mod | admin | svc.
 *
 * The read cells also fetch the SEED-13 seed avatar (`<…0701>/b64a4e0e96965d51.png` ←
 * `images/icon-256.png`) — the object `/art` renders and the lightbox's Download points at — by API
 * and by public URL. Test objects are placed via `uploadFixture` (service) in the seed avatar's
 * folder with `t_` names and removed in `afterAll`; the seed object stays untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { requireTestEnv } from '@/tests/helpers/envTest';
import { fixtureBytes } from '@/tests/helpers/fixtures';
import { SEED_ART } from '@/tests/helpers/seedIds';
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

// Storage API object paths carry NO bucket prefix (the DB's `art/<id>/…` paths do — 04 SC-21).
const FOLDER = SEED_ART.avatar;
const SEED_AVATAR = `${FOLDER}/b64a4e0e96965d51.png`;
const READ_PATH = `${FOLDER}/t_rls122.png`;
const WRITE_PATH = (role: string): string => `${FOLDER}/t_rls122_${role}.png`;
const SERVICE_PATH = `${FOLDER}/t_rls122_service.png`;

let fixture: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  fixture = await fixtureBytes('images', 'icon-256.png');
  await uploadFixture('art', READ_PATH, 'images/icon-256.png');
});

afterAll(async () => {
  const mine = (await listObjects('art', FOLDER)).filter((p) => /\/t_rls122/.test(p));
  await removeObjects('art', mine);
});

async function exists(path: string): Promise<boolean> {
  return (await listObjects('art', FOLDER)).includes(path);
}

// ---------------------------------------------------------------------------------------------
// T-RLS-122 read public — A | A | A | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-122 art read', () => {
  it.each(ALL_ROLES)('T-RLS-122 %s downloads a piece through the Storage API', async (role) => {
    const { data, error } = await asRole(role).storage.from('art').download(READ_PATH);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const bytes = new Uint8Array(await data!.arrayBuffer());
    expect(bytes).toEqual(fixture);
  });

  it.each(ALL_ROLES)(
    'T-RLS-122 %s reads the SEED-13 seed avatar (what the masonry renders)',
    async (role) => {
      const { data, error } = await asRole(role).storage.from('art').download(SEED_AVATAR);
      expect(error).toBeNull();
      expect(new Uint8Array(await data!.arrayBuffer())).toEqual(fixture);
    },
  );

  it('T-RLS-122 the public URL serves the piece with no key at all (what next/image fetches)', async () => {
    const url = `${requireTestEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/public/art/${SEED_AVATAR}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(fixture);
    // The same template `lib/data/art.ts` builds for `imageUrl`.
    expect(asRole('anon').storage.from('art').getPublicUrl(SEED_AVATAR).data.publicUrl).toBe(url);
  });

  it('T-RLS-122 the public URL honours `?download=<slug>.<ext>` — the lightbox Download link (ADR-0048 D17)', async () => {
    const url = `${requireTestEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/public/art/${SEED_AVATAR}?download=seed-art-avatar.png`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment/);
    expect(res.headers.get('content-disposition')).toContain('seed-art-avatar.png');
  });

  it('T-RLS-122 anon can list the bucket folder (metadata is public by design)', async () => {
    const { data, error } = await asRole('anon').storage.from('art').list(FOLDER);
    expect(error).toBeNull();
    expect((data ?? []).map((o) => o.name)).toContain('t_rls122.png');
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-122 write (direct upload) — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-122 art write', () => {
  it.each(NON_SERVICE)('T-RLS-122 %s cannot upload, overwrite, or remove', async (role) => {
    const bucket = asRole(role).storage.from('art');

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

    // move/copy are writes as well — and the seed piece stays where the seed row points.
    const moved = await bucket.move(SEED_AVATAR, `${FOLDER}/t_rls122_moved_${role}.png`);
    expect(moved.error).not.toBeNull();
    expect(await exists(SEED_AVATAR)).toBe(true);
  });

  it('T-RLS-122 service uploads, overwrites and removes', async () => {
    const bucket = asRole('service').storage.from('art');
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

  it('T-RLS-122 service can place the other two allowed types (jpeg, webp) — the commit phase’s .jpg / .webp paths', async () => {
    const bucket = asRole('service').storage.from('art');
    const jpg = await fixtureBytes('images', 'tiny.jpg');
    const webp = await fixtureBytes('images', 'tiny.webp');
    const asJpeg = await bucket.upload(`${FOLDER}/t_rls122_ok.jpg`, jpg, {
      contentType: 'image/jpeg',
    });
    expect(asJpeg.error).toBeNull();
    const asWebp = await bucket.upload(`${FOLDER}/t_rls122_ok.webp`, webp, {
      contentType: 'image/webp',
    });
    expect(asWebp.error).toBeNull();
    expect(await exists(`${FOLDER}/t_rls122_ok.jpg`)).toBe(true);
    expect(await exists(`${FOLDER}/t_rls122_ok.webp`)).toBe(true);
  });

  it('T-RLS-122 the bucket rejects anything that is not an allowed image type, even from service (a gif, a zip)', async () => {
    const gif = await fixtureBytes('images', 'bad.gif');
    const asGif = await asRole('service')
      .storage.from('art')
      .upload(`${FOLDER}/t_rls122_gif.gif`, gif, { contentType: 'image/gif' });
    expect(asGif.error).not.toBeNull();
    expect(asGif.error?.message).toMatch(/mime type/i);
    expect(await exists(`${FOLDER}/t_rls122_gif.gif`)).toBe(false);

    const zip = await fixtureBytes('files', 'pack.zip');
    const asZip = await asRole('service')
      .storage.from('art')
      .upload(`${FOLDER}/t_rls122_zip.zip`, zip, { contentType: 'application/zip' });
    expect(asZip.error).not.toBeNull();
    expect(asZip.error?.message).toMatch(/mime type/i);
    expect(await exists(`${FOLDER}/t_rls122_zip.zip`)).toBe(false);
  });
});
