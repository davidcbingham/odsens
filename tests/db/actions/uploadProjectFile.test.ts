/**
 * tests/db/actions/uploadProjectFile.test.ts — T-ACT-39 + the `project-files` half of T-ACT-73
 * (05 §7.2; 04 §1.4 `uploadProjectFile`, §1.4.5 two-phase signed uploads, SC-19/SC-20/SC-21;
 * 01 INV-51/52/53; ADR-0002 C7 / C16; ADR-0026 exclusive-version identity).
 *
 * Auth matrix: anon `unauthenticated` · user D `forbidden` · banned D `forbidden` (the seed banned
 * account has role `user`, so `requireRole`'s rank check answers) · mod D `forbidden` (admin-only,
 * ADR-0002 C7) · admin A. The synced seed project (SEED_PROJECTS.metalPipeMace, read-only) answers
 * `forbidden` on BOTH phases — synced files live on Modrinth (04 §1.4).
 *
 * `begin` validates the DECLARED ext/size/version_number in the schema (no rate-limit budget burned),
 * returns `project-files/<pid>/<version uuid>/<sanitized filename>` with NO DB row — reusing the id
 * of an existing `(project_id, version_number, external_id NULL)` version — and records one
 * `rate_limit_hits` row per call even without a commit (T-ACT-73 U2); the 31st in an hour is
 * `rate_limited` (hits arranged directly in `rate_limit_hits` on a factory admin — the only table
 * `rate_limit_ok` counts, ADR-0002 A4 — cleared in afterEach). `commit` re-validates magic bytes
 * (PNG bytes under a `.jar` name → `validation` + object deleted), upserts the version
 * (`external_id` NULL) with the commit's fields and writes the `project_files` row (first file
 * primary; `primary:true` demotes siblings; same path + same bytes → the existing row, U3; same
 * filename + different bytes → `conflict`), refuses a crafted path naming ANOTHER project's version
 * id without touching the object (T-ACT-73 / INV-53) and never deletes a committed object on a later
 * failed commit at a different path (T-ACT-73 U1). Success rows run on factory projects only; their
 * objects are removed in afterAll (05 H-1).
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uploadProjectFile } from '@/lib/actions/uploads';
import type {
  UploadProjectFileBeginInput,
  UploadProjectFileCommitInput,
} from '@/lib/actions/uploads.schema';
import { RATE_LIMITED_MESSAGE } from '@/lib/rate-limit';
import { expectFail, expectOk } from '@/tests/helpers/actionResult';
import { clearRateLimitHits, countRateLimitHits } from '@/tests/helpers/arrange';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, callActionAs, setupActionMocks } from '@/tests/helpers/callAction';
import { cleanupFactories, makeProject, makeUser, makeVersion } from '@/tests/helpers/factories';
import { fixturePath } from '@/tests/helpers/fixtures';
import { SEED_PROJECTS } from '@/tests/helpers/seedIds';
import { putSigned, removeObjects, uploadFixture } from '@/tests/helpers/storage';
import { spyRevalidateTag } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const SCOPE = 'upload:project-files';
const BUCKET = 'project-files';
const FILES_PREFIX = `${BUCKET}/`;
const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The fixtures, read once: real sizes + the known sha512 of pack.zip (T-ACT-39 "128 hex"). */
const PACK_ZIP = new Uint8Array(readFileSync(fixturePath('files', 'pack.zip')));
const PACK_ZIP_SHA512 = createHash('sha512').update(PACK_ZIP).digest('hex');
const PNG_AS_JAR = new Uint8Array(readFileSync(fixturePath('files', 'png-as.jar')));

// Shared story state (a single file runs sequentially; commits build on earlier commits).
let exclusiveId = '';
let slug = '';
let storyVersionId = '';
let storyPath = '';
let storyFileId = '';
let storySignedUrl = '';
let storyToken = '';

/** Factory-admin ids whose `upload:project-files` hits the current test arranged (afterEach clears). */
const burnerKeys: string[] = [];
/** Object paths (no bucket prefix) this file PUT into `project-files` (afterAll removes them). */
const objectPaths: string[] = [];

type BeginData = { path: string; token: string; signed_url: string };
type CommitData = {
  version_id: string;
  file: { id: string; filename: string; size_bytes: number; sha512: string };
};
type VersionRow = {
  id: string;
  version_number: string;
  external_id: string | null;
  name: string | null;
  changelog_md: string | null;
  game_versions: string[];
  loaders: string[];
  version_type: 'release' | 'beta' | 'alpha';
};
type FileRow = {
  id: string;
  filename: string;
  size_bytes: number;
  sha512: string | null;
  url: string | null;
  storage_path: string | null;
  primary: boolean;
  download_count: number;
};

function beginInput(
  projectId: string,
  overrides: Partial<UploadProjectFileBeginInput> = {},
): UploadProjectFileBeginInput {
  return {
    phase: 'begin',
    project_id: projectId,
    version_number: '1.0.0',
    filename: 'pack.zip',
    size_bytes: PACK_ZIP.byteLength,
    ...overrides,
  };
}

function versionFields(versionNumber: string): UploadProjectFileCommitInput['version'] {
  return {
    version_number: versionNumber,
    name: 'First release',
    changelog_md: '- initial drop',
    game_versions: ['1.21.4'],
    loaders: ['datapack'],
    version_type: 'release',
  };
}

function commitInput(
  projectId: string,
  path: string,
  options: { versionNumber?: string; primary?: boolean } = {},
): UploadProjectFileCommitInput {
  const input: UploadProjectFileCommitInput = {
    phase: 'commit',
    project_id: projectId,
    path,
    version: versionFields(options.versionNumber ?? '1.0.0'),
  };
  if (options.primary !== undefined) input.primary = options.primary;
  return input;
}

async function beginAsAdmin(input: UploadProjectFileBeginInput): Promise<BeginData> {
  const data = expectOk(await callAction(uploadProjectFile, input, { role: 'admin' }));
  if (!('signed_url' in data))
    throw new Error('expected the begin {path, token, signed_url} payload');
  return data;
}

async function commitAsAdmin(input: UploadProjectFileCommitInput): Promise<CommitData> {
  const data = expectOk(await callAction(uploadProjectFile, input, { role: 'admin' }));
  if (!('file' in data)) throw new Error('expected the commit {version_id, file} payload');
  return data;
}

/** DB-stored paths are bucket-prefixed (SC-21); the storage API wants the path inside the bucket. */
function objectPathOf(dbPath: string): string {
  if (!dbPath.startsWith(FILES_PREFIX)) throw new Error(`not a ${BUCKET} path: ${dbPath}`);
  return dbPath.slice(FILES_PREFIX.length);
}

function trackObject(dbPath: string): void {
  objectPaths.push(objectPathOf(dbPath));
}

/** The `{version_id}` segment of a begin-returned path. */
function versionIdIn(path: string): string {
  const match = new RegExp(`^${FILES_PREFIX}${UUID_SEGMENT}/(${UUID_SEGMENT})/[^/]+$`).exec(path);
  const id = match?.[1];
  if (id === undefined) throw new Error(`unexpected file path shape: ${path}`);
  return id;
}

async function objectExists(dbPath: string): Promise<boolean> {
  const { data, error } = await service.storage.from(BUCKET).download(objectPathOf(dbPath));
  return error === null && data !== null;
}

async function slugOf(projectId: string): Promise<string> {
  const { data, error } = await service
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  return data.slug;
}

async function versionRows(projectId: string): Promise<VersionRow[]> {
  const { data, error } = await service
    .from('project_versions')
    .select(
      'id, version_number, external_id, name, changelog_md, game_versions, loaders, version_type',
    )
    .eq('project_id', projectId)
    .order('version_number');
  if (error) throw new Error(error.message);
  return data;
}

async function fileRows(versionId: string): Promise<FileRow[]> {
  const { data, error } = await service
    .from('project_files')
    .select('id, filename, size_bytes, sha512, url, storage_path, primary, download_count')
    .eq('version_id', versionId)
    .order('filename');
  if (error) throw new Error(error.message);
  return data;
}

beforeAll(async () => {
  // Keep repeated local runs deterministic — earlier runs' begins would otherwise count into
  // this hour's 30-per-user budget for the seed admin.
  await clearRateLimitHits(SCOPE, SEED_ROLE_IDS.admin);
  exclusiveId = await makeProject({ source: 'odsens' });
  slug = await slugOf(exclusiveId);
});

afterEach(async () => {
  for (const key of burnerKeys.splice(0, burnerKeys.length)) {
    await clearRateLimitHits(SCOPE, key);
  }
});

afterAll(async () => {
  await removeObjects(BUCKET, objectPaths);
  await clearRateLimitHits(SCOPE, SEED_ROLE_IDS.admin);
  await cleanupFactories();
});

describe('T-ACT-39 uploadProjectFile', () => {
  // ---- auth matrix (anon | user | banned | mod — admin is the allowed row) --------------------

  it.each([
    { role: 'anon' as const, code: 'unauthenticated' as const, message: 'Sign in first.' },
    { role: 'user' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // The seed banned account has role `user` — `requireRole`'s rank check fires (04 SC-04).
    { role: 'banned' as const, code: 'forbidden' as const, message: 'Not allowed.' },
    // ADR-0002 C7: uploads are admin-only; moderators get `forbidden`.
    { role: 'mod' as const, code: 'forbidden' as const, message: 'Not allowed.' },
  ])('T-ACT-39 $role → $code, no rate-limit hit recorded', async ({ role, code, message }) => {
    const error = expectFail(
      await callAction(uploadProjectFile, beginInput(randomUUID()), { role }),
      code,
    );
    expect(error.message).toBe(message);
    if (role !== 'anon') {
      // The limiter sits after `requireRole` — a refused caller burns no budget.
      expect(await countRateLimitHits(SCOPE, SEED_ROLE_IDS[role])).toBe(0);
    }
  });

  it('T-ACT-39 synced seed project → forbidden on begin AND commit (files live on Modrinth)', async () => {
    // The denied row provably exists (seed, read-only) and is synced.
    const { data: seedRow, error } = await service
      .from('projects')
      .select('id, source')
      .eq('id', SEED_PROJECTS.metalPipeMace)
      .single();
    expect(error).toBeNull();
    expect(seedRow).toMatchObject({ id: SEED_PROJECTS.metalPipeMace, source: 'modrinth' });

    const begin = expectFail(
      await callAction(uploadProjectFile, beginInput(SEED_PROJECTS.metalPipeMace), {
        role: 'admin',
      }),
      'forbidden',
    );
    expect(begin.message).toBe('Synced projects keep their files on Modrinth.');

    const commit = expectFail(
      await callAction(
        uploadProjectFile,
        commitInput(
          SEED_PROJECTS.metalPipeMace,
          `project-files/${SEED_PROJECTS.metalPipeMace}/${randomUUID()}/pack.zip`,
        ),
        { role: 'admin' },
      ),
      'forbidden',
    );
    expect(commit.message).toBe('Synced projects keep their files on Modrinth.');
    // The project check precedes the limiter — neither refused phase burned budget.
    expect(await countRateLimitHits(SCOPE, SEED_ROLE_IDS.admin)).toBe(0);
  });

  // ---- begin: declared-value validation (schema — lib/actions/uploads.schema.ts) --------------

  it.each<{
    name: string;
    overrides: Partial<UploadProjectFileBeginInput>;
    issue: string;
    field: string;
  }>([
    {
      name: "filename 'bad.exe' (ext outside jar/zip/mrpack)",
      overrides: { filename: 'bad.exe' },
      issue: "That's a .exe. Allowed: .jar .zip .mrpack",
      field: 'filename',
    },
    {
      name: 'size_bytes 104 857 601 (> 100 MB)',
      overrides: { size_bytes: 104857601 },
      issue: '100 MB',
      field: 'size_bytes',
    },
    {
      name: "version_number 'not a version!' (outside the grammar)",
      overrides: { version_number: 'not a version!' },
      issue: 'Version numbers use letters, numbers and . - + _ (up to 32).',
      field: 'version_number',
    },
    {
      name: 'version_number 33 chars',
      overrides: { version_number: 'v'.repeat(33) },
      issue: 'Version numbers use letters, numbers and . - + _ (up to 32).',
      field: 'version_number',
    },
  ])('T-ACT-39 begin $name → validation', async ({ overrides, issue, field }) => {
    const error = expectFail(
      await callAction(uploadProjectFile, beginInput(randomUUID(), overrides), { role: 'admin' }),
      'validation',
    );
    expect(error.field).toBe(field);
    expect((error.issues ?? []).map((i) => i.message).join(' ')).toContain(issue);
    // Schema failures never reach the limiter.
    expect(await countRateLimitHits(SCOPE, SEED_ROLE_IDS.admin)).toBe(0);
  });

  // ---- begin: success (server-generated path, no DB row) --------------------------------------

  it('T-ACT-39 begin → {path, token, signed_url}, sanitized filename under a fresh version uuid, no DB row yet', async () => {
    const projectId = await makeProject({ source: 'odsens' });
    const data = await beginAsAdmin(
      beginInput(projectId, { filename: 'My Pack v1.ZIP', size_bytes: 1024 }),
    );
    // SC-20: spaces dropped, extension lowercased; SC-21: bucket-prefixed path, uuid version segment.
    expect(data.path).toMatch(
      new RegExp(`^project-files/${projectId}/${UUID_SEGMENT}/MyPackv1\\.zip$`),
    );
    expect(data.token.length).toBeGreaterThan(0);
    expect(data.signed_url).toContain(`project-files/${projectId}/`);
    expect(data.signed_url).toContain('token=');
    // No version (and so no file) row exists until commit.
    expect(await versionRows(projectId)).toEqual([]);
  });

  it('T-ACT-39 begin reuses the existing (project_id, version_number, external_id NULL) version id in the path', async () => {
    const projectId = await makeProject({ source: 'odsens' });
    const versionId = await makeVersion({
      project_id: projectId,
      external_id: null,
      version_number: '2.0.0',
    });
    const data = await beginAsAdmin(
      beginInput(projectId, { version_number: '2.0.0', filename: 'thing.mrpack', size_bytes: 100 }),
    );
    expect(data.path).toBe(`project-files/${projectId}/${versionId}/thing.mrpack`);
    // Still exactly the arranged version — begin writes nothing.
    expect((await versionRows(projectId)).map((row) => row.id)).toEqual([versionId]);
    expect(await fileRows(versionId)).toEqual([]);
  });

  it('T-ACT-73 begin records a rate_limit_hits row even without a commit', async () => {
    const recorder = await makeUser({ role: 'admin' });
    burnerKeys.push(recorder);
    const projectId = await makeProject({ source: 'odsens' });
    expect(await countRateLimitHits(SCOPE, recorder)).toBe(0);

    expectOk(await callActionAs(uploadProjectFile, beginInput(projectId), { profileId: recorder }));

    // One hit on the books; the upload is never committed and no rows appeared.
    expect(await countRateLimitHits(SCOPE, recorder)).toBe(1);
    expect(await versionRows(projectId)).toEqual([]);
  });

  it('T-ACT-39 31st begin in an hour → rate_limited (30 / hour / user)', async () => {
    const burner = await makeUser({ role: 'admin' });
    burnerKeys.push(burner);
    // 30 hits arranged directly in `rate_limit_hits` — the only table `rate_limit_ok` counts.
    const { error } = await service
      .from('rate_limit_hits')
      .insert(Array.from({ length: 30 }, () => ({ scope: SCOPE, key: burner })));
    expect(error).toBeNull();

    const limited = expectFail(
      await callActionAs(uploadProjectFile, beginInput(exclusiveId), { profileId: burner }),
      'rate_limited',
    );
    expect(limited.message).toBe(RATE_LIMITED_MESSAGE);
    // The rejected call still recorded its own hit (ADR-0002 A4).
    expect(await countRateLimitHits(SCOPE, burner)).toBe(31);
  });

  // ---- commit: begin → putSigned → commit (04 §1.4.5) -----------------------------------------

  it('T-ACT-39 commit of PNG bytes at a .jar path → validation (magic bytes) and the object is deleted', async () => {
    const begin = await beginAsAdmin(
      beginInput(exclusiveId, {
        filename: 'evil.jar',
        version_number: '0.9.0',
        size_bytes: PNG_AS_JAR.byteLength,
      }),
    );
    trackObject(begin.path);
    const put = await putSigned(begin.signed_url, begin.token, 'files/png-as.jar');
    expect(put.ok).toBe(true);

    const error = expectFail(
      await callAction(
        uploadProjectFile,
        commitInput(exclusiveId, begin.path, { versionNumber: '0.9.0' }),
        { role: 'admin' },
      ),
      'validation',
    );
    expect(error.message).toBe("That's a .png. Allowed: .jar .zip .mrpack");
    // SC-19: the failed object is removed; validation precedes the version upsert.
    expect(await objectExists(begin.path)).toBe(false);
    expect((await versionRows(exclusiveId)).map((row) => row.version_number)).not.toContain(
      '0.9.0',
    );
  });

  it('T-ACT-39 commit pack.zip → version upserted (external_id NULL) + project_files row, first file primary, revalidates projects + project:<slug>', async () => {
    const begin = await beginAsAdmin(beginInput(exclusiveId));
    storyPath = begin.path;
    storyVersionId = versionIdIn(begin.path);
    storySignedUrl = begin.signed_url;
    storyToken = begin.token;
    trackObject(begin.path);
    const put = await putSigned(begin.signed_url, begin.token, 'files/pack.zip');
    expect(put.ok).toBe(true);

    const tags = spyRevalidateTag();
    const data = await commitAsAdmin(commitInput(exclusiveId, storyPath));
    expect(data.version_id).toBe(storyVersionId);
    expect(data.file.filename).toBe('pack.zip');
    expect(data.file.size_bytes).toBe(PACK_ZIP.byteLength);
    expect(data.file.sha512).toMatch(/^[0-9a-f]{128}$/);
    expect(data.file.sha512).toBe(PACK_ZIP_SHA512);
    storyFileId = data.file.id;

    // The version carries the commit's fields, exclusive identity (external_id NULL — ADR-0026).
    expect(await versionRows(exclusiveId)).toEqual([
      expect.objectContaining({
        id: storyVersionId,
        external_id: null,
        version_number: '1.0.0',
        name: 'First release',
        changelog_md: '- initial drop',
        game_versions: ['1.21.4'],
        loaders: ['datapack'],
        version_type: 'release',
      }),
    ]);
    // The file row, exactly as T-ACT-39 spells it (first file of the version → primary).
    expect(await fileRows(storyVersionId)).toEqual([
      {
        id: storyFileId,
        filename: 'pack.zip',
        size_bytes: PACK_ZIP.byteLength,
        sha512: PACK_ZIP_SHA512,
        url: null,
        storage_path: storyPath,
        primary: true,
        download_count: 0,
      },
    ]);
    expect(tags.calls).toEqual(['projects', `project:${slug}`]);
  });

  it('T-ACT-39 a second file with primary:true demotes the first — exactly one primary per version', async () => {
    const begin = await beginAsAdmin(beginInput(exclusiveId, { filename: 'addon.zip' }));
    expect(begin.path).toBe(`project-files/${exclusiveId}/${storyVersionId}/addon.zip`);
    trackObject(begin.path);
    const put = await putSigned(begin.signed_url, begin.token, 'files/pack.zip');
    expect(put.ok).toBe(true);

    const data = await commitAsAdmin(commitInput(exclusiveId, begin.path, { primary: true }));
    expect(data.version_id).toBe(storyVersionId);

    const files = await fileRows(storyVersionId);
    expect(files.map((file) => [file.filename, file.primary])).toEqual([
      ['addon.zip', true],
      ['pack.zip', false],
    ]);
    expect(files.filter((file) => file.primary)).toHaveLength(1);
  });

  it('T-ACT-39 commit twice on the same path with the same bytes (re-PUT then commit) → ok with the existing row id', async () => {
    // A retried client re-PUTs on the FIRST begin's signed URL and commits again (a fresh begin on
    // a committed path is refused by storage — the object already exists at the one
    // `createSignedUploadUrl` site, INV-51). The committed object still sits at the path and the
    // PUT carries `x-upsert: false`, so storage declines the overwrite — the same bytes remain.
    await putSigned(storySignedUrl, storyToken, 'files/pack.zip');

    const data = await commitAsAdmin(commitInput(exclusiveId, storyPath));
    expect(data.file.id).toBe(storyFileId);
    expect(data.file.sha512).toBe(PACK_ZIP_SHA512);
    // No duplicate row appeared.
    expect(await fileRows(storyVersionId)).toHaveLength(2);
  });

  it('T-ACT-39 same filename, different bytes in the version → conflict (filename unique within version)', async () => {
    // Different-but-valid zip bytes at the same object path (a trailing byte keeps the ZIP magic).
    const altered = new Uint8Array(PACK_ZIP.byteLength + 1);
    altered.set(PACK_ZIP);
    altered[PACK_ZIP.byteLength] = 0x21;
    const { error: uploadError } = await service.storage
      .from(BUCKET)
      .upload(objectPathOf(storyPath), altered, { contentType: 'application/zip', upsert: true });
    expect(uploadError).toBeNull();

    const error = expectFail(
      await callAction(uploadProjectFile, commitInput(exclusiveId, storyPath), { role: 'admin' }),
      'conflict',
    );
    expect(error.message).toBe('A file with that name already exists in this version.');
    expect(error.field).toBe('filename');

    // The committed row is untouched; restore the committed bytes for the T-ACT-73 cells below.
    const pack = (await fileRows(storyVersionId)).find((file) => file.filename === 'pack.zip');
    expect(pack?.sha512).toBe(PACK_ZIP_SHA512);
    await uploadFixture(BUCKET, objectPathOf(storyPath), 'files/pack.zip', {
      contentType: 'application/zip',
    });
  });

  // ---- commit validation shape (04 SC-02 plain issues) + optional version fields ----------------

  it('T-ACT-39 commit without `version` → validation with the plain "Required." issue (never a zod internal)', async () => {
    const input = {
      phase: 'commit',
      project_id: exclusiveId,
      path: `project-files/${exclusiveId}/${randomUUID()}/pack.zip`,
    } as unknown as UploadProjectFileCommitInput;
    const error = expectFail(
      await callAction(uploadProjectFile, input, { role: 'admin' }),
      'validation',
    );
    expect(error.issues).toContainEqual({ path: 'version', message: 'Required.' });
    for (const issue of error.issues ?? [])
      expect(issue.message).not.toMatch(/invalid_type|expected/i);
  });

  it('T-ACT-39 commit with primary:"yes" → validation "Check this field." on primary', async () => {
    const input = {
      ...commitInput(exclusiveId, `project-files/${exclusiveId}/${randomUUID()}/pack.zip`),
      primary: 'yes',
    } as unknown as UploadProjectFileCommitInput;
    const error = expectFail(
      await callAction(uploadProjectFile, input, { role: 'admin' }),
      'validation',
    );
    expect(error.issues).toContainEqual({ path: 'primary', message: 'Check this field.' });
  });

  it('T-ACT-39 version name/changelog omitted → NULL on insert; a later commit into the same version updates type + date_published', async () => {
    const projectId = await makeProject({ source: 'odsens' });
    const bare: UploadProjectFileCommitInput['version'] = {
      version_number: '2.0.0',
      game_versions: ['1.21.4'],
      loaders: ['datapack'],
      version_type: 'beta',
    };

    const first = await beginAsAdmin(beginInput(projectId, { version_number: '2.0.0' }));
    trackObject(first.path);
    expect((await putSigned(first.signed_url, first.token, 'files/pack.zip')).ok).toBe(true);
    const committed = await commitAsAdmin({
      phase: 'commit',
      project_id: projectId,
      path: first.path,
      version: bare,
    });
    expect(await versionRows(projectId)).toEqual([
      expect.objectContaining({
        id: committed.version_id,
        name: null,
        changelog_md: null,
        version_type: 'beta',
      }),
    ]);

    // Same version, second file: the metadata upsert takes the update path this time.
    const second = await beginAsAdmin(
      beginInput(projectId, { version_number: '2.0.0', filename: 'extra.zip' }),
    );
    expect(second.path).toBe(`project-files/${projectId}/${committed.version_id}/extra.zip`);
    trackObject(second.path);
    expect((await putSigned(second.signed_url, second.token, 'files/pack.zip')).ok).toBe(true);
    const again = await commitAsAdmin({
      phase: 'commit',
      project_id: projectId,
      path: second.path,
      version: { ...bare, version_type: 'release', date_published: '2026-01-02T03:04:05.000Z' },
    });
    expect(again.version_id).toBe(committed.version_id);
    const { data: row, error } = await service
      .from('project_versions')
      .select('name, changelog_md, version_type, date_published')
      .eq('id', committed.version_id)
      .single();
    expect(error).toBeNull();
    expect(row?.name).toBeNull();
    expect(row?.changelog_md).toBeNull();
    expect(row?.version_type).toBe('release');
    expect(new Date(row?.date_published ?? '').toISOString()).toBe('2026-01-02T03:04:05.000Z');
    // The first file stays primary; the second joins as a sibling.
    expect((await fileRows(committed.version_id)).map((f) => [f.filename, f.primary])).toEqual([
      ['extra.zip', false],
      ['pack.zip', true],
    ]);
  });

  // ---- T-ACT-73 upload commons (04 §1.4.5 U1/U3; 01 INV-53) -----------------------------------

  it("T-ACT-73 commit with a crafted path naming ANOTHER project's version id → forbidden, object untouched", async () => {
    const otherProject = await makeProject({ source: 'odsens' });
    const otherVersion = await makeVersion({ project_id: otherProject, external_id: null });
    // Well-formed for the CALLER's project prefix, but the embedded version id belongs elsewhere.
    const crafted = `project-files/${exclusiveId}/${otherVersion}/pack.zip`;
    await uploadFixture(BUCKET, objectPathOf(crafted), 'files/pack.zip', {
      contentType: 'application/zip',
    });
    trackObject(crafted);

    const error = expectFail(
      await callAction(uploadProjectFile, commitInput(exclusiveId, crafted), { role: 'admin' }),
      'forbidden',
    );
    expect(error.message).toBe("That path isn't this project's.");
    expect(await objectExists(crafted)).toBe(true);

    // A path under another project's prefix is refused at the parse step (same copy).
    const foreign = expectFail(
      await callAction(
        uploadProjectFile,
        commitInput(exclusiveId, `project-files/${otherProject}/${randomUUID()}/pack.zip`),
        { role: 'admin' },
      ),
      'forbidden',
    );
    expect(foreign.message).toBe("That path isn't this project's.");
  });

  it('T-ACT-73 a committed object is never deleted by a later failed commit on a different path', async () => {
    expect(await objectExists(storyPath)).toBe(true);

    const begin = await beginAsAdmin(
      beginInput(exclusiveId, { filename: 'oops.jar', size_bytes: PNG_AS_JAR.byteLength }),
    );
    trackObject(begin.path);
    const put = await putSigned(begin.signed_url, begin.token, 'files/png-as.jar');
    expect(put.ok).toBe(true);

    expectFail(
      await callAction(uploadProjectFile, commitInput(exclusiveId, begin.path), { role: 'admin' }),
      'validation',
    );
    // The failed commit removed ITS object only — the earlier committed object survives (U1).
    expect(await objectExists(begin.path)).toBe(false);
    expect(await objectExists(storyPath)).toBe(true);
  });
});
