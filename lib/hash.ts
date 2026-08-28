/**
 * lib/hash.ts — the one hashing module (04 SC-17; 01 INV-50; ADR-0002 C13 / A14; ADR-0012).
 *
 * Every keyed hash is HMAC-SHA256 keyed by `HASH_SECRET` (boot-required from S1.1, ≥ 32 chars),
 * hex-encoded (64 chars). Raw IP / UA / email are never stored or logged — callers hash first.
 *
 * - `ipHash(ip)`       = HMAC(`${ip}|${utcDay}`)      — rotates daily, so no long-lived visitor id
 * - `uaHash(ua)`       = HMAC(ua)
 * - `emailHash(email)` = HMAC(email.trim().toLowerCase()) — written to `profiles.email_hash` by
 *                        `/auth/callback` A3a (the DB trigger cannot read env); Ko-fi matching (S2.1)
 *                        uses the same function so the two sides agree.
 * - `sha256Hex(bytes)` — plain content hash for storage paths (`{hash16}` = first 16 hex, 04 SC-21).
 *   Lives here so `createHash`/`createHmac` appear in this file only (INV-50 grep).
 *
 * `import 'server-only'` — `HASH_SECRET` must never reach a client bundle (01 INV-29).
 */
import 'server-only';
import { createHash, createHmac } from 'node:crypto';
import { env } from '@/lib/env';

function hmacHex(input: string): string {
  return createHmac('sha256', env.HASH_SECRET).update(input).digest('hex');
}

/** UTC calendar day `YYYY-MM-DD` that scopes `ipHash` (04 SC-14). */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Daily-rotating visitor hash for `project_downloads.ip_hash` and the `download` rate-limit key. */
export function ipHash(ip: string, now: Date = new Date()): string {
  return hmacHex(`${ip}|${utcDay(now)}`);
}

/** Keyed hash of a User-Agent string for `project_downloads.ua_hash`. */
export function uaHash(ua: string): string {
  return hmacHex(ua);
}

/** Keyed hash of a normalised email (trim + lowercase). The email itself never leaves the caller. */
export function emailHash(email: string): string {
  return hmacHex(email.trim().toLowerCase());
}

/** Unkeyed SHA-256 hex of content bytes — storage path `{hash}` segments only (04 SC-21). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Unkeyed SHA-512 hex of content bytes — `project_files.sha512` (04 §1.4 `uploadProjectFile`). */
export function sha512Hex(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('hex');
}
