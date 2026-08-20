/**
 * lib/validation/files.ts — upload allow-lists, magic-byte sniffing and filename hygiene
 * (04 SC-18 / SC-19 / SC-20; 01 INV-51 / INV-52; ADR-0002 C16, #31).
 *
 * Plain module (client-safe): `AvatarUpload` / `UploadWell` run the same size/type pre-check and
 * print the same copy the server returns, from the one `UPLOAD_KINDS` table. The server ALWAYS
 * re-validates (`validateUpload` in the action) — the extension is never trusted on its own.
 *
 *   sniffMime(bytes)           PNG · JPEG · WebP · ZIP (jar/zip/mrpack) · SVG (detected so it can be refused)
 *   UPLOAD_KINDS               avatar 1 MB · project-media 5 MB · project-file 100 MB · skin 64 KB (bust 512 KB) · art 10 MB
 *   validateUpload(file, kind) {ok, mime} | {ok:false, message} — copy carries the actual numbers
 *   pngDimensions(bytes)       IHDR width/height · isSkinTexture(bytes) = PNG exactly 64×64
 *   sanitizeFilename(name)     NFKD → [A-Za-z0-9._-] → no `..`/separators/leading dot → ≤ 120 → lowercase ext
 */

export type SniffedMime =
  'image/png' | 'image/jpeg' | 'image/webp' | 'application/zip' | 'image/svg+xml';

export type UploadKind = 'avatar' | 'project-media' | 'project-file' | 'skin' | 'art';

export type UploadRule = {
  /** Accepted sniffed MIME types (magic bytes, 04 SC-19). */
  readonly mimes: readonly SniffedMime[];
  /** Hard cap in bytes. */
  readonly maxBytes: number;
  /** Accepted filename extensions (printed in copy; enforced for `project-file`). */
  readonly exts: readonly string[];
  /** Skins only: the rendered bust cap. */
  readonly bustMaxBytes?: number;
  /** Exact pixel dimensions when the kind requires them (skins). */
  readonly width?: number;
  readonly height?: number;
};

const KB = 1024;
const MB = 1024 * KB;

const IMAGE_MIMES: readonly SniffedMime[] = ['image/png', 'image/jpeg', 'image/webp'];
const IMAGE_EXTS: readonly string[] = ['png', 'jpg', 'jpeg', 'webp'];

/** The one table of caps and allow-lists (01 INV-52; 05 T-UNIT-18). */
export const UPLOAD_KINDS: Readonly<Record<UploadKind, UploadRule>> = {
  avatar: { mimes: IMAGE_MIMES, maxBytes: 1 * MB, exts: IMAGE_EXTS },
  'project-media': { mimes: IMAGE_MIMES, maxBytes: 5 * MB, exts: IMAGE_EXTS },
  'project-file': {
    mimes: ['application/zip'],
    maxBytes: 100 * MB,
    exts: ['jar', 'zip', 'mrpack'],
  },
  skin: {
    mimes: ['image/png'],
    maxBytes: 64 * KB,
    bustMaxBytes: 512 * KB,
    exts: ['png'],
    width: 64,
    height: 64,
  },
  art: { mimes: IMAGE_MIMES, maxBytes: 10 * MB, exts: IMAGE_EXTS },
};

export type UploadInput = {
  name: string;
  size: number;
  bytes: Uint8Array;
};

export type UploadCheck = { ok: true; mime: SniffedMime } | { ok: false; message: string };

// ---------------------------------------------------------------------------------------------
// Magic bytes (04 SC-19)
// ---------------------------------------------------------------------------------------------

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const; // 'RIFF'
const WEBP = [0x57, 0x45, 0x42, 0x50] as const; // 'WEBP'

function startsWith(bytes: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[offset + i] !== magic[i]) return false;
  }
  return true;
}

/** `<svg` (optionally after a BOM / whitespace / XML prolog / comments) within the first 512 bytes. */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 512))
    .replace(/^﻿/, '')
    .trimStart();
  if (!head.startsWith('<')) return false;
  return /<svg[\s>]/i.test(head);
}

/**
 * Identifies a file by its leading bytes. Returns `null` for anything unrecognised (GIF, HTML,
 * executables, empty input). SVG is returned as `image/svg+xml` so every allow-list rejects it by name.
 */
export function sniffMime(bytes: Uint8Array): SniffedMime | null {
  if (bytes.length === 0) return null;
  if (startsWith(bytes, PNG_MAGIC)) return 'image/png';
  if (startsWith(bytes, JPEG_MAGIC)) return 'image/jpeg';
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp';
  if (startsWith(bytes, ZIP_MAGIC)) return 'application/zip';
  if (looksLikeSvg(bytes)) return 'image/svg+xml';
  return null;
}

const MIME_EXT: Readonly<Record<SniffedMime, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/zip': 'zip',
  'image/svg+xml': 'svg',
};

// ---------------------------------------------------------------------------------------------
// PNG dimensions (IHDR) — skins must be exactly 64×64 (01 INV-52)
// ---------------------------------------------------------------------------------------------

/** Width/height from the PNG IHDR chunk, or `null` when the bytes are not a PNG with an IHDR. */
export function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (!startsWith(bytes, PNG_MAGIC) || bytes.length < 24) return null;
  // bytes 12..15 must spell 'IHDR'
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width === 0 || height === 0) return null;
  return { width, height };
}

/** True only for a PNG whose IHDR says 64×64 (the Minecraft skin texture size). */
export function isSkinTexture(bytes: Uint8Array): boolean {
  const dims = pngDimensions(bytes);
  return dims !== null && dims.width === 64 && dims.height === 64;
}

// ---------------------------------------------------------------------------------------------
// validateUpload — copy with the actual numbers (DESIGN.md §11.1 Upload well; 03 `UploadWell`)
// ---------------------------------------------------------------------------------------------

/** `1` · `1.4` · `82` · `120` — one decimal below 10 when it matters, whole numbers above. */
function formatAmount(value: number): string {
  if (value >= 10) return String(Math.round(value));
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Human size in the unit that suits the cap: MB for caps ≥ 1 MB, KB below. */
function sizeCopy(bytes: number, cap: number): { size: string; limit: string; unit: 'MB' | 'KB' } {
  const unit = cap >= MB ? 'MB' : 'KB';
  const divisor = unit === 'MB' ? MB : KB;
  return { size: formatAmount(bytes / divisor), limit: formatAmount(cap / divisor), unit };
}

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return name.slice(dot + 1).toLowerCase();
}

function allowedCopy(exts: readonly string[]): string {
  return exts
    .filter((ext) => ext !== 'jpeg')
    .map((ext) => `.${ext}`)
    .join(' ');
}

/** Size message, exported so clients can print the pre-check with identical words. */
export function sizeLimitMessage(bytes: number, kind: UploadKind): string {
  const { size, limit, unit } = sizeCopy(bytes, UPLOAD_KINDS[kind].maxBytes);
  return `That's ${size} ${unit}. The limit is ${limit}.`;
}

/** Type message, exported for the same reason. `ext` is what the file actually is. */
export function typeMessage(ext: string | null, kind: UploadKind): string {
  const what = ext ? `a .${ext}` : 'not a file we can read';
  return `That's ${what}. Allowed: ${allowedCopy(UPLOAD_KINDS[kind].exts)}`;
}

/**
 * Server-side gate for every upload kind: size cap → magic bytes ∈ allow-list → (project-file) the
 * extension must be one of jar/zip/mrpack → (skin) exactly 64×64. Never trusts the filename alone.
 */
export function validateUpload(file: UploadInput, kind: UploadKind): UploadCheck {
  const rule = UPLOAD_KINDS[kind];
  const size = Math.max(file.size, file.bytes.byteLength);

  if (size > rule.maxBytes) {
    return { ok: false, message: sizeLimitMessage(size, kind) };
  }

  const mime = sniffMime(file.bytes);
  const nameExt = extensionOf(file.name);
  if (mime === null || !rule.mimes.includes(mime)) {
    const actual = mime ? MIME_EXT[mime] : nameExt;
    return { ok: false, message: typeMessage(actual, kind) };
  }

  if (kind === 'project-file' && (nameExt === null || !rule.exts.includes(nameExt))) {
    return { ok: false, message: typeMessage(nameExt, kind) };
  }

  if (rule.width !== undefined && rule.height !== undefined) {
    const dims = pngDimensions(file.bytes);
    if (!dims || dims.width !== rule.width || dims.height !== rule.height) {
      const got = dims ? `${dims.width}×${dims.height}` : 'not a readable PNG';
      return {
        ok: false,
        message: `That's ${got}. Skins are ${rule.width}×${rule.height}.`,
      };
    }
  }

  return { ok: true, mime };
}

// ---------------------------------------------------------------------------------------------
// sanitizeFilename (04 SC-20)
// ---------------------------------------------------------------------------------------------

const MAX_FILENAME = 120;

/**
 * NFKD-normalise, drop path separators and everything outside `[A-Za-z0-9._-]`, collapse runs of
 * `-`, reduce `..` to `.`, forbid a leading `.`, cap at 120 chars, lowercase the extension.
 * Returns `file` when nothing usable remains.
 */
export function sanitizeFilename(name: string): string {
  let out = name
    .normalize('NFKD')
    .replace(/[\\/]+/g, '-')
    .replace(/[^A-Za-z0-9._-]+/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '');

  if (out.length > MAX_FILENAME) {
    const dot = out.lastIndexOf('.');
    const ext = dot > 0 ? out.slice(dot) : '';
    const base = dot > 0 ? out.slice(0, dot) : out;
    out = `${base.slice(0, Math.max(1, MAX_FILENAME - ext.length))}${ext}`;
  }

  const dot = out.lastIndexOf('.');
  if (dot > 0) out = `${out.slice(0, dot)}${out.slice(dot).toLowerCase()}`;

  out = out.replace(/^[.-]+/, '');
  return out === '' ? 'file' : out;
}
