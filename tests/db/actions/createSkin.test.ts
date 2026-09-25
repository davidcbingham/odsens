/**
 * tests/db/actions/createSkin.test.ts — T-ACT-57 (create arm), T-ACT-58, and the `createSkin`
 * half of T-ACT-56 (05 §7.2; 04 §1.5 `createSkin`, §3.8, §5.5 `upload:skins`, SC-18 / SC-24;
 * 01 INV-52 / INV-53; ADR-0002 C7; ADR-0048 D6 / D8 / D7 / D9; migration 20260925120000;
 * 00 S1.7 AC1 / AC9).
 *
 * Auth matrix: anon `unauthenticated` · user D `forbidden` · banned D `forbidden` (the seed banned
 * account has role `user`) · **mod D `forbidden`** (ADR-0002 C7) · admin A — the denied rows never
 * write, never revalidate, never audit. T-ACT-58: the texture rule in ADR-0048 D7 order — `skin-64x32.png`
 * and `skin-128.png` → `validation` on `texture` with the VERBATIM "Skins need to be 64×64."; a
 * JPEG named `.png` → the `validateUpload` type copy; > 65 536 bytes → its size copy; `model` /
 * `slug` / `name` / `status` outside their rules → `validation`; a taken `slug` → `conflict` on
 * `slug` and NO object anywhere under `skins/` (the row is inserted before the upload). Success:
 * `status` defaults `draft`, `texture_path = skins/<id>/texture.png`, the object exists as
 * `image/png`, the REAL renderer sets `render_bust_path` and `bust_rendered: true`,
 * `revalidateTag('skins')` exactly once, one keys-only `admin` line. `FormData` input (the island's
 * shape) is converted by `runAction`. The 61st call in an hour → `rate_limited`. T-ACT-56: a
 * failing renderer (mocked `@/lib/skins/render`) still answers `ok` with `bust_rendered: false`,
 * `render_bust_path` NULL and NO `sync_runs` row.
 *
 * Every call runs as a FACTORY admin (`callActionAs`) so the seed admin's `upload:skins` budget
 * stays untouched (05 T-ACT rows share it). Rows the action inserts are adopted with `trackSkin`
 * (row + `skins/<id>/*` leave with `cleanupFactories`, 05 H-1); a by-slug sweep in `afterAll`
 * catches anything a failed assertion left untracked.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSkin } from '@/lib/actions/skins';
import type { CreateSkinInput, SkinRow } from '@/lib/actions/skins.schema';
import { VALIDATION_MESSAGE } from '@/lib/actions/run';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { sizeLimitMessage, typeMessage } from '@/lib/validation/files';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { clearRateLimitHits, countRateLimitHits } from '@/tests/helpers/arrange';
import { asRole } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { cleanupFactories, makeUser, trackSkin } from '@/tests/helpers/factories';
import { fixtureBytes, fixtureFile } from '@/tests/helpers/fixtures';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';
import { listObjects } from '@/tests/helpers/storage';

/** Flipped by the T-ACT-56 rows only; read inside the hoisted mock factory. */
const renderFailure = vi.hoisted(() => ({ active: false }));

vi.mock('@/lib/skins/render', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/skins/render')>();
  const renderBustPng: typeof actual.renderBustPng = async (texture, model, options) => {
    if (renderFailure.active) {
      throw new actual.RenderError('internal', 'Could not encode the bust.');
    }
    return actual.renderBustPng(texture, model, options);
  };
  return { ...actual, renderBustPng };
});

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();

const SCOPE = 'upload:skins';
const NOT_64 = 'Skins need to be 64×64.';
const RUN = randomBytes(4).toString('hex');

let adminId = '';
let counter = 0;
let logs: LogSpy;

/** A fresh slug under this run's tag (`t-` — the slug regex has no underscore). */
function freshSlug(): string {
  counter += 1;
  return `t-${RUN}-${String(counter)}`;
}

async function texture(name = 'skin-64.png', fileName = 'skin.png'): Promise<File> {
  return fixtureFile('images', name, { name: fileName, type: 'image/png' });
}

async function input(overrides: Partial<CreateSkinInput> = {}): Promise<CreateSkinInput> {
  return {
    slug: freshSlug(),
    name: `t_ skin ${RUN}`,
    model: 'classic',
    texture: await texture(),
    ...overrides,
  };
}

async function create(overrides: Partial<CreateSkinInput> = {}): Promise<SkinRow> {
  const res = await callActionAs(createSkin, await input(overrides), { profileId: adminId });
  const { skin } = expectOk(res);
  trackSkin(skin.id);
  return skin;
}

async function idsAt(slug: string): Promise<string[]> {
  const { data, error } = await service.from('skins').select('id').eq('slug', slug);
  if (error) throw new Error(error.message);
  return data.map((row) => row.id);
}

async function readSkin(id: string): Promise<SkinRow> {
  const { data, error } = await service.from('skins').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data;
}

/** The folders under the bucket root — Supabase lists them as id-less entries. */
async function skinFolders(): Promise<string[]> {
  const { data, error } = await service.storage.from('skins').list('', { limit: 1000 });
  if (error) throw new Error(error.message);
  return (data ?? []).map((entry) => entry.name).sort();
}

async function skinRunCount(): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'skins');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function adminLines(): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin');
}

beforeAll(async () => {
  adminId = await makeUser({ role: 'admin' });
});

beforeEach(() => {
  logs = spyLog();
  tags.calls.length = 0;
  renderFailure.active = false;
});

afterEach(() => {
  logs.restore();
  renderFailure.active = false;
});

afterAll(async () => {
  await clearRateLimitHits(SCOPE, adminId);
  await cleanupFactories();
  // Backstop (05 H-1): a row whose test failed before `trackSkin` still leaves with the file.
  const { error } = await service.from('skins').delete().like('slug', `t-${RUN}-%`);
  if (error) throw new Error(`skins sweep failed: ${error.message}`);
});

// ---------------------------------------------------------------------------------------------
// T-ACT-57 auth — admin only (ADR-0002 C7)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-57 createSkin auth', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // The seed banned account has role `user` — `requireRole`'s rank check answers (04 SC-04).
    { role: 'banned' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: skins are admin-only; a moderator reads `/admin/skins`, nothing more.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])(
    'T-ACT-57 $role → $code: nothing written, no object, no revalidate, no audit line',
    async ({ role, code, message }) => {
      const payload = await input({ status: 'published' });
      const folders = await skinFolders();
      const error = expectFail(await callAction(createSkin, payload, { role }), code);
      expect(error.message).toBe(message);
      expect(await idsAt(payload.slug)).toEqual([]);
      expect(await skinFolders()).toEqual(folders);
      expect(tags.calls).toEqual([]);
      expect(adminLines()).toEqual([]);
    },
  );

  it('T-ACT-57 admin → ok (a factory admin; the seed admin is never spent here)', async () => {
    const skin = await create();
    expect(skin.slug).toMatch(new RegExp(`^t-${RUN}-`));
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-58 — the texture rule (ADR-0048 D7 order) and the schema rules
// ---------------------------------------------------------------------------------------------
describe('T-ACT-58 createSkin validation', () => {
  it.each([
    { fixture: 'skin-64x32.png', label: '64×32 (legacy layout)' },
    { fixture: 'skin-128.png', label: '128×128' },
  ])('T-ACT-58 $label → validation on texture with the verbatim copy', async ({ fixture }) => {
    const payload = await input({ texture: await texture(fixture) });
    const error = expectFail(
      await callActionAs(createSkin, payload, { profileId: adminId }),
      'validation',
    );
    expect(error.message).toBe(NOT_64);
    expect(error.field).toBe('texture');
    expect(error.issues).toEqual([{ path: 'texture', message: NOT_64 }]);
    expect(await idsAt(payload.slug)).toEqual([]);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-58 a JPEG named .png → the validateUpload type copy (the bytes decide)', async () => {
    const payload = await input({
      texture: await fixtureFile('images', 'tiny.jpg', { name: 'skin.png', type: 'image/png' }),
    });
    const error = expectFail(
      await callActionAs(createSkin, payload, { profileId: adminId }),
      'validation',
    );
    // Not a PNG at all: `validateUpload` names what it is (ADR-0048 D7 — the 64×64 rule only speaks
    // about PNGs), in the same words the form's pre-check prints.
    expect(error.message).toBe(typeMessage('jpg', 'skin'));
    expect(error.field).toBe('texture');
    expect(error.issues).toEqual([{ path: 'texture', message: typeMessage('jpg', 'skin') }]);
    expect(await idsAt(payload.slug)).toEqual([]);
  });

  it('T-ACT-58 a 64×64 PNG over 65 536 bytes → the validateUpload size copy', async () => {
    const png = await fixtureBytes('images', 'skin-64.png');
    const padded = new Uint8Array(png.byteLength + 70 * 1024);
    padded.set(png, 0); // trailing bytes after IEND: still a 64×64 PNG by IHDR, just too big
    const file = new File([padded], 'skin.png', { type: 'image/png' });
    const payload = await input({ texture: file });
    const error = expectFail(
      await callActionAs(createSkin, payload, { profileId: adminId }),
      'validation',
    );
    expect(error.message).toBe(sizeLimitMessage(padded.byteLength, 'skin'));
    expect(error.message).toMatch(/The limit is 64\.$/);
    expect(error.field).toBe('texture');
    expect(await idsAt(payload.slug)).toEqual([]);
  });

  it('T-ACT-58 a PNG signature with no IHDR → the readable-PNG copy', async () => {
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      'skin.png',
    );
    const error = expectFail(
      await callActionAs(createSkin, await input({ texture: file }), { profileId: adminId }),
      'validation',
    );
    expect(error.message).toBe("That's not a readable PNG. Skins are 64×64.");
    expect(error.field).toBe('texture');
  });

  it.each<{ name: string; overrides: Record<string, unknown>; field: string; message?: string }>([
    {
      name: 'model outside the enum',
      overrides: { model: 'alex' },
      field: 'model',
      message: 'Pick classic or slim.',
    },
    { name: 'slug with an underscore', overrides: { slug: 't_bad' }, field: 'slug' },
    { name: 'slug too short', overrides: { slug: 'ab' }, field: 'slug' },
    {
      name: 'slug reserved',
      overrides: { slug: 'admin' },
      field: 'slug',
      message: "That one's reserved.",
    },
    { name: 'name empty', overrides: { name: '   ' }, field: 'name', message: 'Type a name.' },
    {
      name: 'name 61 chars',
      overrides: { name: 'n'.repeat(61) },
      field: 'name',
      message: 'Too long. 60 characters maximum.',
    },
    {
      name: 'status unknown',
      overrides: { status: 'hidden' },
      field: 'status',
      message: 'Pick draft or published.',
    },
    {
      name: 'description over 5000',
      overrides: { description_md: 'd'.repeat(5001) },
      field: 'description_md',
    },
    { name: 'sort_order negative', overrides: { sort_order: -1 }, field: 'sort_order' },
    { name: 'sort_order fractional', overrides: { sort_order: 1.5 }, field: 'sort_order' },
    { name: 'texture missing', overrides: { texture: undefined }, field: 'texture' },
    { name: 'texture not a File', overrides: { texture: 'skin.png' }, field: 'texture' },
  ])('T-ACT-58 $name → validation on $field', async ({ overrides, field, message }) => {
    const payload = { ...(await input()), ...overrides } as unknown as CreateSkinInput;
    const error = expectFail(
      await callActionAs(createSkin, payload, { profileId: adminId }),
      'validation',
    );
    expect(error.message).toBe(VALIDATION_MESSAGE);
    expect(error.field).toBe(field);
    if (message !== undefined) {
      expect(error.issues?.map((issue) => issue.message)).toContain(message);
    }
    expect(await idsAt(payload.slug)).toEqual([]);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-58 a taken slug → conflict on slug, no second row, NO object under skins/ for it', async () => {
    const first = await create();
    tags.calls.length = 0;
    logs.restore();
    logs = spyLog();
    const folders = await skinFolders();

    const error = expectFail(
      await callActionAs(createSkin, await input({ slug: first.slug }), { profileId: adminId }),
      'conflict',
    );
    expect(error.message).toBe('That slug is already taken.');
    expect(error.field).toBe('slug');
    expect(error.issues).toEqual([{ path: 'slug', message: 'That slug is already taken.' }]);
    expect(await idsAt(first.slug)).toEqual([first.id]);
    expect(await skinFolders()).toEqual(folders);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-58 / T-ACT-57 effects — the row, the object, the bust, the tag, the audit line
// ---------------------------------------------------------------------------------------------
describe('T-ACT-58 createSkin effects', () => {
  it('T-ACT-58 the smallest input: draft by default, texture_path = skins/<id>/texture.png, the object is image/png, the REAL renderer sets the bust, bust_rendered true, revalidates skins ONCE, SC-24 keys only', async () => {
    const payload = await input();
    const runsBefore = await skinRunCount();
    const res = await callActionAs(createSkin, payload, { profileId: adminId });
    const data = expectOk(res);
    trackSkin(data.skin.id);

    expect(data.bust_rendered).toBe(true);
    const row = await readSkin(data.skin.id);
    expect(data.skin).toEqual(row);
    expect(row).toMatchObject({
      slug: payload.slug,
      name: `t_ skin ${RUN}`,
      description_md: null,
      texture_path: `skins/${row.id}/texture.png`,
      model: 'classic',
      render_bust_path: `skins/${row.id}/bust.png`,
      is_exclusive: false,
      status: 'draft',
      sort_order: 0,
      downloads: 0,
    });

    // The texture object, as image/png, byte-identical to the fixture; the bust beside it.
    const { data: blob, error } = await service.storage
      .from('skins')
      .download(`${row.id}/texture.png`);
    expect(error).toBeNull();
    expect(blob?.type).toBe('image/png');
    const stored = new Uint8Array(await (blob as Blob).arrayBuffer());
    expect(
      Buffer.from(stored).equals(Buffer.from(await fixtureBytes('images', 'skin-64.png'))),
    ).toBe(true);
    expect(await listObjects('skins', row.id)).toEqual(
      expect.arrayContaining([`${row.id}/texture.png`, `${row.id}/bust.png`]),
    );

    // A draft is nobody's business but the admin's (RLS — 05 T-RLS-53).
    const { data: asAnon } = await asRole('anon').from('skins').select('id').eq('id', row.id);
    expect(asAnon).toEqual([]);

    // 02 RP-22: `skins` once — the job itself never revalidates.
    expect(tags.calls).toEqual(['skins']);
    // 04 §3.8: the action's render writes NO sync_runs row.
    expect(await skinRunCount()).toBe(runsBefore);

    // SC-24: keys only — no name, no slug.
    const lines = adminLines();
    expect(lines).toHaveLength(1);
    const line = lines[0] as { action: string; id: string; meta: Record<string, unknown> };
    expect(line.action).toBe('createSkin');
    expect(String(line.id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(line.meta).sort()).toEqual([
      'actor_profile_id',
      'fields',
      'target_id',
      'target_type',
    ]);
    expect(line.meta.actor_profile_id).toBe(adminId);
    expect(line.meta.target_type).toBe('skin');
    expect(line.meta.target_id).toBe(row.id);
    expect(line.meta.fields).toEqual(
      expect.arrayContaining([
        'slug',
        'name',
        'model',
        'is_exclusive',
        'status',
        'sort_order',
        'texture',
      ]),
    );
    const text = JSON.stringify(logs.lines);
    expect(text).not.toContain(payload.slug);
    expect(text).not.toContain('t_ skin');
  });

  it('T-ACT-58 every field set, published: stored as sent, visible to anon at once', async () => {
    const row = await create({
      name: '  t_ Fancy  ',
      description_md: 'Slim arms. **Big** feelings.',
      model: 'slim',
      is_exclusive: true,
      status: 'published',
      sort_order: 7,
    });
    expect(row).toMatchObject({
      name: 't_ Fancy',
      description_md: 'Slim arms. **Big** feelings.',
      model: 'slim',
      is_exclusive: true,
      status: 'published',
      sort_order: 7,
    });
    const { data: asAnon } = await asRole('anon').from('skins').select('id').eq('id', row.id);
    expect(asAnon).toEqual([{ id: row.id }]);
  });

  it('T-ACT-58 FormData (the island shape): strings coerce, "true" is on, a blank description is none', async () => {
    const form = new FormData();
    const slug = freshSlug();
    form.set('slug', slug);
    form.set('name', 't_ form skin');
    form.set('description_md', '   ');
    form.set('model', 'slim');
    form.set('is_exclusive', 'true');
    form.set('status', 'published');
    form.set('sort_order', '3');
    form.set('texture', await texture());

    const data = expectOk(await callActionAs(createSkin, form, { profileId: adminId }));
    trackSkin(data.skin.id);
    expect(data.skin).toMatchObject({
      slug,
      name: 't_ form skin',
      description_md: null,
      model: 'slim',
      is_exclusive: true,
      status: 'published',
      sort_order: 3,
    });

    // "false" and an empty file input read as off / absent.
    const off = new FormData();
    off.set('slug', freshSlug());
    off.set('name', 't_ off');
    off.set('model', 'classic');
    off.set('is_exclusive', 'false');
    off.set('sort_order', '');
    off.set('texture', await texture());
    const second = expectOk(await callActionAs(createSkin, off, { profileId: adminId }));
    trackSkin(second.skin.id);
    expect(second.skin).toMatchObject({ is_exclusive: false, sort_order: 0, status: 'draft' });

    const missing = new FormData();
    missing.set('slug', freshSlug());
    missing.set('name', 't_ no file');
    missing.set('model', 'classic');
    missing.set('texture', new File([], ''));
    const error = expectFail(
      await callActionAs(createSkin, missing, { profileId: adminId }),
      'validation',
    );
    expect(error.field).toBe('texture');
  });

  it('T-ACT-58 unknown input keys are stripped: id, downloads, render_bust_path, texture_path of their own never reach the row', async () => {
    const hijack = {
      ...(await input()),
      id: '00000000-0000-4000-8000-000000000601',
      downloads: 99,
      render_bust_path: 'skins/00000000-0000-4000-8000-000000000601/bust.png',
      texture_path: 'skins/00000000-0000-4000-8000-000000000601/texture.png',
    } as unknown as CreateSkinInput;
    const data = expectOk(await callActionAs(createSkin, hijack, { profileId: adminId }));
    trackSkin(data.skin.id);
    expect(data.skin.id).not.toBe('00000000-0000-4000-8000-000000000601');
    expect(data.skin.downloads).toBe(0);
    expect(data.skin.texture_path).toBe(`skins/${data.skin.id}/texture.png`);
    expect(data.skin.render_bust_path).toBe(`skins/${data.skin.id}/bust.png`);
    const { fields } = (adminLines()[0] as { meta: { fields: string[] } }).meta;
    expect(fields).not.toContain('downloads');
    expect(fields).not.toContain('render_bust_path');
  });

  it('T-ACT-58 every call counts against upload:skins; the 61st in an hour → rate_limited (60 / hour / admin)', async () => {
    const burner = await makeUser({ role: 'admin' });
    expect(await countRateLimitHits(SCOPE, burner)).toBe(0);
    const skin = expectOk(await callActionAs(createSkin, await input(), { profileId: burner }));
    trackSkin(skin.skin.id);
    expect(await countRateLimitHits(SCOPE, burner)).toBe(1);

    // 59 more hits arranged directly in `rate_limit_hits` — the only table `rate_limit_ok` counts.
    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 59 }, () => ({ scope: SCOPE, key: burner })));
    expect(error).toBeNull();

    const payload = await input();
    const limited = expectFail(
      await callActionAs(createSkin, payload, { profileId: burner }),
      'rate_limited',
    );
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
    expect(await idsAt(payload.slug)).toEqual([]);
    // The rejected call still recorded its own hit (ADR-0002 A4).
    expect(await countRateLimitHits(SCOPE, burner)).toBe(61);
    await clearRateLimitHits(SCOPE, burner);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-56 (createSkin half) — a failing renderer is not a failing save
// ---------------------------------------------------------------------------------------------
describe('T-ACT-56 createSkin with a failing renderer', () => {
  it('T-ACT-56 → ok with bust_rendered false, render_bust_path NULL, the texture stored, NO sync_runs row, one job error line', async () => {
    const runsBefore = await skinRunCount();
    renderFailure.active = true;
    const payload = await input({ status: 'published' });
    const data = expectOk(await callActionAs(createSkin, payload, { profileId: adminId }));
    trackSkin(data.skin.id);

    expect(data.bust_rendered).toBe(false);
    expect(data.skin.render_bust_path).toBeNull();
    expect((await readSkin(data.skin.id)).render_bust_path).toBeNull();
    expect(await listObjects('skins', data.skin.id)).toEqual([`${data.skin.id}/texture.png`]);
    expect(await skinRunCount()).toBe(runsBefore);
    // Still a saved skin: revalidated and audited like any other.
    expect(tags.calls).toEqual(['skins']);
    expect(adminLines()).toHaveLength(1);
    const jobErrors = (logs.lines as Array<{ job?: string; level?: string }>).filter(
      (line) => line.job === 'renderSkinBust' && line.level === 'error',
    );
    expect(jobErrors).toHaveLength(1);
  });
});
