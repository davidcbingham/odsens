/**
 * tests/db/actions/createArt.test.ts — T-ACT-60 (create arm), T-ACT-61, T-ACT-73 (art leg)
 * (05 §7.2; 04 §1.4.5 two-phase pattern + §1.5 `createArt`, §5.5 `upload:art`, SC-19 / SC-21 /
 * SC-24; 01 INV-51 / INV-52 / INV-53; ADR-0002 C7 / C16; ADR-0048 D3 / D6 / D8 / D9; migration
 * 20260925120000; 00 S1.7 AC7 / AC9).
 *
 * Auth matrix (on `begin`): anon `unauthenticated` · user / banned / mod `forbidden` (ADR-0002 C7)
 * · admin A. `begin`: `size_bytes` 10 485 761 → `validation` with the `sizeLimitMessage(…, 'art')`
 * copy ("10 MB"); mime svg → `validation`; success → `{path, token, signed_url}` with the path
 * `art/<uuid>/<uuid>.<ext>` (the art id minted inside it), no DB row, and exactly one
 * `rate_limit_hits` row even when never committed (T-ACT-73). `commit`: `bad.svg` bytes →
 * `validation` AND the pending object deleted; `thumb-1280x720.png` → `width 1280 / height 720`
 * server-derived (a client-supplied pair is stripped), the object at `art/<id>/<hash16>.png`, the
 * pending path gone, `revalidateTag('art')` once, SC-24; a crafted 8200×10 PNG → `validation` +
 * deleted; the sniffed mime names the final extension; `credit 'a@b.c'` / `year 2000` / `kind`
 * outside the enum / a bad `slug` / `title` bounds → `validation` (T-ACT-61); a taken `slug` →
 * `conflict` with the object LEFT at its final path, and a re-submit with that FINAL path and a
 * free slug → ok (U3); a path for a taken id, a foreign shape, or a swapped id → `forbidden` with
 * the object untouched (T-ACT-73).
 *
 * Every call runs as a FACTORY admin (`callActionAs`). Rows the action inserts are adopted with
 * `trackArt` (row + `art/<id>/*` leave with `cleanupFactories`); objects under a minted id that
 * never became a row are tracked in `leftoverObjects` and removed in `afterAll`.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createArt } from '@/lib/actions/art';
import type { ArtRow, CreateArtCommitInput, CreateArtInput } from '@/lib/actions/art.schema';
import { VALIDATION_MESSAGE } from '@/lib/actions/run';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { sizeLimitMessage, typeMessage } from '@/lib/validation/files';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { clearRateLimitHits, countRateLimitHits } from '@/tests/helpers/arrange';
import { asRole } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { cleanupFactories, makeArt, makeUser, trackArt } from '@/tests/helpers/factories';
import { fixtureBytes } from '@/tests/helpers/fixtures';
import { spyLog, spyRevalidateTag, type LogSpy } from '@/tests/helpers/spies';
import { listObjects, putSigned, removeObjects } from '@/tests/helpers/storage';

setupActionMocks();

const service = asRole('service');
const tags = spyRevalidateTag();

const SCOPE = 'upload:art';
const RUN = randomBytes(4).toString('hex');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const NOT_YOUR_PATH = "That path isn't one of ours.";

let adminId = '';
let counter = 0;
let logs: LogSpy;
/** Objects under minted ids that never became rows (object paths, no bucket prefix). */
const leftoverObjects: string[] = [];

type BeginData = { path: string; token: string; signed_url: string };
type Mime = 'image/png' | 'image/jpeg' | 'image/webp';

function freshSlug(): string {
  counter += 1;
  return `t-${RUN}-${String(counter)}`;
}

function beginInput(mime: Mime = 'image/png', size = 2048): CreateArtInput {
  return { phase: 'begin', filename: `pic.${mime.slice('image/'.length)}`, size_bytes: size, mime };
}

async function beginOk(mime: Mime = 'image/png', profileId = adminId): Promise<BeginData> {
  const data = expectOk(await callActionAs(createArt, beginInput(mime), { profileId }));
  if (!('token' in data)) throw new Error('expected the begin {path, token, signed_url} payload');
  return data;
}

function commitInput(path: string, overrides: Partial<CreateArtCommitInput> = {}): CreateArtInput {
  return {
    phase: 'commit',
    path,
    slug: freshSlug(),
    title: `t_ art ${RUN}`,
    kind: 'avatar',
    ...overrides,
  };
}

function commit(path: string, overrides: Partial<CreateArtCommitInput> = {}) {
  return callActionAs(createArt, commitInput(path, overrides), { profileId: adminId });
}

function expectArt(res: Awaited<ReturnType<typeof commit>>): ArtRow {
  const data = expectOk(res);
  if (!('art' in data)) throw new Error('expected the commit {art} payload');
  trackArt(data.art.id);
  return data.art;
}

/** `art/<id>/<name>` → `<id>/<name>` (the storage API wants the path inside the bucket). */
function objectPath(dbPath: string): string {
  return dbPath.replace(/^art\//, '');
}

function artIdOf(dbPath: string): string {
  return dbPath.split('/')[1] ?? '';
}

function hash16Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

async function craftedPng(width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 24, g: 24, b: 24 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer);
}

async function putBytes(signedUrl: string, bytes: Uint8Array<ArrayBuffer>, type: string) {
  return fetch(signedUrl, {
    method: 'PUT',
    headers: { 'content-type': type, 'x-upsert': 'false' },
    body: bytes,
  });
}

async function readArt(id: string): Promise<ArtRow | null> {
  const { data, error } = await service.from('art').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function adminLines(): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) => line.msg === 'admin');
}

/** Forgets the `begin` phase's own audit line + tag so the assertions see the commit alone. */
function resetSpies(): void {
  logs.restore();
  logs = spyLog();
  tags.calls.length = 0;
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
  await removeObjects('art', leftoverObjects);
  await clearRateLimitHits(SCOPE, adminId);
  await cleanupFactories();
  const { error } = await service.from('art').delete().like('slug', `t-${RUN}-%`);
  if (error) throw new Error(`art sweep failed: ${error.message}`);
});

// ---------------------------------------------------------------------------------------------
// T-ACT-60 auth — admin only (ADR-0002 C7)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-60 createArt auth', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    { role: 'banned' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])('T-ACT-60 $role → $code on begin and on commit', async ({ role, code, message }) => {
    const error = expectFail(await callAction(createArt, beginInput(), { role }), code);
    expect(error.message).toBe(message);
    const path = `art/${randomUUID()}/${randomUUID()}.png`;
    expectFail(await callAction(createArt, commitInput(path), { role }), code);
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-60 begin — declared size / mime, the signed payload, the minted id, rate limit (T-ACT-73)
// ---------------------------------------------------------------------------------------------
describe('T-ACT-60 createArt begin', () => {
  it('T-ACT-60 size_bytes 10 485 761 → validation carrying "10 MB" (AC7)', async () => {
    const error = expectFail(
      await callActionAs(createArt, beginInput('image/png', 10_485_761), { profileId: adminId }),
      'validation',
    );
    expect(error.field).toBe('size_bytes');
    const messages = (error.issues ?? []).map((issue) => issue.message);
    expect(messages).toContain(sizeLimitMessage(10_485_761, 'art'));
    expect(messages.join(' ')).toContain('10 MB');
  });

  it('T-ACT-60 mime image/svg+xml (or gif) → validation (png/jpeg/webp only)', async () => {
    for (const mime of ['image/svg+xml', 'image/gif']) {
      const input = { ...beginInput(), mime } as unknown as CreateArtInput;
      const error = expectFail(
        await callActionAs(createArt, input, { profileId: adminId }),
        'validation',
      );
      expect(error.field).toBe('mime');
      expect((error.issues ?? []).map((issue) => issue.message)).toContain(
        typeMessage(null, 'art'),
      );
    }
  });

  it.each([
    { mime: 'image/png' as const, ext: 'png' },
    { mime: 'image/jpeg' as const, ext: 'jpg' },
    { mime: 'image/webp' as const, ext: 'webp' },
  ])(
    'T-ACT-60 begin $mime → {path, token, signed_url} under a minted id, no DB row',
    async ({ mime, ext }) => {
      const data = await beginOk(mime);
      expect(data.path).toMatch(new RegExp(`^art/${UUID}/${UUID}\\.${ext}$`));
      expect(data.token.length).toBeGreaterThan(0);
      expect(data.signed_url).toContain(`/object/upload/sign/art/${artIdOf(data.path)}/`);
      expect(await readArt(artIdOf(data.path))).toBeNull();
      // Two begins never share an id.
      const again = await beginOk(mime);
      expect(artIdOf(again.path)).not.toBe(artIdOf(data.path));
      // SC-24 on begin: keys only, target = the minted id.
      const line = adminLines().at(-1) as { meta: Record<string, unknown> };
      expect(line.meta.target_type).toBe('art');
      expect(line.meta.target_id).toBe(artIdOf(again.path));
    },
  );

  it('T-ACT-73 begin inserts one rate_limit_hits row even when never committed; the 61st → rate_limited', async () => {
    const burner = await makeUser({ role: 'admin' });
    expect(await countRateLimitHits(SCOPE, burner)).toBe(0);
    await beginOk('image/png', burner);
    expect(await countRateLimitHits(SCOPE, burner)).toBe(1);

    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 59 }, () => ({ scope: SCOPE, key: burner })));
    expect(error).toBeNull();
    const limited = expectFail(
      await callActionAs(createArt, beginInput(), { profileId: burner }),
      'rate_limited',
    );
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
    expect(await countRateLimitHits(SCOPE, burner)).toBe(61);
    await clearRateLimitHits(SCOPE, burner);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-60 commit — re-validation deletes the pending object; success derives width/height
// ---------------------------------------------------------------------------------------------
describe('T-ACT-60 createArt commit', () => {
  it('T-ACT-60 bad.svg bytes (declared png) → validation and the pending object is deleted', async () => {
    const begin = await beginOk();
    const put = await putSigned(begin.signed_url, begin.token, 'images/bad.svg', {
      contentType: 'image/png',
    });
    expect(put.status).toBe(200);
    resetSpies();
    const error = expectFail(await commit(begin.path), 'validation');
    expect(error.message).toBe(typeMessage('svg', 'art'));
    expect(error.field).toBe('path');
    expect(await listObjects('art', artIdOf(begin.path))).toEqual([]);
    expect(await readArt(artIdOf(begin.path))).toBeNull();
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-60 a commit before the PUT → validation "never arrived", nothing written', async () => {
    const begin = await beginOk();
    const error = expectFail(await commit(begin.path), 'validation');
    expect(error.message).toBe('That upload never arrived. Send the file first.');
    expect(await readArt(artIdOf(begin.path))).toBeNull();
  });

  it('T-ACT-60 thumb-1280x720.png → width 1280 / height 720 server-derived (client pair ignored), object at art/<id>/<hash16>.png, pending gone, revalidates art once, SC-24', async () => {
    const begin = await beginOk();
    const put = await putSigned(begin.signed_url, begin.token, 'images/thumb-1280x720.png');
    expect(put.status).toBe(200);
    const bytes = await fixtureBytes('images', 'thumb-1280x720.png');
    const artId = artIdOf(begin.path);
    const finalPath = `art/${artId}/${hash16Of(bytes)}.png`;

    resetSpies();
    const input = {
      ...commitInput(begin.path, {
        title: '  t_ Thumb  ',
        kind: 'thumbnail',
        year: 2025,
        credit: 'seed_user',
        downloadable: true,
        status: 'published',
        sort_order: 3,
      }),
      width: 1,
      height: 1,
    } as unknown as CreateArtInput;
    const data = expectOk(await callActionAs(createArt, input, { profileId: adminId }));
    if (!('art' in data)) throw new Error('expected the commit {art} payload');
    trackArt(data.art.id);

    expect(data.art).toMatchObject({
      id: artId,
      title: 't_ Thumb',
      kind: 'thumbnail',
      image_path: finalPath,
      width: 1280,
      height: 720,
      year: 2025,
      credit: 'seed_user',
      downloadable: true,
      status: 'published',
      sort_order: 3,
    });
    expect(await readArt(artId)).toEqual(data.art);
    const objects = await listObjects('art', artId);
    expect(objects).toEqual([objectPath(finalPath)]);
    expect(tags.calls).toEqual(['art']);

    const lines = adminLines();
    expect(lines).toHaveLength(1);
    const line = lines[0] as { action: string; meta: Record<string, unknown> };
    expect(line.action).toBe('createArt');
    expect(line.meta).toMatchObject({
      actor_profile_id: adminId,
      target_type: 'art',
      target_id: artId,
    });
    expect(line.meta.fields).not.toContain('width');
    expect(JSON.stringify(logs.lines)).not.toContain('t_ Thumb');

    // Published → visible to anon at once (RLS — 05 T-RLS-58).
    const { data: asAnon } = await asRole('anon').from('art').select('id').eq('id', artId);
    expect(asAnon).toEqual([{ id: artId }]);
  });

  it('T-ACT-60 the smallest commit: draft, not downloadable, year / credit NULL, sort_order 0', async () => {
    const begin = await beginOk();
    await putSigned(begin.signed_url, begin.token, 'images/icon-256.png');
    const art = expectArt(await commit(begin.path));
    expect(art).toMatchObject({
      kind: 'avatar',
      width: 256,
      height: 256,
      year: null,
      credit: null,
      downloadable: false,
      status: 'draft',
      sort_order: 0,
    });
    const { data: asAnon } = await asRole('anon').from('art').select('id').eq('id', art.id);
    expect(asAnon).toEqual([]);
  });

  it('T-ACT-60 a crafted 8200×10 PNG → validation with the size, object deleted', async () => {
    const begin = await beginOk();
    const put = await putBytes(begin.signed_url, await craftedPng(8200, 10), 'image/png');
    expect(put.status).toBe(200);
    const error = expectFail(await commit(begin.path), 'validation');
    expect(error.message).toBe("That's 8200×10. Pictures can be up to 8192 pixels a side.");
    expect(await listObjects('art', artIdOf(begin.path))).toEqual([]);
  });

  it('T-ACT-60 the SNIFFED type names the final extension: png declared, webp bytes → .webp; jpeg → .jpg', async () => {
    const begin = await beginOk('image/png');
    await putSigned(begin.signed_url, begin.token, 'images/tiny.webp', {
      contentType: 'image/png',
    });
    const webpBytes = await fixtureBytes('images', 'tiny.webp');
    const webp = expectArt(await commit(begin.path));
    expect(webp.image_path).toBe(`art/${webp.id}/${hash16Of(webpBytes)}.webp`);
    expect(webp).toMatchObject({ width: 1, height: 1 });

    const jpegBegin = await beginOk('image/jpeg');
    expect(jpegBegin.path).toMatch(/\.jpg$/);
    await putSigned(jpegBegin.signed_url, jpegBegin.token, 'images/tiny.jpg');
    const jpg = expectArt(await commit(jpegBegin.path));
    expect(jpg.image_path).toMatch(new RegExp(`^art/${jpg.id}/[0-9a-f]{16}\\.jpg$`));
  });

  it.each<{ name: string; overrides: Record<string, unknown>; field: string; message?: string }>([
    { name: "credit 'a@b.c'", overrides: { credit: 'a@b.c' }, field: 'credit' },
    { name: 'credit 41 chars', overrides: { credit: 'c'.repeat(41) }, field: 'credit' },
    { name: 'year 2000', overrides: { year: 2000 }, field: 'year' },
    {
      name: 'year two years out',
      overrides: { year: new Date().getUTCFullYear() + 2 },
      field: 'year',
    },
    { name: 'year fractional', overrides: { year: 2025.5 }, field: 'year' },
    {
      name: 'kind outside the enum',
      overrides: { kind: 'meme' },
      field: 'kind',
      message: 'Pick a kind.',
    },
    { name: 'slug with an underscore', overrides: { slug: 't_bad' }, field: 'slug' },
    { name: 'title empty', overrides: { title: '  ' }, field: 'title', message: 'Type a title.' },
    { name: 'title 81 chars', overrides: { title: 't'.repeat(81) }, field: 'title' },
    { name: 'status unknown', overrides: { status: 'hidden' }, field: 'status' },
    { name: 'sort_order fractional', overrides: { sort_order: 0.5 }, field: 'sort_order' },
    { name: 'path missing', overrides: { path: undefined }, field: 'path' },
  ])(
    'T-ACT-61 $name → validation on $field, nothing written',
    async ({ overrides, field, message }) => {
      const path = `art/${randomUUID()}/${randomUUID()}.png`;
      const input = { ...commitInput(path), ...overrides } as unknown as CreateArtInput;
      const error = expectFail(
        await callActionAs(createArt, input, { profileId: adminId }),
        'validation',
      );
      expect(error.message).toBe(VALIDATION_MESSAGE);
      expect(error.field).toBe(field);
      if (message !== undefined)
        expect(error.issues?.map((issue) => issue.message)).toContain(message);
      expect(tags.calls).toEqual([]);
    },
  );

  it('T-ACT-61 credit accepts a handle (letters, digits, space, _ . -), year accepts 2015 and next year, null clears', async () => {
    const begin = await beginOk();
    await putSigned(begin.signed_url, begin.token, 'images/icon-256.png');
    const art = expectArt(
      await commit(begin.path, {
        credit: 'Blocky_Bulletin v2.0 -x',
        year: new Date().getUTCFullYear() + 1,
      }),
    );
    expect(art.credit).toBe('Blocky_Bulletin v2.0 -x');
    expect(art.year).toBe(new Date().getUTCFullYear() + 1);

    const second = await beginOk();
    await putSigned(second.signed_url, second.token, 'images/icon-256.png');
    const bare = expectArt(await commit(second.path, { credit: null, year: null }));
    expect(bare.credit).toBeNull();
    expect(bare.year).toBeNull();
  });

  it('T-ACT-60 a taken slug → conflict on slug; the object is LEFT at its final path; a re-submit with that FINAL path and a free slug → ok (U3)', async () => {
    const first = await beginOk();
    await putSigned(first.signed_url, first.token, 'images/icon-256.png');
    const taken = expectArt(await commit(first.path));

    const second = await beginOk();
    await putSigned(second.signed_url, second.token, 'images/thumb-1280x720.png');
    const secondId = artIdOf(second.path);
    const bytes = await fixtureBytes('images', 'thumb-1280x720.png');
    const finalPath = `art/${secondId}/${hash16Of(bytes)}.png`;
    tags.calls.length = 0;

    const error = expectFail(await commit(second.path, { slug: taken.slug }), 'conflict');
    expect(error.message).toBe('That slug is already taken.');
    expect(error.field).toBe('slug');
    expect(await readArt(secondId)).toBeNull();
    expect(await listObjects('art', secondId)).toEqual([objectPath(finalPath)]);
    expect(tags.calls).toEqual([]);
    leftoverObjects.push(objectPath(finalPath));

    // The pending path is gone now — a retry with it says so; the final path is accepted.
    const gone = expectFail(await commit(second.path), 'validation');
    expect(gone.message).toBe('That upload never arrived. Send the file first.');

    const art = expectArt(await commit(finalPath, { kind: 'thumbnail' }));
    expect(art).toMatchObject({ id: secondId, image_path: finalPath, width: 1280, height: 720 });
    expect(await listObjects('art', secondId)).toEqual([objectPath(finalPath)]);
    expect(tags.calls).toEqual(['art']);
  });

  it("T-ACT-73 a path for a TAKEN id (an existing row's folder), a foreign shape, or a swapped id → forbidden; the object untouched", async () => {
    const existing = await makeArt();
    const taken = expectFail(await commit(`art/${existing}/${randomUUID()}.png`), 'forbidden');
    expect(taken.message).toBe(NOT_YOUR_PATH);
    // A final-form path of an existing row is refused the same way (never "re-created").
    const existingRow = await readArt(existing);
    expectFail(await commit(existingRow?.image_path ?? ''), 'forbidden');
    expect(await readArt(existing)).toEqual(existingRow);

    for (const bad of [
      `project-media/${randomUUID()}/icon/${randomUUID()}.png`,
      `art/${randomUUID()}/not-a-uuid.png`,
      `art/${randomUUID()}/${randomUUID()}.gif`,
      `${randomUUID()}/${randomUUID()}.png`,
      'art/../avatars/x.png',
    ]) {
      expect(expectFail(await commit(bad), 'forbidden').message, bad).toBe(NOT_YOUR_PATH);
    }

    // A real begin whose id is swapped for a FREE one in the echoed path: the id is minted
    // inside the path (ADR-0048 D3), so the shape is a begin nobody PUT to — "never arrived"; the real
    // object under the original id is untouched either way.
    const begin = await beginOk();
    await putSigned(begin.signed_url, begin.token, 'images/icon-256.png');
    resetSpies();
    const swapped = begin.path.replace(artIdOf(begin.path), randomUUID());
    const swappedError = expectFail(await commit(swapped), 'validation');
    expect(swappedError.message).toBe('That upload never arrived. Send the file first.');
    expect(await readArt(artIdOf(swapped))).toBeNull();
    expect(await listObjects('art', artIdOf(begin.path))).toEqual([objectPath(begin.path)]);
    leftoverObjects.push(objectPath(begin.path));
    expect(tags.calls).toEqual([]);
    expect(adminLines()).toEqual([]);
  });

  it('T-ACT-60 a commit (path in hand) records NO upload:art hit — it was counted at begin (ADR-0048 D9)', async () => {
    const burner = await makeUser({ role: 'admin' });
    const begin = await beginOk('image/png', burner);
    expect(await countRateLimitHits(SCOPE, burner)).toBe(1);
    await putSigned(begin.signed_url, begin.token, 'images/icon-256.png');
    const data = expectOk(
      await callActionAs(createArt, commitInput(begin.path), { profileId: burner }),
    );
    if (!('art' in data)) throw new Error('expected the commit {art} payload');
    trackArt(data.art.id);
    expect(await countRateLimitHits(SCOPE, burner)).toBe(1);
    await clearRateLimitHits(SCOPE, burner);
  });
});
