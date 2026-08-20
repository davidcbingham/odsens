/**
 * tests/db/rls/avatars.test.ts — Storage matrix for the `avatars` bucket (docs/build/05-test-plan.md
 * §7.1 T-RLS-115/116; data-model §3; 01 INV-14/INV-47). Public-read bucket: `storage.objects` has a
 * SELECT policy for anon + authenticated and NO insert/update/delete policy — only the service role
 * (the server's re-encode path, lib/files.ts) writes here. Cell order: anon | user | banned | mod |
 * admin | svc.
 *
 * Objects are placed via `uploadFixture` (service) under the seed user's folder with a `t_` name
 * and removed in `afterAll`. The bucket accepts only image/webp → fixture images/tiny.webp (32 B).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, type TestRole } from '@/tests/helpers/asRole';
import { requireTestEnv } from '@/tests/helpers/envTest';
import { fixtureBytes } from '@/tests/helpers/fixtures';
import { listObjects, removeObjects, uploadFixture } from '@/tests/helpers/storage';
import { SEED_USERS } from '@/tests/helpers/seedIds';

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

const FOLDER = SEED_USERS.seed_user;
const READ_PATH = `${FOLDER}/t_rls115.webp`;
const WRITE_PATH = (role: string): string => `${FOLDER}/t_rls116_${role}.webp`;
const SERVICE_PATH = `${FOLDER}/t_rls116_service.webp`;

let fixture: Uint8Array<ArrayBuffer>;

beforeAll(async () => {
  fixture = await fixtureBytes('images', 'tiny.webp');
  await uploadFixture('avatars', READ_PATH, 'images/tiny.webp');
});

afterAll(async () => {
  const mine = (await listObjects('avatars', FOLDER)).filter((p) => /\/t_rls11[56]/.test(p));
  await removeObjects('avatars', mine);
});

async function exists(path: string): Promise<boolean> {
  return (await listObjects('avatars', FOLDER)).includes(path);
}

// ---------------------------------------------------------------------------------------------
// T-RLS-115 read public object — A | A | A | A | A | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-115 avatars read', () => {
  it.each(ALL_ROLES)('T-RLS-115 %s downloads an avatar through the Storage API', async (role) => {
    const { data, error } = await asRole(role).storage.from('avatars').download(READ_PATH);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const bytes = new Uint8Array(await data!.arrayBuffer());
    expect(bytes).toEqual(fixture);
  });

  it('T-RLS-115 the public URL serves the object with no key at all (what <img> does)', async () => {
    const url = `${requireTestEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/public/avatars/${READ_PATH}`;
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(fixture);
    // The same template lib/files.ts avatarPublicUrl() / ViewerProvider build.
    expect(asRole('anon').storage.from('avatars').getPublicUrl(READ_PATH).data.publicUrl).toBe(url);
  });

  it('T-RLS-115 anon can list the bucket folder (metadata is public by design)', async () => {
    const { data, error } = await asRole('anon').storage.from('avatars').list(FOLDER);
    expect(error).toBeNull();
    expect((data ?? []).map((o) => o.name)).toContain('t_rls115.webp');
  });
});

// ---------------------------------------------------------------------------------------------
// T-RLS-116 write (direct upload) — D | D | D | D | D | A
// ---------------------------------------------------------------------------------------------
describe('T-RLS-116 avatars write', () => {
  it.each(NON_SERVICE)('T-RLS-116 %s cannot upload, overwrite, or remove', async (role) => {
    const bucket = asRole(role).storage.from('avatars');

    const upload = await bucket.upload(WRITE_PATH(role), fixture, { contentType: 'image/webp' });
    expect(upload.error).not.toBeNull();
    expect(upload.data).toBeNull();
    expect(await exists(WRITE_PATH(role))).toBe(false);

    // Upsert onto the existing object = update → denied too.
    const overwrite = await bucket.upload(READ_PATH, fixture, {
      contentType: 'image/webp',
      upsert: true,
    });
    expect(overwrite.error).not.toBeNull();

    // remove() is silently filtered by RLS (no error, nothing removed) — the object must survive.
    const removed = await bucket.remove([READ_PATH]);
    expect(removed.error).toBeNull();
    expect(removed.data ?? []).toEqual([]);
    expect(await exists(READ_PATH)).toBe(true);

    // move/copy are writes as well.
    const moved = await bucket.move(READ_PATH, `${FOLDER}/t_rls116_moved_${role}.webp`);
    expect(moved.error).not.toBeNull();
    expect(await exists(READ_PATH)).toBe(true);
  });

  it('T-RLS-116 service uploads, overwrites and removes', async () => {
    const bucket = asRole('service').storage.from('avatars');
    const upload = await bucket.upload(SERVICE_PATH, fixture, { contentType: 'image/webp' });
    expect(upload.error).toBeNull();
    expect(await exists(SERVICE_PATH)).toBe(true);

    const overwrite = await bucket.upload(SERVICE_PATH, fixture, {
      contentType: 'image/webp',
      upsert: true,
    });
    expect(overwrite.error).toBeNull();

    const removed = await bucket.remove([SERVICE_PATH]);
    expect(removed.error).toBeNull();
    expect(removed.data?.map((o) => o.name)).toEqual([SERVICE_PATH]);
    expect(await exists(SERVICE_PATH)).toBe(false);
  });

  it('T-RLS-116 the bucket rejects anything that is not image/webp, even from service', async () => {
    const png = await fixtureBytes('images', 'avatar-600.png');
    const { error } = await asRole('service')
      .storage.from('avatars')
      .upload(`${FOLDER}/t_rls116_png.png`, png, { contentType: 'image/png' });
    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/mime type/i);
    expect(await exists(`${FOLDER}/t_rls116_png.png`)).toBe(false);
  });
});
