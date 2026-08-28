/**
 * tests/unit/files.test.ts — T-UNIT-17: `sniffMime(bytes)` magic bytes (04 SC-19); T-UNIT-18:
 * `UPLOAD_KINDS` / `validateUpload` caps + copy with the actual numbers (01 INV-52; ADR-0002 #31),
 * including the `supabase/config.toml` `[storage] file_size_limit = "100MiB"` read (05 CI-13);
 * T-UNIT-19: `pngDimensions` / `isSkinTexture`; T-UNIT-22: `sanitizeFilename` (04 SC-20).
 * Bytes are hand-built or read from tests/fixtures/{images,files} (05 §1.2) — nothing is uploaded.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  UPLOAD_KINDS,
  isSkinTexture,
  pngDimensions,
  sanitizeFilename,
  sizeLimitMessage,
  sniffMime,
  typeMessage,
  validateUpload,
  type UploadKind,
} from '@/lib/validation/files';
import { REPO_ROOT } from '../helpers/envTest';

const KB = 1024;
const MB = 1024 * KB;
const MIB_100 = 100 * MB; // 104_857_600

const fixture = (rel: string): Uint8Array =>
  new Uint8Array(readFileSync(path.join(REPO_ROOT, 'tests', 'fixtures', rel)));

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text);

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A minimal PNG head: signature + IHDR chunk (length, type, width, height, …). Enough for sniff + IHDR. */
function pngHead(width: number, height: number): Uint8Array {
  const out = new Uint8Array(33);
  out.set(PNG_MAGIC, 0);
  const view = new DataView(out.buffer);
  view.setUint32(8, 13, false); // IHDR length
  out.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  out.set([8, 6, 0, 0, 0], 24); // bit depth, colour type, compression, filter, interlace
  return out;
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
const GIF_BYTES = ascii('GIF89a  ');
const SVG_BYTES = ascii('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // 'MZ'

const KINDS: readonly UploadKind[] = ['avatar', 'project-media', 'project-file', 'skin', 'art'];

const upload = (name: string, bytes: Uint8Array, size = bytes.byteLength) => ({
  name,
  size,
  bytes,
});

// ---------------------------------------------------------------------------------------------
// T-UNIT-17 — sniffMime
// ---------------------------------------------------------------------------------------------

describe('sniffMime (T-UNIT-17)', () => {
  it.each([
    ['PNG 89 50 4E 47 0D 0A 1A 0A', pngHead(1, 1), 'image/png'],
    ['JPEG FF D8 FF', JPEG_BYTES, 'image/jpeg'],
    ['WebP RIFF ???? WEBP', WEBP_BYTES, 'image/webp'],
    ['ZIP 50 4B 03 04', ZIP_BYTES, 'application/zip'],
    ['SVG <svg', SVG_BYTES, 'image/svg+xml'],
  ] as const)('T-UNIT-17 %s → %s', (_label, bytes, expected) => {
    expect(sniffMime(bytes)).toBe(expected);
  });

  it('T-UNIT-17 fixtures sniff as what they are', () => {
    expect(sniffMime(fixture('images/avatar-600.png'))).toBe('image/png');
    expect(sniffMime(fixture('images/tiny.jpg'))).toBe('image/jpeg');
    expect(sniffMime(fixture('images/exif.jpg'))).toBe('image/jpeg');
    expect(sniffMime(fixture('images/tiny.webp'))).toBe('image/webp');
    expect(sniffMime(fixture('images/bad.svg'))).toBe('image/svg+xml'); // XML prolog + comment first
    expect(sniffMime(fixture('images/bad.gif'))).toBeNull();
    expect(sniffMime(fixture('files/png-as.jar'))).toBe('image/png'); // the extension is not trusted
  });

  it('T-UNIT-17 SVG is detected behind a BOM, whitespace, an XML prolog and comments', () => {
    expect(sniffMime(ascii('\uFEFF<svg viewBox="0 0 1 1"/>'))).toBe('image/svg+xml');
    expect(sniffMime(ascii('  \n<?xml version="1.0"?>\n<!-- x -->\n<svg>'))).toBe('image/svg+xml');
    expect(sniffMime(ascii('<SVG xmlns="http://www.w3.org/2000/svg">'))).toBe('image/svg+xml');
    // `<svg` has to be a tag, and the document has to start with markup.
    expect(sniffMime(ascii('<svgx>'))).toBeNull();
    expect(sniffMime(ascii('hello <svg>'))).toBeNull();
  });

  it.each([
    ['empty', new Uint8Array(0)],
    ['GIF89a', GIF_BYTES],
    ['GIF87a', ascii('GIF87a')],
    ['HTML', ascii('<!doctype html><html><body>x</body></html>')],
    ['PE executable MZ', EXE_BYTES],
    ['ELF', new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01])],
    ['plain text', ascii('just some text')],
    ['truncated PNG signature', new Uint8Array(PNG_MAGIC.slice(0, 4))],
    ['RIFF but WAVE', ascii('RIFF    WAVEfmt ')],
    ['RIFF only', ascii('RIFF')],
    ['ZIP empty-archive marker 50 4B 05 06', new Uint8Array([0x50, 0x4b, 0x05, 0x06])],
    ['BMP', ascii('BM  ')],
    ['PDF', ascii('%PDF-1.7')],
  ] as const)('T-UNIT-17 %s → null', (_label, bytes) => {
    expect(sniffMime(bytes)).toBeNull();
  });

  it('T-UNIT-17 works on a subarray view (non-zero byteOffset)', () => {
    const padded = new Uint8Array(4 + 33);
    padded.set(pngHead(64, 64), 4);
    const view = padded.subarray(4);
    expect(sniffMime(view)).toBe('image/png');
    expect(pngDimensions(view)).toEqual({ width: 64, height: 64 });
  });

  it('T-UNIT-17 SVG is rejected by every allow-list even when named like an image', () => {
    for (const kind of KINDS) {
      const result = validateUpload(upload('picture.png', SVG_BYTES), kind);
      expect(result.ok, kind).toBe(false);
      if (!result.ok) expect(result.message, kind).toMatch(/^That's a \.svg\. Allowed: /);
      expect(UPLOAD_KINDS[kind].mimes).not.toContain('image/svg+xml');
    }
    const fromFixture = validateUpload(upload('bad.svg', fixture('images/bad.svg')), 'avatar');
    expect(fromFixture).toEqual({
      ok: false,
      message: "That's a .svg. Allowed: .png .jpg .webp",
    });
  });

  it('T-UNIT-17 GIF is rejected by every allow-list', () => {
    for (const kind of KINDS) {
      const result = validateUpload(upload('bad.gif', fixture('images/bad.gif')), kind);
      expect(result.ok, kind).toBe(false);
      if (!result.ok) expect(result.message, kind).toMatch(/^That's a \.gif\. Allowed: /);
    }
  });

  it('T-UNIT-17 empty bytes are rejected with the readable-file copy', () => {
    const result = validateUpload(upload('empty.png', new Uint8Array(0)), 'avatar');
    expect(result.ok).toBe(false);
    // mime null → the filename extension is reported; no extension → "not a file we can read"
    expect(validateUpload(upload('empty', new Uint8Array(0)), 'avatar')).toEqual({
      ok: false,
      message: "That's not a file we can read. Allowed: .png .jpg .webp",
    });
  });
});

// ---------------------------------------------------------------------------------------------
// T-UNIT-18 — UPLOAD_KINDS / validateUpload / config.toml
// ---------------------------------------------------------------------------------------------

describe('UPLOAD_KINDS (T-UNIT-18)', () => {
  it('T-UNIT-18 the table is exactly 01 INV-52', () => {
    expect(Object.keys(UPLOAD_KINDS).sort()).toEqual([...KINDS].sort());
    expect(UPLOAD_KINDS.avatar).toEqual({
      mimes: ['image/png', 'image/jpeg', 'image/webp'],
      maxBytes: 1_048_576,
      exts: ['png', 'jpg', 'jpeg', 'webp'],
    });
    expect(UPLOAD_KINDS['project-media']).toEqual({
      mimes: ['image/png', 'image/jpeg', 'image/webp'],
      maxBytes: 5_242_880,
      exts: ['png', 'jpg', 'jpeg', 'webp'],
    });
    expect(UPLOAD_KINDS['project-file']).toEqual({
      mimes: ['application/zip'],
      maxBytes: MIB_100,
      exts: ['jar', 'zip', 'mrpack'],
    });
    expect(UPLOAD_KINDS.skin).toEqual({
      mimes: ['image/png'],
      maxBytes: 65_536,
      bustMaxBytes: 524_288,
      exts: ['png'],
      width: 64,
      height: 64,
    });
    expect(UPLOAD_KINDS.art).toEqual({
      mimes: ['image/png', 'image/jpeg', 'image/webp'],
      maxBytes: 10_485_760,
      exts: ['png', 'jpg', 'jpeg', 'webp'],
    });
    expect(UPLOAD_KINDS['project-file'].maxBytes).toBe(104_857_600);
  });

  it('T-UNIT-18 supabase/config.toml [storage] file_size_limit is 100MiB (file read; 05 CI-13)', () => {
    const toml = readFileSync(path.join(REPO_ROOT, 'supabase', 'config.toml'), 'utf8');
    const storage = /^\[storage\]\s*$([\s\S]*?)(?=^\[)/m.exec(toml);
    expect(storage, '[storage] section present').not.toBeNull();
    const limitLine = /^\s*file_size_limit\s*=\s*"([^"]+)"/m.exec(storage?.[1] ?? '');
    expect(limitLine, 'file_size_limit set in [storage]').not.toBeNull();
    const raw = limitLine?.[1] ?? '';
    expect(raw).toBe('100MiB');

    const parsed = /^(\d+(?:\.\d+)?)\s*(B|KB|KiB|MB|MiB|GB|GiB)$/i.exec(raw);
    expect(parsed).not.toBeNull();
    const UNIT: Record<string, number> = {
      b: 1,
      kb: 1000,
      kib: KB,
      mb: 1000 ** 2,
      mib: MB,
      gb: 1000 ** 3,
      gib: 1024 ** 3,
    };
    const bytes = Number(parsed?.[1]) * (UNIT[(parsed?.[2] ?? '').toLowerCase()] ?? 0);
    expect(bytes).toBe(MIB_100);
    expect(bytes).toBeGreaterThanOrEqual(UPLOAD_KINDS['project-file'].maxBytes);
  });
});

describe('validateUpload size copy (T-UNIT-18)', () => {
  it.each([
    ['avatar', 3 * MB, "That's 3 MB. The limit is 1."],
    ['avatar', 1.4 * MB, "That's 1.4 MB. The limit is 1."],
    ['avatar', 1 * MB + 1, "That's 1 MB. The limit is 1."],
    ['project-media', 5 * MB + 512 * KB, "That's 5.5 MB. The limit is 5."],
    ['project-file', 120 * MB, "That's 120 MB. The limit is 100."],
    ['project-file', MIB_100 + 1, "That's 100 MB. The limit is 100."],
    ['skin', 100 * KB, "That's 100 KB. The limit is 64."],
    ['skin', 65_537, "That's 64 KB. The limit is 64."],
    ['art', 12 * MB, "That's 12 MB. The limit is 10."],
  ] as const)('T-UNIT-18 %s at %d bytes → %j', (kind, size, message) => {
    const bytes = kind === 'project-file' ? ZIP_BYTES : pngHead(64, 64);
    const name = kind === 'project-file' ? 'mod.jar' : 'pic.png';
    expect(validateUpload(upload(name, bytes, size), kind)).toEqual({ ok: false, message });
    expect(sizeLimitMessage(size, kind)).toBe(message);
  });

  it('T-UNIT-18 the printed cap for project-file is 100', () => {
    expect(sizeLimitMessage(MIB_100 * 2, 'project-file')).toBe("That's 200 MB. The limit is 100.");
    expect(sizeLimitMessage(MIB_100 * 2, 'project-file')).not.toContain('104');
  });

  it('T-UNIT-18 exactly at the cap passes; the larger of size and byteLength is what counts', () => {
    const png = pngHead(64, 64);
    expect(validateUpload(upload('a.png', png, 1 * MB), 'avatar')).toEqual({
      ok: true,
      mime: 'image/png',
    });
    // A lying `size` cannot sneak a big body through.
    const big = new Uint8Array(65 * KB);
    big.set(pngHead(64, 64), 0);
    const result = validateUpload(upload('skin.png', big, 10), 'skin');
    expect(result).toEqual({ ok: false, message: "That's 65 KB. The limit is 64." });
  });
});

describe('validateUpload type copy + project-file extension (T-UNIT-18)', () => {
  it('T-UNIT-18 image kinds accept png / jpg / webp by magic bytes (name not enforced)', () => {
    for (const kind of ['avatar', 'project-media', 'art'] as const) {
      expect(validateUpload(upload('a.png', fixture('images/avatar-600.png')), kind)).toEqual({
        ok: true,
        mime: 'image/png',
      });
      expect(validateUpload(upload('a.jpg', fixture('images/tiny.jpg')), kind)).toEqual({
        ok: true,
        mime: 'image/jpeg',
      });
      expect(validateUpload(upload('a.webp', fixture('images/tiny.webp')), kind)).toEqual({
        ok: true,
        mime: 'image/webp',
      });
      // The bytes decide — a PNG body under a foreign extension is still a PNG.
      expect(validateUpload(upload('photo.exe', pngHead(2, 2)), kind)).toEqual({
        ok: true,
        mime: 'image/png',
      });
    }
  });

  it.each([
    ['avatar', EXE_BYTES, 'virus.exe', "That's a .exe. Allowed: .png .jpg .webp"],
    ['project-media', ZIP_BYTES, 'pack.zip', "That's a .zip. Allowed: .png .jpg .webp"],
    ['art', SVG_BYTES, 'art.svg', "That's a .svg. Allowed: .png .jpg .webp"],
    ['skin', JPEG_BYTES, 'skin.jpg', "That's a .jpg. Allowed: .png"],
    ['skin', fixture('images/tiny.webp'), 'skin.webp', "That's a .webp. Allowed: .png"],
    ['project-file', EXE_BYTES, 'mod.exe', "That's a .exe. Allowed: .jar .zip .mrpack"],
    ['project-file', pngHead(2, 2), 'mod.jar', "That's a .png. Allowed: .jar .zip .mrpack"],
    [
      'project-file',
      fixture('files/png-as.jar'),
      'png-as.jar',
      "That's a .png. Allowed: .jar .zip .mrpack",
    ],
  ] as const)('T-UNIT-18 %s rejects %s with the actual type', (kind, bytes, name, message) => {
    expect(validateUpload(upload(name, bytes), kind)).toEqual({ ok: false, message });
  });

  it('T-UNIT-18 the allowed list omits the duplicate .jpeg and names every accepted ext', () => {
    expect(typeMessage('svg', 'avatar')).toBe("That's a .svg. Allowed: .png .jpg .webp");
    expect(typeMessage('exe', 'project-file')).toBe("That's a .exe. Allowed: .jar .zip .mrpack");
    expect(typeMessage('jpg', 'skin')).toBe("That's a .jpg. Allowed: .png");
    expect(typeMessage(null, 'art')).toBe(
      "That's not a file we can read. Allowed: .png .jpg .webp",
    );
  });

  it('T-UNIT-18 project-file: ZIP magic + a jar/zip/mrpack extension (case-insensitive)', () => {
    for (const name of ['mod.jar', 'pack.zip', 'modpack.mrpack', 'MOD.JAR', 'x.y.MrPack']) {
      expect(validateUpload(upload(name, ZIP_BYTES), 'project-file'), name).toEqual({
        ok: true,
        mime: 'application/zip',
      });
    }
    for (const [name, message] of [
      ['mod.exe', "That's a .exe. Allowed: .jar .zip .mrpack"],
      ['mod.png', "That's a .png. Allowed: .jar .zip .mrpack"],
      ['mod.jar.txt', "That's a .txt. Allowed: .jar .zip .mrpack"],
      ['noext', "That's not a file we can read. Allowed: .jar .zip .mrpack"],
      ['trailingdot.', "That's not a file we can read. Allowed: .jar .zip .mrpack"],
      ['.jar', "That's not a file we can read. Allowed: .jar .zip .mrpack"],
    ] as const) {
      expect(validateUpload(upload(name, ZIP_BYTES), 'project-file'), name).toEqual({
        ok: false,
        message,
      });
    }
  });

  it('T-UNIT-18 skin: PNG exactly 64×64 ≤ 64 KB', () => {
    expect(validateUpload(upload('skin.png', pngHead(64, 64)), 'skin')).toEqual({
      ok: true,
      mime: 'image/png',
    });
    expect(validateUpload(upload('skin.png', pngHead(32, 32)), 'skin')).toEqual({
      ok: false,
      message: "That's 32×32. Skins are 64×64.",
    });
    expect(validateUpload(upload('skin.png', pngHead(64, 32)), 'skin')).toEqual({
      ok: false,
      message: "That's 64×32. Skins are 64×64.",
    });
    expect(validateUpload(upload('skin.png', fixture('images/avatar-600.png')), 'skin')).toEqual({
      ok: false,
      message: "That's 600×600. Skins are 64×64.",
    });
    // PNG signature but no IHDR → not readable
    const noIhdr = new Uint8Array(PNG_MAGIC);
    expect(validateUpload(upload('skin.png', noIhdr), 'skin')).toEqual({
      ok: false,
      message: "That's not a readable PNG. Skins are 64×64.",
    });
  });
});

describe('pngDimensions / isSkinTexture (T-UNIT-19)', () => {
  it('T-UNIT-19 reads IHDR width/height; non-PNG and zero sizes → null', () => {
    expect(pngDimensions(fixture('images/avatar-600.png'))).toEqual({ width: 600, height: 600 });
    expect(pngDimensions(pngHead(64, 64))).toEqual({ width: 64, height: 64 });
    expect(pngDimensions(pngHead(0, 64))).toBeNull();
    expect(pngDimensions(JPEG_BYTES)).toBeNull();
    expect(pngDimensions(new Uint8Array(PNG_MAGIC))).toBeNull();
    expect(pngDimensions(new Uint8Array(0))).toBeNull();
    expect(isSkinTexture(pngHead(64, 64))).toBe(true);
    expect(isSkinTexture(pngHead(64, 65))).toBe(false);
    expect(isSkinTexture(fixture('images/tiny.jpg'))).toBe(false);
  });
});

describe('sanitizeFilename (T-UNIT-22, 04 SC-20)', () => {
  it.each([
    ['mod.jar', 'mod.jar'],
    ['My Mod v1.2.JAR', 'MyModv1.2.jar'],
    ['../../etc/passwd', 'etc-passwd'],
    ['..\\..\\win.ini', 'win.ini'],
    ['.hidden', 'hidden'],
    ['-----dash.zip', 'dash.zip'],
    ['a..b...c.zip', 'a.b.c.zip'],
    ['', 'file'],
    ['***', 'file'],
    ['über-cool.MRPACK', 'uber-cool.mrpack'],
    ['résumé.PNG', 'resume.png'],
  ])('sanitizeFilename(%j) → %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('caps the length at 120 and keeps the extension', () => {
    const out = sanitizeFilename(`${'a'.repeat(200)}.jar`);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith('.jar')).toBe(true);
    expect(sanitizeFilename('b'.repeat(300)).length).toBe(120);
  });

  it('output only ever contains [A-Za-z0-9._-], never a separator or `..`', () => {
    for (const input of ['a/b/c', 'a\\b', 'x y z', 'ß.png', '🙂.jpg', 'a..b', '.', '..']) {
      const out = sanitizeFilename(input);
      expect(out).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
      expect(out).not.toContain('..');
    }
  });
});
