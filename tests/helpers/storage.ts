/**
 * tests/helpers/storage.ts — `uploadFixture(bucket, path, fixtureFile)` · `putSigned(signedUrl, token, fixtureFile)`
 * (05 §1.3, SEED-13). `uploadFixture` places a fixture behind a storage path through the SERVICE client
 * (RLS bypass — the legitimate "server uploads" path; avatars/media/files are never written by users
 * directly, 01 INV-14). `fixtureFile` is relative to tests/fixtures/ (`images/tiny.webp`, `files/pack.zip`).
 * Content type comes from the extension unless overridden (the `avatars` bucket only accepts image/webp).
 * `putSigned` performs the browser step of the two-phase upload (04 §1.4.5) — lands in S1.3 (05 §8).
 */
import { readFile } from 'node:fs/promises';
import { asRole } from './asRole';
import { fixturePath, mimeForName, type FixtureSource } from './fixtures';

export type Bucket = 'project-files' | 'project-media' | 'skins' | 'art' | 'avatars';

function splitFixtureRef(fixtureFile: string): { source: FixtureSource; name: string } {
  const slash = fixtureFile.indexOf('/');
  if (slash <= 0 || slash === fixtureFile.length - 1) {
    throw new Error(
      `uploadFixture: fixtureFile must be "<source>/<name>" relative to tests/fixtures/, got "${fixtureFile}"`,
    );
  }
  return {
    source: fixtureFile.slice(0, slash) as FixtureSource,
    name: fixtureFile.slice(slash + 1),
  };
}

/** Uploads (upsert) `tests/fixtures/<fixtureFile>` to `<bucket>/<path>` via the service client. */
export async function uploadFixture(
  bucket: Bucket,
  path: string,
  fixtureFile: string,
  options: { contentType?: string } = {},
): Promise<void> {
  const { source, name } = splitFixtureRef(fixtureFile);
  const bytes = await readFile(fixturePath(source, name));
  const contentType = options.contentType ?? mimeForName(name);
  const { error } = await asRole('service')
    .storage.from(bucket)
    .upload(path, bytes, { contentType, upsert: true });
  if (error) {
    throw new Error(`uploadFixture: ${bucket}/${path} ← ${fixtureFile} failed: ${error.message}`);
  }
}

/** Removes objects (service client); missing paths are not an error. Use in `afterEach`/`afterAll`. */
export async function removeObjects(bucket: Bucket, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await asRole('service').storage.from(bucket).remove(paths);
  if (error) throw new Error(`removeObjects: ${bucket} ${paths.join(', ')}: ${error.message}`);
}

/** Lists object names under `prefix` (service client) — e.g. everything under `avatars/<profileId>`. */
export async function listObjects(bucket: Bucket, prefix: string): Promise<string[]> {
  const { data, error } = await asRole('service')
    .storage.from(bucket)
    .list(prefix, { limit: 1000 });
  if (error) throw new Error(`listObjects: ${bucket}/${prefix}: ${error.message}`);
  return (data ?? []).filter((o) => o.id !== null).map((o) => `${prefix}/${o.name}`);
}

export const putSigned: (
  signedUrl: string,
  token: string,
  fixtureFile: string,
) => Promise<Response> = () => {
  throw new Error('putSigned: available from S1.3');
};
