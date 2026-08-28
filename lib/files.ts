/**
 * lib/files.ts — storage paths + the avatar pipeline (04 SC-21; 01 INV-47 / INV-53; ADR-0002 C16).
 *
 * Server-only; may import the service-role client (01 INV-84) because Storage writes are service-role
 * only (INV-33). Callers are Server Actions that have ALREADY passed their auth check (04 SC-06).
 *
 * Avatar pipeline (INV-47): decode → `.rotate()` (apply EXIF orientation) → square centre-crop →
 * 512×512 → WebP q82 → metadata stripped (no `withMetadata`, so EXIF/ICC/XMP/GPS never reach
 * Storage) → `{hash16}` = first 16 hex of sha256 over the RE-ENCODED bytes → object path
 * `{profile_id}/{hash16}.webp` inside the `avatars` bucket (`profiles.avatar_path` stores exactly
 * that — no bucket prefix). Original bytes are never stored.
 *
 * Ownership (INV-53; ADR-0015 addendum): the service-role client can delete ANY object, and
 * `profiles.avatar_path` is an own-row write under RLS — so a row could be pointed at another user's
 * object. Every delete here therefore re-checks `isOwnAvatarPath(profileId, path)` (the caller's id,
 * never the row's value alone) and the DB CHECK `profiles_avatar_path_own`
 * (20260820120400_profiles_avatar_path_check.sql) rejects such a row in the first place.
 *
 * Errors carry an `ActionErrorCode` (`validation` | `storage_error`) so `runAction` maps them.
 *
 * S1.3 adds the project buckets (04 §1.4.5 two-phase uploads; §2.3 D2/D5 downloads; 01 INV-51/53/55/56):
 * path builders + parsers for `project-media` / `project-files` (DB-stored paths are
 * bucket-prefixed — `project-media/{project_id}/…` — matching SC-21 and the S1.2 seed; the
 * object path inside the bucket is derived by stripping that prefix), `createSignedUpload`
 * (the ONE `createSignedUploadUrl` call site in the repo — INV-51), the commit-phase object
 * helpers, `createDownloadUrl` (60 s signed URL, `download: filename`) and
 * `resolveDownloadable` (generic file-id → bucket/path/filename/counter — INV-56; kind
 * `project_file` now, `skin` S1.7, `workroom_file` S2.3). Skins/art builders land in S1.7.
 */
import 'server-only';
import sharp from 'sharp';
import { env } from '@/lib/env';
import { sha256Hex } from '@/lib/hash';
import { log } from '@/lib/log';
import { createAdminClient } from '@/lib/supabase/admin';

export const AVATAR_BUCKET = 'avatars';
export const AVATAR_SIDE = 512;
export const AVATAR_MIN_SIDE = 64;
export const AVATAR_QUALITY = 82;

/** Decoded-pixel ceiling (≈ 50 MP): a 1 MB PNG can still be a decompression bomb. */
const MAX_INPUT_PIXELS = 50_000_000;

export type AvatarErrorCode = 'validation' | 'storage_error';

/** Coded error for the avatar pipeline; `runAction` turns `code` into the action result. */
export class AvatarError extends Error {
  readonly code: AvatarErrorCode;

  constructor(code: AvatarErrorCode, message: string) {
    super(message);
    this.name = 'AvatarError';
    this.code = code;
  }
}

export const AVATAR_UNREADABLE = "That file didn't open as an image.";
export const AVATAR_SAVE_FAILED = "Couldn't save that picture. Try again.";
export const AVATAR_REMOVE_FAILED = "Couldn't remove that picture. Try again.";
export const AVATAR_NOT_YOURS = "That picture isn't yours.";

/** Canonical lowercase UUID — the only shape `profiles.id` (and so an avatar folder) can have. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** `{hash16}.webp` — the object name `avatarObjectPath` produces. */
const HASH16_WEBP_RE = /^[0-9a-f]{16}\.webp$/;

export function avatarTooSmall(width: number, height: number): string {
  return `That's ${width}×${height}. Pictures need to be at least ${AVATAR_MIN_SIDE}×${AVATAR_MIN_SIDE}.`;
}

/** `{profile_id}/{hash16}.webp` — the object path inside the `avatars` bucket (04 SC-21). */
export function avatarObjectPath(profileId: string, hash16: string): string {
  return `${profileId}/${hash16}.webp`;
}

/**
 * True only when `path` is exactly `^<profileId>/[0-9a-f]{16}\.webp$` — i.e. something
 * `avatarObjectPath(profileId, …)` could have produced for THIS profile. Mirrors the DB CHECK
 * `profiles_avatar_path_own` (`avatar_path ~ ('^' || id::text || '/[0-9a-f]{16}\.webp$')`).
 * Pure; safe to call with untrusted `path`.
 */
export function isOwnAvatarPath(profileId: string, path: string): boolean {
  if (!UUID_RE.test(profileId)) return false;
  const prefix = `${profileId}/`;
  if (!path.startsWith(prefix)) return false;
  return HASH16_WEBP_RE.test(path.slice(prefix.length));
}

/** Public URL for an avatar object path (bucket is public-read, INV-33). */
export function avatarPublicUrl(path: string): string {
  return `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${AVATAR_BUCKET}/${path}`;
}

/** First 16 hex of sha256 over `bytes` — the `{hash}` segment of every content-addressed path. */
export function contentHash16(bytes: Uint8Array): string {
  return sha256Hex(bytes).slice(0, 16);
}

/**
 * Re-encodes an uploaded picture per INV-47. Throws `AvatarError('validation', …)` when the bytes do
 * not decode as an image or either side is below 64 px; any other sharp failure is also reported as
 * `validation` (the input is the only variable). Returns the WebP bytes + their `hash16`.
 */
export async function reencodeAvatar(
  bytes: Uint8Array,
): Promise<{ bytes: Buffer; hash16: string }> {
  let width = 0;
  let height = 0;
  try {
    const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    width = meta.width ?? 0;
    height = meta.height ?? 0;
  } catch {
    throw new AvatarError('validation', AVATAR_UNREADABLE);
  }
  if (width < AVATAR_MIN_SIDE || height < AVATAR_MIN_SIDE) {
    throw new AvatarError('validation', avatarTooSmall(width, height));
  }

  let out: Buffer;
  try {
    out = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize(AVATAR_SIDE, AVATAR_SIDE, { fit: 'cover', position: 'centre' })
      .webp({ quality: AVATAR_QUALITY })
      .toBuffer();
  } catch {
    throw new AvatarError('validation', AVATAR_UNREADABLE);
  }
  return { bytes: out, hash16: contentHash16(out) };
}

/**
 * Uploads already re-encoded WebP bytes to `avatars/{profileId}/{hash16}.webp` (upsert — the path is
 * content-addressed, so a re-upload of identical bytes is a no-op). Returns the object path.
 */
export async function uploadAvatar(profileId: string, bytes: Buffer): Promise<string> {
  const path = avatarObjectPath(profileId, contentHash16(bytes));
  const admin = createAdminClient();
  const { error } = await admin.storage.from(AVATAR_BUCKET).upload(path, bytes, {
    contentType: 'image/webp',
    upsert: true,
    cacheControl: '31536000',
  });
  if (error) throw new AvatarError('storage_error', AVATAR_SAVE_FAILED);
  return path;
}

/**
 * Removes one avatar object that belongs to `profileId`. Throws `AvatarError('validation',
 * AVATAR_NOT_YOURS)` — before touching Storage — unless `isOwnAvatarPath(profileId, path)`; the
 * service-role client would otherwise delete whatever `path` names. A missing object is not an error;
 * a Storage failure throws `storage_error`.
 */
export async function deleteAvatar(profileId: string, path: string): Promise<void> {
  if (!isOwnAvatarPath(profileId, path)) throw new AvatarError('validation', AVATAR_NOT_YOURS);
  const admin = createAdminClient();
  const { error } = await admin.storage.from(AVATAR_BUCKET).remove([path]);
  if (error) throw new AvatarError('storage_error', AVATAR_REMOVE_FAILED);
}

/** Log correlation for `deleteAvatarQuietly`: the calling action's name + its `runAction` request id. */
export type AvatarCleanupContext = { action: string; id: string };

/**
 * Best-effort removal of an object the DB row no longer references. Never throws: a `path` outside
 * `profileId`'s folder is skipped (one `warn` line, `avatar_path_not_own` — the object is left alone)
 * and a Storage failure is logged (`avatar_cleanup_failed`). Same ownership rule as `deleteAvatar`.
 */
export async function deleteAvatarQuietly(
  profileId: string,
  path: string,
  ctx: AvatarCleanupContext,
): Promise<void> {
  if (!isOwnAvatarPath(profileId, path)) {
    log.warn({
      action: ctx.action,
      id: ctx.id,
      msg: 'avatar_path_not_own',
      meta: { profile_id: profileId, path },
    });
    return;
  }
  try {
    await deleteAvatar(profileId, path);
  } catch {
    log.warn({ action: ctx.action, id: ctx.id, msg: 'avatar_cleanup_failed', meta: { path } });
  }
}

/* ------------------------------------------------------------------------------------------------
 * S1.3 — project buckets: paths, signed uploads, commit helpers, downloads
 * (04 SC-21, §1.4.5, §2.3 D2/D5; 01 INV-51/INV-53/INV-55/INV-56; ADR-0002 C16)
 * ---------------------------------------------------------------------------------------------- */

export const PROJECT_FILES_BUCKET = 'project-files';
export const PROJECT_MEDIA_BUCKET = 'project-media';

/** 04 §2.3 D5 — signed download URLs live 60 seconds. */
export const DOWNLOAD_URL_TTL_S = 60;

export const UPLOAD_START_FAILED = "Couldn't start that upload. Try again.";
export const UPLOAD_MISSING = 'That upload never arrived. Send the file first.';
export const UPLOAD_SAVE_FAILED = "Couldn't save that upload. Try again.";

/** Coded error for the project-bucket helpers; `runAction` turns `code` into the action result. */
export class StorageError extends Error {
  readonly code: 'validation' | 'storage_error';

  constructor(code: 'validation' | 'storage_error', message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

export type ProjectMediaKind = 'icon' | 'gallery';
export type ProjectMediaExt = 'png' | 'jpg' | 'webp';

/** Sniffed image mime → the extension SC-21 media paths carry. */
export function mediaExtForMime(mime: string): ProjectMediaExt | null {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return null;
}

/** `{uuid}` — the `begin`-phase placeholder segment (04 §1.4.5: `{hash}` is unknown until commit). */
const PENDING_SEGMENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** `{hash16}` — the final content-addressed segment (SC-21). */
const HASH16_RE = /^[0-9a-f]{16}$/;
/** A filename `sanitizeFilename` could have produced, ending in one of the three file extensions. */
const PROJECT_FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

/**
 * `begin`-phase media path: `project-media/{project_id}/{icon|gallery}/{uuid}.{ext}`
 * (bucket-prefixed, like every DB-stored path). Commit moves it to the `{hash16}` path.
 */
export function projectMediaPendingPath(
  projectId: string,
  kind: ProjectMediaKind,
  ext: ProjectMediaExt,
): string {
  return `${PROJECT_MEDIA_BUCKET}/${projectId}/${kind}/${crypto.randomUUID()}.${ext}`;
}

/** Final media path: `project-media/{project_id}/{icon|gallery}/{hash16}.{ext}` (04 SC-21). */
export function projectMediaFinalPath(
  projectId: string,
  kind: ProjectMediaKind,
  hash16: string,
  ext: ProjectMediaExt,
): string {
  return `${PROJECT_MEDIA_BUCKET}/${projectId}/${kind}/${hash16}.${ext}`;
}

/** File path: `project-files/{project_id}/{version_id}/{filename}` (04 SC-21; filename per SC-20). */
export function projectFilePath(projectId: string, versionId: string, filename: string): string {
  return `${PROJECT_FILES_BUCKET}/${projectId}/${versionId}/${filename}`;
}

/**
 * Parses a `begin`-phase media path back into `{kind, ext, segment}` — null unless the path
 * matches THIS project's pending pattern exactly (INV-53: commit rejects any path that does
 * not match the caller's target ids). Accepts the uuid placeholder segment only, never a
 * committed `{hash16}` path (U3 idempotency is handled by the caller from the DB row).
 */
export function parseProjectMediaPendingPath(
  projectId: string,
  path: string,
): { kind: ProjectMediaKind; ext: ProjectMediaExt } | null {
  if (!UUID_RE.test(projectId)) return null;
  const prefix = `${PROJECT_MEDIA_BUCKET}/${projectId}/`;
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length).split('/');
  const [kind, name] = rest;
  if (rest.length !== 2 || kind === undefined || name === undefined) return null;
  if (kind !== 'icon' && kind !== 'gallery') return null;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  const segment = name.slice(0, dot);
  const ext = name.slice(dot + 1);
  if (!PENDING_SEGMENT_RE.test(segment)) return null;
  if (ext !== 'png' && ext !== 'jpg' && ext !== 'webp') return null;
  return { kind, ext };
}

/** True for a committed media path (`{hash16}` segment) of THIS project — used by U3 re-commits. */
export function isProjectMediaFinalPath(projectId: string, path: string): boolean {
  if (!UUID_RE.test(projectId)) return false;
  const prefix = `${PROJECT_MEDIA_BUCKET}/${projectId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length).split('/');
  const [kind, name] = rest;
  if (rest.length !== 2 || kind === undefined || name === undefined) return false;
  if (kind !== 'icon' && kind !== 'gallery') return false;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return false;
  return HASH16_RE.test(name.slice(0, dot)) && ['png', 'jpg', 'webp'].includes(name.slice(dot + 1));
}

/**
 * Parses `project-files/{project_id}/{version_id}/{filename}` for THIS project (INV-53).
 * Returns the embedded `versionId` + `filename` or null.
 */
export function parseProjectFilePath(
  projectId: string,
  path: string,
): { versionId: string; filename: string } | null {
  if (!UUID_RE.test(projectId)) return null;
  const prefix = `${PROJECT_FILES_BUCKET}/${projectId}/`;
  if (!path.startsWith(prefix)) return null;
  const rest = path.slice(prefix.length).split('/');
  const [versionId, filename] = rest;
  if (rest.length !== 2 || versionId === undefined || filename === undefined) return null;
  if (!UUID_RE.test(versionId)) return null;
  if (!PROJECT_FILE_NAME_RE.test(filename)) return null;
  return { versionId, filename };
}

/** Strips the `{bucket}/` prefix a DB-stored path carries; null when it names another bucket. */
export function objectPathInBucket(bucket: string, dbPath: string): string | null {
  const prefix = `${bucket}/`;
  if (!dbPath.startsWith(prefix)) return null;
  const rest = dbPath.slice(prefix.length);
  return rest.length > 0 ? rest : null;
}

/**
 * Mints the one signed upload URL of the two-phase pattern (04 §1.4.5 `begin`). The ONLY
 * `createSignedUploadUrl` call site in the repo (01 INV-51); tokens are valid 2 h
 * (`UPLOAD_TOKEN_HOURS` — Supabase's fixed signed-upload token lifetime). Storage policies stay
 * service-role only: the token authorizes exactly this one server-generated path.
 */
export async function createSignedUpload(
  bucket: string,
  dbPath: string,
): Promise<{ path: string; token: string; signed_url: string }> {
  const objectPath = objectPathInBucket(bucket, dbPath);
  if (objectPath === null) throw new StorageError('storage_error', UPLOAD_START_FAILED);
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(objectPath);
  if (error !== null || data === null) {
    throw new StorageError('storage_error', UPLOAD_START_FAILED);
  }
  return { path: dbPath, token: data.token, signed_url: data.signedUrl };
}

/** Downloads a stored object's bytes for commit-phase re-validation; null when it is missing. */
export async function downloadObjectBytes(
  bucket: string,
  dbPath: string,
): Promise<Uint8Array | null> {
  const objectPath = objectPathInBucket(bucket, dbPath);
  if (objectPath === null) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).download(objectPath);
  if (error !== null || data === null) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/** Moves an object to its final content-addressed path (04 §1.4.5 commit). */
export async function moveObject(
  bucket: string,
  fromDbPath: string,
  toDbPath: string,
): Promise<void> {
  const from = objectPathInBucket(bucket, fromDbPath);
  const to = objectPathInBucket(bucket, toDbPath);
  if (from === null || to === null) throw new StorageError('storage_error', UPLOAD_SAVE_FAILED);
  if (from === to) return;
  const admin = createAdminClient();
  const { error } = await admin.storage.from(bucket).move(from, to);
  if (error !== null) {
    // The target may already exist (same bytes committed before) — then the source is a
    // duplicate; remove it and keep the committed object.
    const existing = await downloadObjectBytes(bucket, toDbPath);
    if (existing !== null) {
      await removeObjectQuietly(bucket, fromDbPath, { action: 'moveObject', id: 'dedupe' });
      return;
    }
    throw new StorageError('storage_error', UPLOAD_SAVE_FAILED);
  }
}

/** Removes one object; throws `storage_error` on failure (a missing object is not an error). */
export async function removeObject(bucket: string, dbPath: string): Promise<void> {
  const objectPath = objectPathInBucket(bucket, dbPath);
  if (objectPath === null) throw new StorageError('storage_error', UPLOAD_SAVE_FAILED);
  const admin = createAdminClient();
  const { error } = await admin.storage.from(bucket).remove([objectPath]);
  if (error !== null) throw new StorageError('storage_error', UPLOAD_SAVE_FAILED);
}

/** Best-effort object removal (failed-commit cleanup). Never throws; failures get one warn line. */
export async function removeObjectQuietly(
  bucket: string,
  dbPath: string,
  ctx: { action: string; id: string },
): Promise<void> {
  try {
    await removeObject(bucket, dbPath);
  } catch {
    log.warn({ action: ctx.action, id: ctx.id, msg: 'object_cleanup_failed', meta: { bucket } });
  }
}

/**
 * 60 s signed URL with `Content-Disposition: attachment; filename="…"` (04 §2.3 D5).
 * Throws `storage_error` on failure — the route maps it to 500 `internal` (counters already
 * incremented; acceptable, logged — 04 §2.3 Errors row).
 */
export async function createDownloadUrl(
  bucket: string,
  objectPath: string,
  filename: string,
): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrl(objectPath, DOWNLOAD_URL_TTL_S, { download: filename });
  if (error !== null || data === null) {
    throw new StorageError('storage_error', 'Signed URL failed.');
  }
  return data.signedUrl;
}

/** What `/api/download/[fileId]` needs to serve one downloadable thing (04 §2.3 D2). */
export type Downloadable = {
  kind: 'project_file'; // 'skin' arrives S1.7 (ADR-0002 C8); 'workroom_file' S2.3
  bucket: string;
  /** Object path inside `bucket` (ready for `createDownloadUrl`). */
  path: string;
  filename: string;
  counter: 'record_download';
};

/**
 * Resolves a file id to its bucket + path + counter, generically over kinds (01 INV-56 — the
 * route is not project-hardwired; bucket and owner scope come from data). Kind `project_file`:
 * the row must have `storage_path` (synced Modrinth files have `url` and are never proxied),
 * its project `status='published'` and not override-hidden. Anything else → null (the route
 * answers 404 — never 403, drafts are not revealed; 04 §2.3 D2).
 */
export async function resolveDownloadable(id: string): Promise<Downloadable | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('project_files')
    .select(
      'id, filename, storage_path, version:project_versions!inner(project:projects!inner(status, overrides:project_overrides(hidden)))',
    )
    .eq('id', id)
    .maybeSingle();
  if (error !== null) throw new Error(`resolveDownloadable read failed: ${error.message}`);
  if (data === null) return null;
  if (data.storage_path === null) return null;

  const project = data.version.project;
  if (project.status !== 'published') return null;
  const overrides = Array.isArray(project.overrides) ? project.overrides[0] : project.overrides;
  if (overrides?.hidden === true) return null;

  const objectPath = objectPathInBucket(PROJECT_FILES_BUCKET, data.storage_path);
  if (objectPath === null) return null;

  return {
    kind: 'project_file',
    bucket: PROJECT_FILES_BUCKET,
    path: objectPath,
    filename: data.filename,
    counter: 'record_download',
  };
}

/**
 * Width/height of a stored image (any of png/jpg/webp — the commit-phase dimension check,
 * 04 §1.4.5 / `uploadProjectMedia` validation cell). Null when the bytes do not decode.
 */
export async function imageDimensions(
  bytes: Uint8Array,
): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    if (meta.width === undefined || meta.height === undefined) return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}
