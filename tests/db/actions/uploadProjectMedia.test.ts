/**
 * tests/db/actions/uploadProjectMedia.test.ts — T-ACT-38 + T-ACT-73 (media half) (05 §7.2;
 * 04 §1.4 `uploadProjectMedia` + §1.4.5 two-phase pattern; ADR-0002 C7 / C10 / C16;
 * 01 INV-51/52/53; migration 20260827200200; fixtures `images/*`).
 *
 * Auth matrix: anon `unauthenticated` · user D `forbidden` · banned D `forbidden` (the seed banned
 * account has role `user`, so `requireRole`'s rank check answers — 04 SC-04) · **mod D `forbidden`**
 * (ADR-0002 C7: uploads are admin-only for every kind and source) · admin A.
 *
 * `begin`: declared size/mime checked by the schema (copy from `lib/validation/files.ts`); success
 * returns `{path, token, signed_url}` with a uuid pending path and writes NO DB row; the 61st begin
 * in an hour → `rate_limited` (60/hour/user, 04 §5.5). `commit` re-validates the ACTUAL bytes
 * (SC-19): svg bytes / wrong dimensions → `validation` AND the pending object is deleted; success
 * moves the object to its `{hash16}` path and writes `projects.icon_url` (icon, `odsens` only —
 * a Modrinth project refuses at begin already), `projects.gallery` (`odsens` gallery, ordering
 * max+1) or `project_overrides.extra_gallery` (Modrinth gallery — ADR-0002 C10), then revalidates
 * `projects` + `project:<slug>`. U3: a re-PUT + re-commit of the same bytes returns the SAME entry,
 * no duplicate. T-ACT-73: a commit `path` for another project id → `forbidden`, object untouched;
 * every `begin` records exactly one `rate_limit_hits` row even when never committed.
 *
 * All action calls run as FACTORY admins (`callActionAs`) so the seed admin's
 * `upload:project-media` budget stays untouched for other files (setProjectLink precedent).
 * The Modrinth gallery test appends to the SEED `metal-pipe-mace` override row — snapshotted in
 * `beforeAll` and restored byte-for-byte in `afterAll` (05 H-1 `mutatesSeed`). Storage objects the
 * suite leaves behind are tracked and removed in `afterAll` (the pending ones are deleted by the
 * failed commits themselves — asserted). Crafted non-square / oversize PNGs come from sharp (no
 * such fixtures exist); they ride a raw `PUT` mirroring `putSigned`.
 */
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uploadProjectMedia } from '@/lib/actions/uploads';
import type { UploadProjectMediaInput } from '@/lib/actions/uploads.schema';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { sizeLimitMessage, typeMessage } from '@/lib/validation/files';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { clearRateLimitHits, countRateLimitHits } from '@/tests/helpers/arrange';
import { asRole, loose } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { cleanupFactories, makeProject, makeUser } from '@/tests/helpers/factories';
import { fixtureBytes } from '@/tests/helpers/fixtures';
import { SEED_PROJECTS } from '@/tests/helpers/seedIds';
import { spyRevalidateTag } from '@/tests/helpers/spies';
import { listObjects, putSigned, removeObjects } from '@/tests/helpers/storage';

setupActionMocks();

const service = asRole('service');

const SCOPE = 'upload:project-media';
const MACE = SEED_PROJECTS.metalPipeMace; // modrinth seed project (no SEED-6 override row)

let adminId = '';
/** A published `odsens` factory project shared by the begin-phase tests (begin writes nothing). */
let baseProjectId = '';
/** Final-path objects the successful commits leave behind (object paths, no bucket prefix). */
const leftoverObjects: string[] = [];
/** The seed project's `project_overrides` row as it stood before this file (null = no row). */
let maceOverrideSnapshot: Record<string, unknown> | null = null;

beforeAll(async () => {
  adminId = await makeUser({ role: 'admin' });
  baseProjectId = await makeProject();
  const { data, error } = await loose(service)
    .from('project_overrides')
    .select('*')
    .eq('project_id', MACE)
    .maybeSingle();
  if (error) throw new Error(`project_overrides snapshot failed: ${error.message}`);
  maceOverrideSnapshot = data;
});

afterAll(async () => {
  // Restore the seed project's override row byte-for-byte (05 H-1).
  if (maceOverrideSnapshot === null) {
    const { error } = await service.from('project_overrides').delete().eq('project_id', MACE);
    if (error) throw new Error(`project_overrides restore (delete) failed: ${error.message}`);
  } else {
    const { error } = await loose(service)
      .from('project_overrides')
      .upsert(maceOverrideSnapshot, { onConflict: 'project_id' });
    if (error) throw new Error(`project_overrides restore (upsert) failed: ${error.message}`);
  }
  await removeObjects('project-media', leftoverObjects);
  await clearRateLimitHits(SCOPE, adminId);
  await cleanupFactories();
});

// ---- local helpers ---------------------------------------------------------------------------

type MediaKind = 'icon' | 'gallery';
type MediaMime = 'image/png' | 'image/jpeg' | 'image/webp';
type BeginData = { path: string; token: string; signed_url: string };
type CommitData = { path: string; entry: unknown };
type GalleryEntry = Record<string, unknown> & { ordering?: number };

function beginInput(projectId: string, kind: MediaKind, mime: MediaMime): UploadProjectMediaInput {
  return {
    phase: 'begin',
    project_id: projectId,
    kind,
    filename: `pic.${mime.slice('image/'.length)}`,
    size_bytes: 2048,
    mime,
  };
}

/** `begin` as a factory admin; narrows to the `{path, token, signed_url}` arm. */
async function beginOk(
  projectId: string,
  kind: MediaKind,
  mime: MediaMime,
  profileId = adminId,
): Promise<BeginData> {
  const data = expectOk(
    await callActionAs(uploadProjectMedia, beginInput(projectId, kind, mime), { profileId }),
  );
  if (!('token' in data)) throw new Error('expected the begin {path, token, signed_url} payload');
  return data;
}

function commitMedia(
  projectId: string,
  kind: MediaKind,
  path: string,
  extra: { title?: string; description?: string } = {},
) {
  return callActionAs(
    uploadProjectMedia,
    { phase: 'commit', project_id: projectId, kind, path, ...extra },
    { profileId: adminId },
  );
}

function expectCommitOk(res: Awaited<ReturnType<typeof commitMedia>>): CommitData {
  const data = expectOk(res);
  if (!('entry' in data)) throw new Error('expected the commit {path, entry} payload');
  return data;
}

/** DB-stored paths are bucket-prefixed; the storage API wants the path inside the bucket. */
function objectPath(dbPath: string): string {
  return dbPath.replace(/^project-media\//, '');
}

/** First 16 hex of sha256 — the `{hash16}` segment of every final media path (04 SC-21). */
function hash16Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

/** A real PNG of arbitrary dimensions (no non-square / >1024 fixture exists). */
async function craftedPng(width: number, height: number): Promise<Uint8Array<ArrayBuffer>> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 24, g: 24, b: 24 } },
  })
    .png()
    .toBuffer();
  // Copy out of Node's pooled Buffer so the bytes own a plain ArrayBuffer (what `fetch` accepts).
  return new Uint8Array(buffer);
}

/** The browser PUT for crafted bytes — mirrors tests/helpers/storage.ts `putSigned`. */
async function putBytes(
  signedUrl: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
): Promise<Response> {
  return fetch(signedUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'x-upsert': 'false' },
    body: bytes,
  });
}

async function projectRow(projectId: string): Promise<{ slug: string; icon_url: string | null }> {
  const { data, error } = await service
    .from('projects')
    .select('slug, icon_url')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function galleryOf(projectId: string): Promise<GalleryEntry[]> {
  const { data, error } = await service
    .from('projects')
    .select('gallery')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  return Array.isArray(data.gallery) ? (data.gallery as GalleryEntry[]) : [];
}

async function extraGalleryOf(projectId: string): Promise<GalleryEntry[]> {
  const { data, error } = await service
    .from('project_overrides')
    .select('extra_gallery')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const json = data?.extra_gallery ?? [];
  return Array.isArray(json) ? (json as GalleryEntry[]) : [];
}

function maxOrdering(entries: GalleryEntry[]): number {
  let max = 0;
  for (const entry of entries) {
    if (typeof entry.ordering === 'number' && Number.isFinite(entry.ordering)) {
      max = Math.max(max, entry.ordering);
    }
  }
  return max;
}

// ---------------------------------------------------------------------------------------------
// T-ACT-38 — auth matrix (anon | user | banned | mod | admin): admin-only for EVERY kind/source
// ---------------------------------------------------------------------------------------------

describe('T-ACT-38 uploadProjectMedia auth matrix', () => {
  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // The seed banned account has role `user` — `requireRole`'s rank check fires (04 SC-04).
    { role: 'banned' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: uploads are admin-only; moderators get `forbidden`.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])('T-ACT-38 $role → $code', async ({ role, code, message }) => {
    const error = expectFail(
      await callAction(uploadProjectMedia, beginInput(randomUUID(), 'icon', 'image/png'), { role }),
      code,
    );
    expect(error.message).toBe(message);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-38 — begin: declared size/mime, the signed-upload payload, rate limit, icon source rule
// ---------------------------------------------------------------------------------------------

describe('T-ACT-38 begin', () => {
  it('T-ACT-38 begin size_bytes 5 242 881 → validation carrying "5 MB"', async () => {
    const error = expectFail(
      await callActionAs(
        uploadProjectMedia,
        { ...beginInput(baseProjectId, 'gallery', 'image/png'), size_bytes: 5_242_881 },
        { profileId: adminId },
      ),
      'validation',
    );
    expect(error.field).toBe('size_bytes');
    const messages = (error.issues ?? []).map((issue) => issue.message);
    expect(messages).toContain(sizeLimitMessage(5_242_881, 'project-media'));
    expect(messages.join(' ')).toContain('5 MB');
  });

  it('T-ACT-38 begin mime image/gif → validation (png/jpeg/webp only)', async () => {
    const input = {
      ...beginInput(baseProjectId, 'gallery', 'image/png'),
      mime: 'image/gif',
    } as unknown as UploadProjectMediaInput;
    const error = expectFail(
      await callActionAs(uploadProjectMedia, input, { profileId: adminId }),
      'validation',
    );
    expect(error.field).toBe('mime');
    expect((error.issues ?? []).map((issue) => issue.message)).toContain(
      typeMessage(null, 'project-media'),
    );
  });

  it.each([
    { kind: 'icon' as const, mime: 'image/png' as const, ext: 'png' },
    { kind: 'gallery' as const, mime: 'image/jpeg' as const, ext: 'jpg' },
    { kind: 'gallery' as const, mime: 'image/webp' as const, ext: 'webp' },
  ])(
    'T-ACT-38 begin $kind $mime → {path, token, signed_url}, no DB change',
    async ({ kind, mime, ext }) => {
      const data = await beginOk(baseProjectId, kind, mime);
      expect(data.path).toMatch(
        new RegExp(`^project-media/${baseProjectId}/${kind}/[0-9a-f-]{36}\\.${ext}$`),
      );
      expect(data.token.length).toBeGreaterThan(0);
      expect(data.signed_url).toContain(`/object/upload/sign/project-media/${baseProjectId}/`);
      // No DB row yet (04 §1.4.5: the object arrives at commit, not begin).
      const row = await projectRow(baseProjectId);
      expect(row.icon_url).toBeNull();
      expect(await galleryOf(baseProjectId)).toEqual([]);
    },
  );

  it('T-ACT-38 61st begin in an hour → rate_limited (60 / hour / user)', async () => {
    const burner = await makeUser({ role: 'admin' });
    // 60 hits arranged directly in `rate_limit_hits` — the only table `rate_limit_ok` counts.
    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 60 }, () => ({ scope: SCOPE, key: burner })));
    expect(error).toBeNull();

    const limited = expectFail(
      await callActionAs(uploadProjectMedia, beginInput(baseProjectId, 'gallery', 'image/png'), {
        profileId: burner,
      }),
      'rate_limited',
    );
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
    // The rejected call still recorded its own hit (ADR-0002 A4).
    expect(await countRateLimitHits(SCOPE, burner)).toBe(61);
    await clearRateLimitHits(SCOPE, burner);
  });

  it('T-ACT-38 icon begin on a Modrinth project → forbidden (icons are sync-owned; commit refuses too)', async () => {
    const error = expectFail(
      await callActionAs(uploadProjectMedia, beginInput(MACE, 'icon', 'image/png'), {
        profileId: adminId,
      }),
      'forbidden',
    );
    expect(error.message).toBe('Synced projects keep their icon on Modrinth.');
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-38 — commit: byte re-validation failures DELETE the pending object (04 §1.4.5, SC-19)
// ---------------------------------------------------------------------------------------------

describe('T-ACT-38 commit — re-validation deletes the object', () => {
  it('T-ACT-38 commit bad.svg bytes → validation and the object is deleted', async () => {
    const projectId = await makeProject();
    const begin = await beginOk(projectId, 'gallery', 'image/png');
    // A hostile client declares png at begin and PUTs svg bytes labelled image/png (the bucket's
    // allowed_mime_types would refuse an honest image/svg+xml PUT).
    const put = await putSigned(begin.signed_url, begin.token, 'images/bad.svg', {
      contentType: 'image/png',
    });
    expect(put.status).toBe(200);

    const error = expectFail(await commitMedia(projectId, 'gallery', begin.path), 'validation');
    expect(error.message).toBe(typeMessage('svg', 'project-media'));
    expect(await listObjects('project-media', `${projectId}/gallery`)).not.toContain(
      objectPath(begin.path),
    );
  });

  it('T-ACT-38 commit icon 128×64 (non-square) → validation and the object is deleted', async () => {
    const projectId = await makeProject();
    const begin = await beginOk(projectId, 'icon', 'image/png');
    const put = await putBytes(begin.signed_url, await craftedPng(128, 64), 'image/png');
    expect(put.status).toBe(200);

    const error = expectFail(await commitMedia(projectId, 'icon', begin.path), 'validation');
    expect(error.message).toBe("That's 128×64. Icons are square, 64 to 1024 pixels.");
    expect(await listObjects('project-media', `${projectId}/icon`)).not.toContain(
      objectPath(begin.path),
    );
  });

  it('T-ACT-38 commit icon 1200×1200 (> 1024 px) → validation and the object is deleted', async () => {
    const projectId = await makeProject();
    const begin = await beginOk(projectId, 'icon', 'image/png');
    const put = await putBytes(begin.signed_url, await craftedPng(1200, 1200), 'image/png');
    expect(put.status).toBe(200);

    const error = expectFail(await commitMedia(projectId, 'icon', begin.path), 'validation');
    expect(error.message).toBe("That's 1200×1200. Icons are square, 64 to 1024 pixels.");
    expect(await listObjects('project-media', `${projectId}/icon`)).not.toContain(
      objectPath(begin.path),
    );
  });

  it('T-ACT-38 commit gallery 1×1 (< 320 px wide) → validation and the object is deleted', async () => {
    const projectId = await makeProject();
    const begin = await beginOk(projectId, 'gallery', 'image/webp');
    const put = await putSigned(begin.signed_url, begin.token, 'images/tiny.webp');
    expect(put.status).toBe(200);

    const error = expectFail(await commitMedia(projectId, 'gallery', begin.path), 'validation');
    expect(error.message).toBe(
      "That's 1×1. Gallery images are 320 to 4096 pixels wide, 4096 tall.",
    );
    expect(await listObjects('project-media', `${projectId}/gallery`)).not.toContain(
      objectPath(begin.path),
    );
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-38 — commit: success paths (icon → icon_url; gallery → projects.gallery /
// project_overrides.extra_gallery; U3 idempotency; revalidation)
// ---------------------------------------------------------------------------------------------

describe('T-ACT-38 commit — success', () => {
  it('T-ACT-38 icon on an odsens project → object moved to {hash16}, icon_url set, revalidates projects + project:<slug>', async () => {
    const projectId = await makeProject();
    const { slug } = await projectRow(projectId);
    const begin = await beginOk(projectId, 'icon', 'image/png');
    const put = await putSigned(begin.signed_url, begin.token, 'images/icon-256.png');
    expect(put.status).toBe(200);

    const bytes = await fixtureBytes('images', 'icon-256.png');
    const finalPath = `project-media/${projectId}/icon/${hash16Of(bytes)}.png`;
    const tags = spyRevalidateTag();

    const data = expectCommitOk(await commitMedia(projectId, 'icon', begin.path));
    expect(data.path).toBe(finalPath);
    expect(data.entry).toEqual({ url: finalPath });

    // Moved, not copied: the final object exists, the pending one is gone (service list).
    const objects = await listObjects('project-media', `${projectId}/icon`);
    expect(objects).toContain(objectPath(finalPath));
    expect(objects).not.toContain(objectPath(begin.path));
    leftoverObjects.push(objectPath(finalPath));

    expect((await projectRow(projectId)).icon_url).toBe(finalPath);
    expect(tags.calls).toEqual(['projects', `project:${slug}`]);
  });

  it('T-ACT-38 gallery on an odsens project → projects.gallery appended with ordering max+1', async () => {
    // A pre-existing entry at ordering 4 proves max+1 (not count+1, not always 1).
    const projectId = await makeProject({
      gallery: [
        {
          url: 'project-media/already/gallery/prior.png',
          title: null,
          description: null,
          ordering: 4,
          featured: true,
        },
      ],
    });
    const begin = await beginOk(projectId, 'gallery', 'image/png');
    const put = await putSigned(begin.signed_url, begin.token, 'images/avatar-600.png');
    expect(put.status).toBe(200);

    const bytes = await fixtureBytes('images', 'avatar-600.png');
    const finalPath = `project-media/${projectId}/gallery/${hash16Of(bytes)}.png`;

    const data = expectCommitOk(
      await commitMedia(projectId, 'gallery', begin.path, { title: 'Workbench shot' }),
    );
    expect(data.path).toBe(finalPath);
    expect(data.entry).toEqual({
      url: finalPath,
      title: 'Workbench shot',
      description: null,
      ordering: 5,
      featured: false,
    });
    leftoverObjects.push(objectPath(finalPath));

    const gallery = await galleryOf(projectId);
    expect(gallery).toHaveLength(2);
    expect(gallery[1]).toEqual(data.entry);
  });

  it('T-ACT-38 gallery on the Modrinth seed project → project_overrides.extra_gallery appended (ADR-0002 C10)', async () => {
    const before = await extraGalleryOf(MACE);
    const expectedOrdering = maxOrdering(before) + 1;
    const { slug } = await projectRow(MACE);

    const begin = await beginOk(MACE, 'gallery', 'image/png');
    const put = await putSigned(begin.signed_url, begin.token, 'images/avatar-600.png');
    expect(put.status).toBe(200);

    const bytes = await fixtureBytes('images', 'avatar-600.png');
    const finalPath = `project-media/${MACE}/gallery/${hash16Of(bytes)}.png`;
    const tags = spyRevalidateTag();

    const data = expectCommitOk(await commitMedia(MACE, 'gallery', begin.path));
    expect(data.path).toBe(finalPath);
    // The synced-project entry shape keys on `path` (no `featured` — ADR-0002 C10).
    expect(data.entry).toEqual({
      path: finalPath,
      title: null,
      description: null,
      ordering: expectedOrdering,
    });
    leftoverObjects.push(objectPath(finalPath));

    const after = await extraGalleryOf(MACE);
    expect(after).toHaveLength(before.length + 1);
    expect(after[after.length - 1]).toEqual(data.entry);
    expect(tags.calls).toEqual(['projects', `project:${slug}`]);
  });

  it('T-ACT-38 commit twice on the same path → the SAME entry back, no duplicate gallery row (U3)', async () => {
    const projectId = await makeProject();
    const begin = await beginOk(projectId, 'gallery', 'image/png');
    const firstPut = await putSigned(begin.signed_url, begin.token, 'images/avatar-600.png');
    expect(firstPut.status).toBe(200);

    const first = expectCommitOk(await commitMedia(projectId, 'gallery', begin.path));
    leftoverObjects.push(objectPath(first.path));

    // The browser retries: same bytes re-PUT to the same signed path, then commit again.
    const rePut = await putSigned(begin.signed_url, begin.token, 'images/avatar-600.png');
    expect(rePut.status).toBe(200);
    const second = expectCommitOk(await commitMedia(projectId, 'gallery', begin.path));

    expect(second).toEqual(first);
    expect(await galleryOf(projectId)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------------------------
// T-ACT-73 — uploads common (media half): foreign-path commit, begin's rate_limit_hits row
// ---------------------------------------------------------------------------------------------

describe('T-ACT-73 uploads — common (media half)', () => {
  it("T-ACT-73 commit with a path for another project id → forbidden, the object isn't touched", async () => {
    const owner = await makeProject();
    const other = await makeProject();
    const begin = await beginOk(owner, 'gallery', 'image/png');
    const put = await putSigned(begin.signed_url, begin.token, 'images/avatar-600.png');
    expect(put.status).toBe(200);

    const error = expectFail(await commitMedia(other, 'gallery', begin.path), 'forbidden');
    expect(error.message).toBe("That path isn't this project's.");

    // The object still sits at the owner's pending path (INV-53: refused BEFORE Storage is touched).
    expect(await listObjects('project-media', `${owner}/gallery`)).toContain(
      objectPath(begin.path),
    );
    leftoverObjects.push(objectPath(begin.path));
  });

  it('T-ACT-73 begin inserts one rate_limit_hits row even when never committed', async () => {
    const burner = await makeUser({ role: 'admin' });
    expect(await countRateLimitHits(SCOPE, burner)).toBe(0);
    await beginOk(baseProjectId, 'gallery', 'image/png', burner);
    // One row for the begin (U2) — and no commit ever happens for this path.
    expect(await countRateLimitHits(SCOPE, burner)).toBe(1);
    await clearRateLimitHits(SCOPE, burner);
  });
});
