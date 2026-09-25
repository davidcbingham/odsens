/**
 * tests/db/actions/updateArt.test.ts — T-ACT-60 (update arm: patch, replace + delete-old-object,
 * reorder) (05 §7.2; 04 §1.4.5 + §1.5 `updateArt`, §5.5 `upload:art`, SC-19 / SC-21 / SC-24;
 * 01 INV-51 / INV-53; ADR-0002 C7; ADR-0048 D2 / D3 / D6 / D8 / D9; migrations 20260925120000 /
 * 20260925120100 `reorder_art`).
 *
 * Auth matrix on every form. `begin` mints a pending path under the EXISTING id (unknown id →
 * `not_found`; one `upload:art` hit). A metadata-only `commit` writes only the keys sent
 * (`year: null` / `credit: null` clear; a blank string clears too), counts one hit, revalidates
 * `art` once, audits keys only. A `commit` with a `path`: the new bytes are validated / moved to
 * `art/<id>/<hash16>.<ext>`, `image_path` / `width` / `height` follow, the OLD object is deleted
 * (only after `isOwnArtPath` — ADR-0048 D2); identical bytes hash to the same path and nothing is
 * deleted; a failed replacement (svg) deletes ITS pending object only — the current image stays
 * and the row is unchanged; a path of ANOTHER id → `forbidden`, both objects untouched; no hit is
 * counted for a commit with a path. `{reorder}` → one rpc call, a missing id → `not_found` and
 * nothing applied. A taken `slug` → `conflict`; nothing to change → `validation`.
 *
 * Rows come from `makeArt` (256×256 `icon-256.png` uploaded by the factory) and leave with
 * `cleanupFactories`; every call runs as a FACTORY admin (`callActionAs`).
 */
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { updateArt } from '@/lib/actions/art';
import type { ArtRow, UpdateArtInput } from '@/lib/actions/art.schema';
import { VALIDATION_MESSAGE } from '@/lib/actions/run';
import { typeMessage } from '@/lib/validation/files';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { clearRateLimitHits, countRateLimitHits } from '@/tests/helpers/arrange';
import { asRole } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { withDbHook } from '@/tests/helpers/dbFault';
import { cleanupFactories, makeArt, makeUser } from '@/tests/helpers/factories';
import { fixtureBytes } from '@/tests/helpers/fixtures';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';
import { listObjects, putSigned } from '@/tests/helpers/storage';

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();

const SCOPE = 'upload:art';
const NO_SUCH_ID = '00000000-0000-4000-8000-0000000000ee';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

let adminId = '';
let logs: LogSpy;

type BeginData = { path: string; token: string; signed_url: string };

function adminLines(): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin');
}

/** Forgets the `begin` phase's own audit line + tag so the assertions see the commit alone. */
function resetSpies(): void {
  logs.restore();
  logs = spyLog();
  tags.calls.length = 0;
}

async function readArt(id: string): Promise<ArtRow> {
  const { data, error } = await service.from('art').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data;
}

async function sortOrders(ids: readonly string[]): Promise<number[]> {
  const rows = await Promise.all(ids.map(readArt));
  return rows.map((row) => row.sort_order);
}

function hash16Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

function objectPath(dbPath: string): string {
  return dbPath.replace(/^art\//, '');
}

function call(input: UpdateArtInput, profileId = adminId) {
  return callActionAs(updateArt, input, { profileId });
}

async function beginOk(id: string, profileId = adminId): Promise<BeginData> {
  const data = expectOk(
    await call(
      { phase: 'begin', id, filename: 'pic.png', size_bytes: 2048, mime: 'image/png' },
      profileId,
    ),
  );
  if (!('token' in data)) throw new Error('expected the begin {path, token, signed_url} payload');
  return data;
}

function expectArt(res: Awaited<ReturnType<typeof call>>): ArtRow {
  const data = expectOk(res);
  if (!('art' in data)) throw new Error('expected the commit {art} payload');
  return data.art;
}

beforeAll(async () => {
  adminId = await makeUser({ role: 'admin' });
});

beforeEach(() => {
  logs = spyLog();
  tags.calls.length = 0;
});

afterEach(() => {
  logs.restore();
});

afterAll(async () => {
  await clearRateLimitHits(SCOPE, adminId);
  await cleanupFactories();
});

// ---------------------------------------------------------------------------------------------
// T-ACT-60 auth — admin only, on every form (ADR-0002 C7)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-60 updateArt auth', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const },
    { role: 'user' as const, code: 'forbidden' as const },
    { role: 'banned' as const, code: 'forbidden' as const },
    { role: 'mod' as const, code: 'forbidden' as const },
  ])(
    'T-ACT-60 $role → $code on begin, commit and reorder: row untouched',
    async ({ role, code }) => {
      const id = await makeArt({ sort_order: 5 });
      expectFail(
        await callAction(
          updateArt,
          { phase: 'begin', id, filename: 'a.png', size_bytes: 10, mime: 'image/png' },
          { role },
        ),
        code,
      );
      expectFail(
        await callAction(updateArt, { phase: 'commit', id, status: 'draft' }, { role }),
        code,
      );
      expectFail(await callAction(updateArt, { reorder: [{ id, sort_order: 9 }] }, { role }), code);
      const row = await readArt(id);
      expect(row.status).toBe('published');
      expect(row.sort_order).toBe(5);
      expect(tags.calls).toEqual([]);
      expect(adminLines()).toEqual([]);
    },
  );
});

// ---------------------------------------------------------------------------------------------
// T-ACT-60 begin — under the existing id
// ---------------------------------------------------------------------------------------------
describe('T-ACT-60 updateArt begin', () => {
  it('T-ACT-60 begin → a pending path under THIS id, no row change, one upload:art hit; unknown id → not_found', async () => {
    const burner = await makeUser({ role: 'admin' });
    const id = await makeArt();
    const before = await readArt(id);
    const data = await beginOk(id, burner);
    expect(data.path).toMatch(new RegExp(`^art/${id}/${UUID}\\.png$`));
    expect(data.signed_url).toContain(`/object/upload/sign/art/${id}/`);
    expect(await readArt(id)).toEqual(before);
    expect(await countRateLimitHits(SCOPE, burner)).toBe(1);
    await clearRateLimitHits(SCOPE, burner);

    const missing = expectFail(
      await call({
        phase: 'begin',
        id: NO_SUCH_ID,
        filename: 'a.png',
        size_bytes: 10,
        mime: 'image/png',
      }),
      'not_found',
    );
    expect(missing.message).toBe("That piece doesn't exist.");
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-60 commit — metadata, replace (old object deleted), failures leave the image alone
// ---------------------------------------------------------------------------------------------
describe('T-ACT-60 updateArt commit', () => {
  it('T-ACT-60 metadata only: the sent keys land, null clears year / credit, one hit, revalidates art once, SC-24 keys only', async () => {
    const burner = await makeUser({ role: 'admin' });
    const id = await makeArt({ year: 2020, credit: 'someone' });
    const before = await readArt(id);

    const art = expectArt(
      await call(
        {
          phase: 'commit',
          id,
          title: '  t_ Retitled  ',
          kind: 'render',
          year: null,
          credit: null,
          downloadable: true,
          status: 'draft',
          sort_order: 9,
        },
        burner,
      ),
    );
    expect(art).toMatchObject({
      title: 't_ Retitled',
      kind: 'render',
      year: null,
      credit: null,
      downloadable: true,
      status: 'draft',
      sort_order: 9,
      image_path: before.image_path,
      width: 256,
      height: 256,
    });
    expect(await readArt(id)).toEqual(art);
    expect(await listObjects('art', id)).toEqual([objectPath(before.image_path)]);
    expect(await countRateLimitHits(SCOPE, burner)).toBe(1);
    await clearRateLimitHits(SCOPE, burner);
    expect(tags.calls).toEqual(['art']);

    const lines = adminLines();
    expect(lines).toHaveLength(1);
    const line = lines[0] as { action: string; meta: Record<string, unknown> };
    expect(line.action).toBe('updateArt');
    expect(line.meta).toMatchObject({
      actor_profile_id: burner,
      target_type: 'art',
      target_id: id,
    });
    expect((line.meta.fields as string[]).sort()).toEqual(
      ['id', 'title', 'kind', 'year', 'credit', 'downloadable', 'status', 'sort_order'].sort(),
    );
    expect(JSON.stringify(logs.lines)).not.toContain('Retitled');

    // A blank credit / year string (the form) clears like null.
    const cleared = expectArt(
      await call({ phase: 'commit', id, credit: '', year: '' } as unknown as UpdateArtInput),
    );
    expect(cleared.credit).toBeNull();
    expect(cleared.year).toBeNull();
  });

  it('T-ACT-60 replace: new bytes → art/<id>/<hash16>.png with the new size, the OLD object deleted, no hit for the commit', async () => {
    const burner = await makeUser({ role: 'admin' });
    const id = await makeArt();
    const before = await readArt(id);
    const begin = await beginOk(id, burner);
    expect(await countRateLimitHits(SCOPE, burner)).toBe(1);
    const put = await putSigned(begin.signed_url, begin.token, 'images/avatar-600.png');
    expect(put.status).toBe(200);
    const bytes = await fixtureBytes('images', 'avatar-600.png');
    resetSpies();
    const finalPath = `art/${id}/${hash16Of(bytes)}.png`;

    const art = expectArt(await call({ phase: 'commit', id, path: begin.path }, burner));
    expect(art).toMatchObject({
      image_path: finalPath,
      width: 600,
      height: 600,
      title: before.title,
    });
    expect(await listObjects('art', id)).toEqual([objectPath(finalPath)]); // old + pending both gone
    expect(await countRateLimitHits(SCOPE, burner)).toBe(1);
    await clearRateLimitHits(SCOPE, burner);
    expect(tags.calls).toEqual(['art']);
    expect((adminLines()[0] as { meta: { fields: string[] } }).meta.fields.sort()).toEqual(
      ['id', 'image_path', 'width', 'height', 'path'].sort(),
    );
  });

  it('T-ACT-60 replace with the SAME bytes → the same path, the object kept (nothing to delete)', async () => {
    const id = await makeArt();
    const before = await readArt(id);
    const begin = await beginOk(id);
    await putSigned(begin.signed_url, begin.token, 'images/icon-256.png');
    const art = expectArt(await call({ phase: 'commit', id, path: begin.path, title: 't_ same' }));
    expect(art.image_path).toBe(before.image_path);
    expect(art.title).toBe('t_ same');
    expect(await listObjects('art', id)).toEqual([objectPath(before.image_path)]);
  });

  it('T-ACT-60 a failed replacement (svg bytes) deletes ITS pending object only: the current image stays, the row is unchanged', async () => {
    const id = await makeArt();
    const before = await readArt(id);
    const begin = await beginOk(id);
    await putSigned(begin.signed_url, begin.token, 'images/bad.svg', { contentType: 'image/png' });
    resetSpies();
    const error = expectFail(
      await call({ phase: 'commit', id, path: begin.path, title: 't_ nope' }),
      'validation',
    );
    expect(error.message).toBe(typeMessage('svg', 'art'));
    expect(await readArt(id)).toEqual(before);
    expect(await listObjects('art', id)).toEqual([objectPath(before.image_path)]);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-60 a path of ANOTHER piece (pending or final) → forbidden, both rows and objects untouched', async () => {
    const owner = await makeArt();
    const other = await makeArt();
    const ownerRow = await readArt(owner);
    const otherRow = await readArt(other);
    const begin = await beginOk(owner);
    await putSigned(begin.signed_url, begin.token, 'images/avatar-600.png');
    resetSpies();

    const error = expectFail(
      await call({ phase: 'commit', id: other, path: begin.path }),
      'forbidden',
    );
    expect(error.message).toBe("That path isn't one of ours.");
    expectFail(await call({ phase: 'commit', id: other, path: ownerRow.image_path }), 'forbidden');
    expectFail(
      await call({ phase: 'commit', id: other, path: `art/${other}/not-a-uuid.png` }),
      'forbidden',
    );

    expect(await readArt(owner)).toEqual(ownerRow);
    expect(await readArt(other)).toEqual(otherRow);
    expect((await listObjects('art', owner)).sort()).toEqual(
      [objectPath(ownerRow.image_path), objectPath(begin.path)].sort(),
    );
    expect(await listObjects('art', other)).toEqual([objectPath(otherRow.image_path)]);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-60 a taken slug → conflict (row untouched); unknown id → not_found; nothing to change → validation', async () => {
    const a = await makeArt();
    const b = await makeArt();
    const takenSlug = (await readArt(a)).slug;
    const conflict = expectFail(
      await call({ phase: 'commit', id: b, slug: takenSlug }),
      'conflict',
    );
    expect(conflict.field).toBe('slug');
    expect((await readArt(b)).slug).not.toBe(takenSlug);

    expectFail(await call({ phase: 'commit', id: NO_SUCH_ID, title: 'x' }), 'not_found');

    const nothing = expectFail(await call({ phase: 'commit', id: b }), 'validation');
    expect(nothing.message).toBe(VALIDATION_MESSAGE);
    expect(nothing.issues?.map((issue) => issue.message)).toContain('Nothing to change.');

    const bad = expectFail(await call({ phase: 'commit', id: b, credit: 'a@b.c' }), 'validation');
    expect(bad.field).toBe('credit');
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-60 width / height / image_path from the caller are stripped', async () => {
    const id = await makeArt();
    const before = await readArt(id);
    const art = expectArt(
      await call({
        phase: 'commit',
        id,
        title: 't_ kept',
        width: 1,
        height: 1,
        image_path: 'art/other/x.png',
      } as unknown as UpdateArtInput),
    );
    expect(art).toMatchObject({ width: 256, height: 256, image_path: before.image_path });
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-60 reorder — one transaction (RPC `reorder_art`)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-60 updateArt reorder', () => {
  it('T-ACT-60 [{id, sort_order}] → the rows hold the ints sent in ONE rpc call; {reordered:n}; one hit; nothing else moves', async () => {
    const burner = await makeUser({ role: 'admin' });
    const ids = [
      await makeArt({ sort_order: 10 }),
      await makeArt({ sort_order: 20, status: 'draft' }),
    ];
    const before = await Promise.all(ids.map(readArt));
    const order = [ids[1], ids[0]] as string[];

    let rpcCalls = 0;
    const res = await withDbHook(
      { rpc: 'reorder_art' },
      () => {
        rpcCalls += 1;
        return Promise.resolve();
      },
      () => call({ reorder: order.map((id, index) => ({ id, sort_order: index + 1 })) }, burner),
      { nth: 'all' },
    );
    expect(expectOk(res)).toEqual({ reordered: 2 });
    expect(rpcCalls).toBe(1);
    expect(await sortOrders(order)).toEqual([1, 2]);
    const after = await Promise.all(ids.map(readArt));
    after.forEach((row, index) => {
      expect({ ...row, sort_order: 0, updated_at: '' }).toEqual({
        ...before[index],
        sort_order: 0,
        updated_at: '',
      });
    });
    expect(await countRateLimitHits(SCOPE, burner)).toBe(1);
    await clearRateLimitHits(SCOPE, burner);
    expect(tags.calls).toEqual(['art']);
    expect((adminLines()[0] as { meta: Record<string, unknown> }).meta).toEqual({
      actor_profile_id: burner,
      target_type: 'art',
      target_id: null,
      fields: ['reorder'],
    });
  });

  it('T-ACT-60 an id that matches no row → not_found and NOTHING is applied', async () => {
    const ids = [await makeArt({ sort_order: 5 }), await makeArt({ sort_order: 6 })];
    const error = expectFail(
      await call({
        reorder: [
          { id: ids[0] as string, sort_order: 1 },
          { id: NO_SUCH_ID, sort_order: 2 },
          { id: ids[1] as string, sort_order: 3 },
        ],
      }),
      'not_found',
    );
    expect(error.message).toBe("One of those pieces doesn't exist.");
    expect(await sortOrders(ids)).toEqual([5, 6]);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-60 reorder schema: empty / an id twice → validation', async () => {
    const id = await makeArt();
    expect(
      expectFail(await call({ reorder: [] }), 'validation').issues?.map((i) => i.message),
    ).toContain('Nothing to reorder.');
    expect(
      expectFail(
        await call({
          reorder: [
            { id, sort_order: 1 },
            { id, sort_order: 2 },
          ],
        }),
        'validation',
      ).issues?.map((i) => i.message),
    ).toContain('Each piece once.');
  });
});
