/**
 * tests/helpers/fixtures.ts — typed loaders over `tests/fixtures/<source>/<name>` (05 §1.2, F-1..F-5).
 *   fixturePath(source, name)   → absolute path
 *   fixtureBytes(source, name)  → Uint8Array (binary fixtures: images/, files/)
 *   fixtureFile(source, name)   → a web `File` (for action inputs such as the avatar upload)
 *   loadFixture<T>(source, name) → parsed JSON · loadFixtureText(source, name) → raw text (xml/html)
 * Nothing here touches the network (H-5). No `import.meta` (Playwright compiles spec imports to CJS).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO_ROOT } from './envTest';

export type FixtureSource =
  | 'modrinth'
  | 'curseforge'
  | 'youtube'
  | 'oembed'
  | 'resend'
  | 'discord'
  | 'kofi'
  | 'files'
  | 'images'
  | 'emails'
  | 'ui';

export const FIXTURE_ROOT = path.join(REPO_ROOT, 'tests', 'fixtures');

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.jar': 'application/java-archive',
  '.mrpack': 'application/x-modrinth-modpack+zip',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.txt': 'text/plain',
};

/** MIME type by file extension (what a browser would put on a `File` of that name). */
export function mimeForName(name: string): string {
  return MIME_BY_EXT[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
}

export function fixturePath(source: FixtureSource, name: string): string {
  const resolved = path.resolve(FIXTURE_ROOT, source, name);
  if (!resolved.startsWith(FIXTURE_ROOT + path.sep)) {
    throw new Error(`fixturePath: "${source}/${name}" escapes tests/fixtures/`);
  }
  return resolved;
}

export async function fixtureBytes(
  source: FixtureSource,
  name: string,
): Promise<Uint8Array<ArrayBuffer>> {
  // Copy out of Node's pooled Buffer so the result owns a plain ArrayBuffer (what `File`/`Blob` accept).
  return new Uint8Array(await readFile(fixturePath(source, name)));
}

/**
 * A `File` carrying the fixture bytes — `name` defaults to the fixture's file name and `type` to the
 * extension's MIME (override either to simulate a mislabelled upload, e.g. `png-as.jar` as an avatar).
 */
export async function fixtureFile(
  source: FixtureSource,
  name: string,
  options: { name?: string; type?: string } = {},
): Promise<File> {
  const bytes = await fixtureBytes(source, name);
  const fileName = options.name ?? path.basename(name);
  return new File([bytes], fileName, { type: options.type ?? mimeForName(fileName) });
}

export async function loadFixture<T = unknown>(source: FixtureSource, name: string): Promise<T> {
  return JSON.parse(await readFile(fixturePath(source, name), 'utf8')) as T;
}

export function loadFixtureText(source: FixtureSource, name: string): Promise<string> {
  return readFile(fixturePath(source, name), 'utf8');
}
