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
 * Errors carry an `ActionErrorCode` (`validation` | `storage_error`) so `runAction` maps them.
 * Later slices add the other SC-21 builders and `resolveDownloadable` here.
 */
import 'server-only';
import sharp from 'sharp';
import { env } from '@/lib/env';
import { sha256Hex } from '@/lib/hash';
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

export function avatarTooSmall(width: number, height: number): string {
  return `That's ${width}×${height}. Pictures need to be at least ${AVATAR_MIN_SIDE}×${AVATAR_MIN_SIDE}.`;
}

/** `{profile_id}/{hash16}.webp` — the object path inside the `avatars` bucket (04 SC-21). */
export function avatarObjectPath(profileId: string, hash16: string): string {
  return `${profileId}/${hash16}.webp`;
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

/** Removes one avatar object. A missing object is not an error; a Storage failure throws. */
export async function deleteAvatar(path: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.storage.from(AVATAR_BUCKET).remove([path]);
  if (error) throw new AvatarError('storage_error', AVATAR_REMOVE_FAILED);
}
