/**
 * tests/unit/hash.test.ts — T-UNIT-23: `lib/hash.ts` (04 SC-17; 01 INV-50; ADR-0002 C13 / A14; ADR-0012).
 * Every keyed hash is HMAC-SHA256 keyed by `HASH_SECRET`, hex (64 chars). The module reads the secret
 * through `lib/env.ts` at import, so each secret under test is loaded with `vi.resetModules()` +
 * `process.env.HASH_SECRET` + a dynamic import (`server-only` is mocked by tests/helpers/setup.unit.ts).
 * Secrets here are obviously fake placeholders; the grep rule (INV-50) is asserted with a small fs walk.
 * `createHmac` is used HERE only to state the SC-17 formula independently of the module under test.
 */
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { REPO_ROOT } from '../helpers/envTest';

type HashModule = typeof import('@/lib/hash');

const SECRET_A = 'unit-secret-a-0123456789abcdef0123456789abcdef';
const SECRET_B = 'unit-secret-b-fedcba9876543210fedcba9876543210';
const ORIGINAL_SECRET = process.env.HASH_SECRET;

const HEX64 = /^[0-9a-f]{64}$/;

async function loadWithSecret(secret: string): Promise<HashModule> {
  process.env.HASH_SECRET = secret;
  vi.resetModules();
  return import('@/lib/hash');
}

const hmac = (secret: string, input: string): string =>
  createHmac('sha256', secret).update(input).digest('hex');

afterEach(() => {
  process.env.HASH_SECRET = ORIGINAL_SECRET;
});

afterAll(() => {
  process.env.HASH_SECRET = ORIGINAL_SECRET;
  vi.resetModules();
});

describe('lib/hash.ts (T-UNIT-23)', () => {
  it('T-UNIT-23 utcDay is the UTC calendar date YYYY-MM-DD', async () => {
    const { utcDay } = await loadWithSecret(SECRET_A);
    expect(utcDay(new Date('2026-08-20T23:59:59Z'))).toBe('2026-08-20');
    expect(utcDay(new Date('2026-08-21T00:00:01Z'))).toBe('2026-08-21');
    expect(utcDay(new Date('2026-08-20T22:30:00-05:00'))).toBe('2026-08-21'); // UTC, not local
    expect(utcDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('T-UNIT-23 ipHash = HMAC-SHA256(HASH_SECRET, `${ip}|${utcDay}`) → 64 hex', async () => {
    const { ipHash } = await loadWithSecret(SECRET_A);
    const at = new Date('2026-08-20T12:00:00Z');
    const out = ipHash('203.0.113.7', at);
    expect(out).toMatch(HEX64);
    expect(out).toBe(hmac(SECRET_A, '203.0.113.7|2026-08-20'));
    expect(ipHash('2001:db8::1', at)).toBe(hmac(SECRET_A, '2001:db8::1|2026-08-20'));
    // deterministic within the day
    expect(ipHash('203.0.113.7', new Date('2026-08-20T23:59:59Z'))).toBe(out);
    // default `now` = today
    expect(ipHash('203.0.113.7')).toMatch(HEX64);
  });

  it('T-UNIT-23 the same ip on two UTC days hashes differently (daily rotation)', async () => {
    const { ipHash } = await loadWithSecret(SECRET_A);
    const day1 = ipHash('203.0.113.7', new Date('2026-08-20T23:59:59Z'));
    const day2 = ipHash('203.0.113.7', new Date('2026-08-21T00:00:00Z'));
    expect(day1).not.toBe(day2);
    // and two ips on the same day differ
    expect(ipHash('203.0.113.8', new Date('2026-08-20T12:00:00Z'))).not.toBe(day1);
  });

  it('T-UNIT-23 uaHash = HMAC-SHA256(HASH_SECRET, ua) → 64 hex', async () => {
    const { uaHash } = await loadWithSecret(SECRET_A);
    const ua = 'Mozilla/5.0 (test) odsens-unit/1.0';
    expect(uaHash(ua)).toMatch(HEX64);
    expect(uaHash(ua)).toBe(hmac(SECRET_A, ua));
    expect(uaHash(ua)).toBe(uaHash(ua));
    expect(uaHash(`${ua} `)).not.toBe(uaHash(ua)); // no normalisation for UA
  });

  it('T-UNIT-23 emailHash trims + lowercases, then HMAC-SHA256(HASH_SECRET, …)', async () => {
    const { emailHash } = await loadWithSecret(SECRET_A);
    const out = emailHash('  Allay@ODSENS.com ');
    expect(out).toMatch(HEX64);
    expect(out).toBe(hmac(SECRET_A, 'allay@odsens.com'));
    expect(emailHash('allay@odsens.com')).toBe(out);
    expect(emailHash('\tALLAY@odsens.COM\n')).toBe(out);
    expect(emailHash('seed-user@localhost.test')).toBe(hmac(SECRET_A, 'seed-user@localhost.test'));
    expect(emailHash('seed-user@localhost.test')).not.toBe(out);
    // Never the unkeyed sha256 of the email (ADR-0002 C13: keyed, not plain)
    expect(out).not.toBe(createHmac('sha256', '').update('allay@odsens.com').digest('hex'));
  });

  it('T-UNIT-23 a different HASH_SECRET changes every keyed output', async () => {
    const at = new Date('2026-08-20T12:00:00Z');
    const a = await loadWithSecret(SECRET_A);
    const ip1 = a.ipHash('203.0.113.7', at);
    const ua1 = a.uaHash('ua-x');
    const em1 = a.emailHash('allay@odsens.com');
    const sha1 = a.sha256Hex(new TextEncoder().encode('abc'));

    const b = await loadWithSecret(SECRET_B);
    expect(b.ipHash('203.0.113.7', at)).not.toBe(ip1);
    expect(b.uaHash('ua-x')).not.toBe(ua1);
    expect(b.emailHash('allay@odsens.com')).not.toBe(em1);
    expect(b.ipHash('203.0.113.7', at)).toBe(hmac(SECRET_B, '203.0.113.7|2026-08-20'));
    expect(b.emailHash('allay@odsens.com')).toBe(hmac(SECRET_B, 'allay@odsens.com'));
    // the content hash is unkeyed and therefore identical under both secrets
    expect(b.sha256Hex(new TextEncoder().encode('abc'))).toBe(sha1);
  });

  it('T-UNIT-23 no output equals or contains its raw input', async () => {
    const { ipHash, uaHash, emailHash } = await loadWithSecret(SECRET_A);
    const at = new Date('2026-08-20T12:00:00Z');
    const cases: Array<[string, string]> = [
      ['203.0.113.7', ipHash('203.0.113.7', at)],
      ['2001:db8::1', ipHash('2001:db8::1', at)],
      ['odsens-unit/1.0', uaHash('odsens-unit/1.0')],
      ['allay@odsens.com', emailHash('allay@odsens.com')],
      ['seed-user@localhost.test', emailHash(' Seed-User@localhost.test ')],
    ];
    for (const [raw, out] of cases) {
      expect(out).toMatch(HEX64);
      expect(out).not.toBe(raw);
      expect(out).not.toContain(raw);
      expect(out).not.toContain(raw.toLowerCase());
      expect(out).not.toContain(SECRET_A);
    }
  });

  it('T-UNIT-23 sha256Hex is plain SHA-256 of the bytes (storage {hash16} source, 04 SC-21)', async () => {
    const { sha256Hex } = await loadWithSecret(SECRET_A);
    expect(sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex(new TextEncoder().encode('abc')).slice(0, 16)).toBe('ba7816bf8f01cfea');
  });

  it('T-UNIT-23 the module refuses to load without a ≥ 32-char HASH_SECRET (ADR-0012)', async () => {
    await expect(loadWithSecret('x'.repeat(31))).rejects.toThrow(
      /Missing required environment variables: .*HASH_SECRET/,
    );
    // 32 is the floor
    const ok = await loadWithSecret('y'.repeat(32));
    expect(ok.uaHash('x')).toMatch(HEX64);
  });
});

// ---------------------------------------------------------------------------------------------
// INV-50 grep rule — `createHash` / `createHmac` live in lib/hash.ts only; `HASH_SECRET` is read in
// lib/env.ts + lib/hash.ts only. Same scope as the 01 INV-50 gate command (`lib app`, plus
// components/ and proxy.ts, which are also app code).
// ---------------------------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry)) out.push(full);
  }
  return out;
}

function appSourceFiles(): string[] {
  const files = [
    ...walk(path.join(REPO_ROOT, 'lib')),
    ...walk(path.join(REPO_ROOT, 'app')),
    ...walk(path.join(REPO_ROOT, 'components')),
  ];
  const proxy = path.join(REPO_ROOT, 'proxy.ts');
  if (existsSync(proxy)) files.push(proxy);
  return files;
}

const rel = (file: string): string => path.relative(REPO_ROOT, file).split(path.sep).join('/');

describe('INV-50 hashing lives in lib/hash.ts only (T-UNIT-23)', () => {
  it('T-UNIT-23 createHash / createHmac appear in no app file other than lib/hash.ts', () => {
    const offenders = appSourceFiles()
      .filter((file) => /\bcreate(Hash|Hmac)\b/.test(readFileSync(file, 'utf8')))
      .map(rel)
      .filter((file) => file !== 'lib/hash.ts');
    expect(offenders).toEqual([]);
    // and lib/hash.ts really is the home
    expect(readFileSync(path.join(REPO_ROOT, 'lib', 'hash.ts'), 'utf8')).toMatch(/createHmac/);
  });

  it('T-UNIT-23 HASH_SECRET is read only by lib/env.ts and lib/hash.ts (01 INV-50 gate grep)', () => {
    const readers = walk(path.join(REPO_ROOT, 'lib'))
      .filter((file) => /\bHASH_SECRET\b/.test(readFileSync(file, 'utf8')))
      .map(rel)
      .sort();
    expect(readers).toEqual(['lib/env.ts', 'lib/hash.ts']);
  });

  it('T-UNIT-23 lib/hash.ts is server-only (the secret never reaches a client bundle)', () => {
    const source = readFileSync(path.join(REPO_ROOT, 'lib', 'hash.ts'), 'utf8');
    expect(source).toMatch(/^import 'server-only';$/m);
  });
});
