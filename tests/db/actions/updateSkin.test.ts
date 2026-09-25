/**
 * tests/db/actions/updateSkin.test.ts — T-ACT-57 (update arm), T-ACT-59 (05 §7.2; 04 §1.5
 * `updateSkin`, §3.8, §5.5 `upload:skins`, SC-24; ADR-0002 C7; ADR-0048 D2 / D6 / D8 / D7 / D9;
 * migrations 20260925120000 / 20260925120100 `reorder_skins`).
 *
 * Auth matrix on the patch form AND the reorder form: anon `unauthenticated` · user / banned / mod
 * `forbidden` (ADR-0002 C7) · admin A. T-ACT-59: a replacement `texture` → the object at the SAME
 * path is overwritten (bytes differ), `render_bust_path` is cleared and the REAL renderer sets it
 * again (`bust_rendered: true`) — the clearing is proven with the mocked renderer failing: a row
 * that had a bust ends with NULL and `bust_rendered: false`; the `status` publish toggle,
 * `sort_order`, `is_exclusive`, `description_md: null` (and a blank string) clear; a taken `slug` →
 * `conflict`; unknown id → `not_found`; nothing to change → `validation`; `{reorder}` → every
 * listed row takes its `sort_order` in ONE rpc call, a missing id → `not_found` and NOTHING
 * applied; every call — patch or reorder — records one `upload:skins` hit (ADR-0048 D9), the 61st →
 * `rate_limited`. One `skins` revalidate and one keys-only `admin` line per success.
 *
 * Rows come from `makeSkin` (its texture uploaded by the factory) and leave with
 * `cleanupFactories`; every call runs as a FACTORY admin (`callActionAs`).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateSkin } from '@/lib/actions/skins';
import type { SkinRow, UpdateSkinInput } from '@/lib/actions/skins.schema';
import { VALIDATION_MESSAGE } from '@/lib/actions/run';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { clearRateLimitHits, countRateLimitHits } from '@/tests/helpers/arrange';
import { asRole } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { withDbHook } from '@/tests/helpers/dbFault';
import { cleanupFactories, makeSkin, makeUser } from '@/tests/helpers/factories';
import { fixtureBytes } from '@/tests/helpers/fixtures';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';
import { listObjects } from '@/tests/helpers/storage';

/** Flipped by the "clearing" row only; read inside the hoisted mock factory. */
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
const NO_SUCH_ID = '00000000-0000-4000-8000-0000000000ee';
const RUN = randomBytes(4).toString('hex');

let adminId = '';
let logs: LogSpy;

function adminLines(): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin');
}

async function readSkin(id: string): Promise<SkinRow> {
  const { data, error } = await service.from('skins').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data;
}

async function sortOrders(ids: readonly string[]): Promise<number[]> {
  const rows = await Promise.all(ids.map(readSkin));
  return rows.map((row) => row.sort_order);
}

async function textureBytes(id: string): Promise<Uint8Array> {
  const { data, error } = await service.storage.from('skins').download(`${id}/texture.png`);
  if (error || data === null) throw new Error(`texture download failed: ${error?.message ?? ''}`);
  return new Uint8Array(await data.arrayBuffer());
}

/** A real 64×64 PNG whose bytes differ from `images/skin-64.png` (the factory's texture). */
async function craftedTexture(): Promise<File> {
  const png = await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 1 } },
  })
    .png()
    .toBuffer();
  return new File([new Uint8Array(png)], 'skin.png', { type: 'image/png' });
}

function patch(input: UpdateSkinInput, profileId = adminId) {
  return callActionAs(updateSkin, input, { profileId });
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
});

// ---------------------------------------------------------------------------------------------
// T-ACT-57 auth — admin only, on both forms (ADR-0002 C7)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-57 updateSkin auth', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const },
    { role: 'user' as const, code: 'forbidden' as const },
    { role: 'banned' as const, code: 'forbidden' as const },
    { role: 'mod' as const, code: 'forbidden' as const },
  ])(
    'T-ACT-57 $role → $code on the patch form AND the reorder form: row untouched, no revalidate, no audit line',
    async ({ role, code }) => {
      const id = await makeSkin({ sort_order: 5 });
      expectFail(await callAction(updateSkin, { id, status: 'draft' }, { role }), code);
      expectFail(
        await callAction(updateSkin, { reorder: [{ id, sort_order: 9 }] }, { role }),
        code,
      );
      const row = await readSkin(id);
      expect(row.status).toBe('published');
      expect(row.sort_order).toBe(5);
      expect(tags.calls).toEqual([]);
      expect(adminLines()).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-ACT-59 patch form — texture replace, the metadata keys, conflict, not_found
// ---------------------------------------------------------------------------------------------
describe('T-ACT-59 updateSkin patch', () => {
  it('T-ACT-59 a replacement texture → the SAME path holds the new bytes, render_bust_path set by the real renderer, bust_rendered true; revalidates skins once; SC-24', async () => {
    const id = await makeSkin();
    const before = await textureBytes(id);
    expect((await readSkin(id)).render_bust_path).toBeNull();

    const data = expectOk(await patch({ id, texture: await craftedTexture() }));
    if (!('skin' in data)) throw new Error('expected the {skin, bust_rendered} arm');
    expect(data.bust_rendered).toBe(true);
    expect(data.skin.render_bust_path).toBe(`skins/${id}/bust.png`);
    expect(data.skin.texture_path).toBe(`skins/${id}/texture.png`);

    const after = await textureBytes(id);
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(false);
    expect(after.byteLength).toBeGreaterThan(0);
    // One texture object, one bust — nothing else under the folder.
    expect((await listObjects('skins', id)).sort()).toEqual([
      `${id}/bust.png`,
      `${id}/texture.png`,
    ]);

    expect(tags.calls).toEqual(['skins']);
    const lines = adminLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ action: 'updateSkin' });
    expect((lines[0] as { meta: Record<string, unknown> }).meta).toMatchObject({
      actor_profile_id: adminId,
      target_type: 'skin',
      target_id: id,
    });
    expect((lines[0] as { meta: { fields: string[] } }).meta.fields.sort()).toEqual(
      ['id', 'render_bust_path', 'texture'].sort(),
    );
  });

  it('T-ACT-59 the bust is CLEARED before the re-render: with the renderer failing, a row that had a bust ends NULL and bust_rendered false (the save still ok)', async () => {
    const id = randomUUID();
    await makeSkin({ id, render_bust_path: `skins/${id}/bust.png` });
    renderFailure.active = true;

    const data = expectOk(await patch({ id, texture: await craftedTexture() }));
    if (!('skin' in data)) throw new Error('expected the {skin, bust_rendered} arm');
    expect(data.bust_rendered).toBe(false);
    expect(data.skin.render_bust_path).toBeNull();
    expect((await readSkin(id)).render_bust_path).toBeNull();
    expect(tags.calls).toEqual(['skins']);
    expect(adminLines()).toHaveLength(1);
  });

  it('T-ACT-59 a bad replacement texture → validation on texture, nothing written, the object untouched', async () => {
    const id = await makeSkin();
    const before = await textureBytes(id);
    const bad = new File([await fixtureBytes('images', 'skin-128.png')], 'skin.png', {
      type: 'image/png',
    });
    const error = expectFail(await patch({ id, name: 't_ renamed', texture: bad }), 'validation');
    expect(error.message).toBe('Skins need to be 64×64.');
    expect(error.field).toBe('texture');
    expect((await readSkin(id)).name).not.toBe('t_ renamed');
    expect(Buffer.from(await textureBytes(id)).equals(Buffer.from(before))).toBe(true);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-59 a metadata-only patch: status toggles, sort_order, is_exclusive, model, name, slug; bust_rendered reports the stored bust', async () => {
    const id = await makeSkin();
    const slug = `t-${RUN}-renamed`;
    const data = expectOk(
      await patch({
        id,
        status: 'draft',
        sort_order: 42,
        is_exclusive: true,
        model: 'slim',
        name: '  t_ Renamed  ',
        slug,
      }),
    );
    if (!('skin' in data)) throw new Error('expected the {skin, bust_rendered} arm');
    // No bust yet on a factory skin and no texture in this call: the flag says so.
    expect(data.bust_rendered).toBe(false);
    expect(data.skin).toMatchObject({
      status: 'draft',
      sort_order: 42,
      is_exclusive: true,
      model: 'slim',
      name: 't_ Renamed',
      slug,
      render_bust_path: null,
    });
    expect(await readSkin(id)).toEqual(data.skin);
    // Only the sent keys are audited.
    expect((adminLines()[0] as { meta: { fields: string[] } }).meta.fields.sort()).toEqual(
      ['id', 'is_exclusive', 'model', 'name', 'slug', 'sort_order', 'status'].sort(),
    );

    // Publish again — the toggle both ways, and the texture object is untouched by metadata.
    const back = expectOk(await patch({ id, status: 'published' }));
    if (!('skin' in back)) throw new Error('expected the {skin, bust_rendered} arm');
    expect(back.skin.status).toBe('published');
    expect(await listObjects('skins', id)).toEqual([`${id}/texture.png`]);

    // With a bust in place, a metadata patch reports bust_rendered true.
    const withBust = randomUUID();
    await makeSkin({ id: withBust, render_bust_path: `skins/${withBust}/bust.png` });
    const flagged = expectOk(await patch({ id: withBust, sort_order: 1 }));
    if (!('skin' in flagged)) throw new Error('expected the {skin, bust_rendered} arm');
    expect(flagged.bust_rendered).toBe(true);
  });

  it('T-ACT-59 description_md: null clears; a blank string clears too (the form emptied the field); text is stored', async () => {
    const id = await makeSkin({ description_md: 't_ before' });
    let data = expectOk(await patch({ id, description_md: null }));
    if (!('skin' in data)) throw new Error('expected the {skin, bust_rendered} arm');
    expect(data.skin.description_md).toBeNull();

    data = expectOk(await patch({ id, description_md: 't_ after' }));
    if (!('skin' in data)) throw new Error('expected the {skin, bust_rendered} arm');
    expect(data.skin.description_md).toBe('t_ after');

    const form = new FormData();
    form.set('id', id);
    form.set('description_md', '   ');
    data = expectOk(await callActionAs(updateSkin, form, { profileId: adminId }));
    if (!('skin' in data)) throw new Error('expected the {skin, bust_rendered} arm');
    expect(data.skin.description_md).toBeNull();
  });

  it('T-ACT-59 FormData booleans and numbers: is_exclusive "false" is off, sort_order "12" is 12, a blank sort_order is not a change', async () => {
    const id = await makeSkin({ is_exclusive: true, sort_order: 3 });
    const form = new FormData();
    form.set('id', id);
    form.set('is_exclusive', 'false');
    form.set('sort_order', '12');
    const data = expectOk(await callActionAs(updateSkin, form, { profileId: adminId }));
    if (!('skin' in data)) throw new Error('expected the {skin, bust_rendered} arm');
    expect(data.skin.is_exclusive).toBe(false);
    expect(data.skin.sort_order).toBe(12);

    const blank = new FormData();
    blank.set('id', id);
    blank.set('sort_order', '');
    const error = expectFail(
      await callActionAs(updateSkin, blank, { profileId: adminId }),
      'validation',
    );
    expect(error.issues?.map((issue) => issue.message)).toContain('Nothing to change.');
  });

  it('T-ACT-59 a taken slug → conflict on slug, row untouched, no revalidate', async () => {
    const a = await makeSkin();
    const b = await makeSkin();
    const takenSlug = (await readSkin(a)).slug;
    const error = expectFail(await patch({ id: b, slug: takenSlug, name: 't_ x' }), 'conflict');
    expect(error.message).toBe('That slug is already taken.');
    expect(error.field).toBe('slug');
    expect((await readSkin(b)).slug).not.toBe(takenSlug);
    expect((await readSkin(b)).name).not.toBe('t_ x');
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-59 unknown id → not_found; nothing to change → validation; a bad key → validation', async () => {
    const missing = expectFail(await patch({ id: NO_SUCH_ID, status: 'draft' }), 'not_found');
    expect(missing.message).toBe("That skin doesn't exist.");

    const id = await makeSkin();
    const nothing = expectFail(await patch({ id }), 'validation');
    expect(nothing.message).toBe(VALIDATION_MESSAGE);
    expect(nothing.issues?.map((issue) => issue.message)).toContain('Nothing to change.');

    const bad = expectFail(
      await patch({ id, model: 'alex' } as unknown as UpdateSkinInput),
      'validation',
    );
    // A value that fits neither form fails the union as ONE root issue (the `updateMention`
    // behaviour — zod reports no per-branch paths).
    expect(bad.field).toBeUndefined();
    expect(bad.issues?.[0]?.path).toBe('');
    expect((await readSkin(id)).model).toBe('classic');
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-59 unknown keys are stripped: downloads / texture_path / render_bust_path of the caller never land', async () => {
    const id = await makeSkin();
    const data = expectOk(
      await patch({
        id,
        name: 't_ kept',
        downloads: 99,
        texture_path: 'skins/other/texture.png',
        render_bust_path: 'skins/other/bust.png',
      } as unknown as UpdateSkinInput),
    );
    if (!('skin' in data)) throw new Error('expected the {skin, bust_rendered} arm');
    expect(data.skin.downloads).toBe(0);
    expect(data.skin.texture_path).toBe(`skins/${id}/texture.png`);
    expect(data.skin.render_bust_path).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-59 reorder form — one transaction (RPC `reorder_skins`), one revalidate
// ---------------------------------------------------------------------------------------------
describe('T-ACT-59 updateSkin reorder', () => {
  it('T-ACT-59 [{id, sort_order}] → the rows hold exactly the ints sent, in ONE rpc call; {reordered:n}; revalidates skins once; nothing else moves', async () => {
    const ids = [
      await makeSkin({ sort_order: 10 }),
      await makeSkin({ sort_order: 20, status: 'draft' }),
      await makeSkin({ sort_order: 30, is_exclusive: true }),
    ];
    const before = await Promise.all(ids.map(readSkin));
    const order = [ids[2], ids[0], ids[1]] as string[];

    let rpcCalls = 0;
    const res = await withDbHook(
      { rpc: 'reorder_skins' },
      () => {
        rpcCalls += 1;
        return Promise.resolve();
      },
      () => patch({ reorder: order.map((id, index) => ({ id, sort_order: index + 1 })) }),
      { nth: 'all' },
    );
    expect(expectOk(res)).toEqual({ reordered: 3 });
    expect(rpcCalls).toBe(1);
    expect(await sortOrders(order)).toEqual([1, 2, 3]);

    const after = await Promise.all(ids.map(readSkin));
    after.forEach((row, index) => {
      expect({ ...row, sort_order: 0, updated_at: '' }).toEqual({
        ...before[index],
        sort_order: 0,
        updated_at: '',
      });
    });
    expect(tags.calls).toEqual(['skins']);
    const lines = adminLines();
    expect(lines).toHaveLength(1);
    expect((lines[0] as { meta: Record<string, unknown> }).meta).toEqual({
      actor_profile_id: adminId,
      target_type: 'skins',
      target_id: null,
      fields: ['reorder'],
    });
    for (const id of ids) expect(JSON.stringify(logs.lines)).not.toContain(id);
  });

  it('T-ACT-59 an id that matches no row → not_found and NOTHING is applied (one transaction)', async () => {
    const ids = [await makeSkin({ sort_order: 5 }), await makeSkin({ sort_order: 6 })];
    const error = expectFail(
      await patch({
        reorder: [
          { id: ids[0] as string, sort_order: 1 },
          { id: NO_SUCH_ID, sort_order: 2 },
          { id: ids[1] as string, sort_order: 3 },
        ],
      }),
      'not_found',
    );
    expect(error.message).toBe("One of those skins doesn't exist.");
    expect(await sortOrders(ids)).toEqual([5, 6]);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-59 reorder schema: empty → validation; an id twice → validation; when both forms are sent the reorder wins', async () => {
    const id = await makeSkin({ sort_order: 4 });
    expect(
      expectFail(await patch({ reorder: [] }), 'validation').issues?.map((i) => i.message),
    ).toContain('Nothing to reorder.');
    const twice = expectFail(
      await patch({
        reorder: [
          { id, sort_order: 1 },
          { id, sort_order: 2 },
        ],
      }),
      'validation',
    );
    expect(twice.issues?.map((i) => i.message)).toContain('Each skin once.');

    const both = {
      id,
      status: 'draft',
      reorder: [{ id, sort_order: 8 }],
    } as unknown as UpdateSkinInput;
    expect(expectOk(await patch(both))).toEqual({ reordered: 1 });
    expect((await readSkin(id)).status).toBe('published');
    expect((await readSkin(id)).sort_order).toBe(8);
  });
});

// ---------------------------------------------------------------------------------------------
// ADR-0048 D9 — every call counts against upload:skins
// ---------------------------------------------------------------------------------------------
describe('T-ACT-59 updateSkin rate limit', () => {
  it('T-ACT-59 a patch and a reorder each record one upload:skins hit; the 61st call in an hour → rate_limited', async () => {
    const burner = await makeUser({ role: 'admin' });
    const id = await makeSkin();
    expect(await countRateLimitHits(SCOPE, burner)).toBe(0);
    expectOk(await patch({ id, sort_order: 2 }, burner));
    expect(await countRateLimitHits(SCOPE, burner)).toBe(1);
    expectOk(await patch({ reorder: [{ id, sort_order: 3 }] }, burner));
    expect(await countRateLimitHits(SCOPE, burner)).toBe(2);

    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 58 }, () => ({ scope: SCOPE, key: burner })));
    expect(error).toBeNull();
    const limited = expectFail(await patch({ id, sort_order: 4 }, burner), 'rate_limited');
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
    expect((await readSkin(id)).sort_order).toBe(3);
    expect(await countRateLimitHits(SCOPE, burner)).toBe(61);
    await clearRateLimitHits(SCOPE, burner);
  });
});
