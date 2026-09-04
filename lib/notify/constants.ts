/**
 * lib/notify/constants.ts — notification tunables + closed sets (04 §5.8 "constants in
 * `lib/notify/constants.ts`" — tunable without an ADR; 04 §3.6 F1, §3.7 N1/N2, §4.6, J-S;
 * ADR-0030 D3 `syncSourceSubjectId`; 01 §1 tree `lib/notify/{matrix,constants}.ts`).
 *
 * Client-safe on purpose: NO `server-only`, no Supabase, no zod, no `node:*` imports — the
 * `NotificationMatrix` island (03 §2.10) imports the kind/channel sets from here, so anything this
 * file pulls in ships to the browser. The v5 UUID needs SHA-1, so a small dependency-free SHA-1
 * lives at the bottom of this file (Web Crypto has no synchronous digest; `node:crypto` would break
 * the client bundle). 05 T-UNIT-27's sibling checks in `tests/unit/notify-matrix.test.ts` pin the
 * numbers and prove the hash against `node:crypto`.
 *
 * The *rules* these numbers serve (cadences, retry max 5, digest > 5, caps) are 04 §3.6/§3.7 and
 * ADR-R6 — changing a rule is an ADR; changing a default here is not (04 §5.8 heading).
 */

// ---- 04 §3.6 F1 — fan-out window + batch ----------------------------------------------------

/** F1: events older than this are never fanned out (`created_at > now() - FANOUT_WINDOW_DAYS`). */
export const FANOUT_WINDOW_DAYS = 7;

/** F1: events selected per tick, oldest first. */
export const FANOUT_BATCH = 500;

// ---- 04 §3.7 N1/N2 + §4.6 — deliver batch, caps, budget --------------------------------------

/** N1: eligible recipient rows claimed per tick. */
export const DELIVER_BATCH = 100;

/** §4.6: Discord webhook posts per tick (~30 req/min per webhook upstream). */
export const DISCORD_PER_TICK = 20;

/** Stop claiming new groups after this much wall-clock time (route `maxDuration` is 60 s — 02 §1.4). */
export const DELIVER_TIME_BUDGET_MS = 40_000;

/** N4: `status='failed'` when `attempts` reaches this (notifications.md "max 5"). */
export const MAX_ATTEMPTS = 5;

/** N2: a `(channel, address)` group with MORE than this many eligible rows becomes one digest. */
export const DIGEST_THRESHOLD = 5;

/** N1: first retry delay; doubles per attempt (`backoffMs`). */
export const BACKOFF_BASE_MS = 5 * 60_000;

/**
 * N1 `backoff(a) = 5 min × 2^(a−1)` → 5 / 10 / 20 / 40 / 80 min for attempts 1..5. `attempts`
 * below 1 is clamped to 1 (a row with `attempts = 0` is eligible at once and never calls this).
 */
export function backoffMs(attempts: number): number {
  const a = Math.max(1, Math.floor(attempts));
  return BACKOFF_BASE_MS * 2 ** (a - 1);
}

// ---- 04 J-S / ADR-0030 D3 — staleness ------------------------------------------------------

/** J-S: a source with no `sync_runs.ok = true` inside this window is stale; dedupe window too. */
export const STALE_WINDOW_HOURS = 6;

/**
 * J-S source set (`stats` daily, `notify` the emitter and `skins` script-only are excluded).
 * `curseforge` / `mentions` carry extra conditions (04 J-S footnotes; ADR-0030 D3).
 */
export const STALE_SOURCES = ['modrinth', 'youtube', 'curseforge', 'mentions'] as const;
export type StaleSource = (typeof STALE_SOURCES)[number];

/**
 * ADR-0030 D3: `sync.stale` events carry `subject_type = 'sync_source'` and a deterministic
 * name-based UUID as `subject_id` (the column is `uuid not null`). Fixed namespace — never change
 * it: the dedupe query compares stored ids with freshly computed ones.
 */
export const SYNC_SOURCE_NAMESPACE = '7f2b6c3e-8a41-5d09-9b7e-2c4f1a6d3e58';

/** RFC 4122 v5 UUID of `source` under `SYNC_SOURCE_NAMESPACE` (stable across processes/builds). */
export function syncSourceSubjectId(source: string): string {
  return uuidV5(SYNC_SOURCE_NAMESPACE, source);
}

// ---- Matrix / channel sets (04 §1.3, §3.6 F2; docs/notifications.md) -------------------------

/** The two v1 delivery channels (the enum also holds `inapp` / `push` for Phase 2). */
export const DELIVERY_CHANNELS = ['email', 'discord'] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/** 04 §1.3: the kinds `updateSettings` may write — the four switchable Settings rows. */
export const V1_MATRIX_KINDS = [
  'comment.new',
  'comment.held',
  'comment.reported',
  'sync.failed',
  'sync.stale',
] as const;
export type V1MatrixKind = (typeof V1_MATRIX_KINDS)[number];

/** The three greyed COMING LATER rows — seeded, displayed, never written by `updateSettings`. */
export const COMING_LATER_KINDS = ['mention.suggested', 'order.new', 'tip.new'] as const;
export type ComingLaterKind = (typeof COMING_LATER_KINDS)[number];

/** Every kind with a `notification_matrix` row (8 × 2 channels = the 16 seeded rows, SEED-2). */
export const MATRIX_KINDS = [...V1_MATRIX_KINDS, ...COMING_LATER_KINDS] as const;
export type MatrixKind = (typeof MATRIX_KINDS)[number];

const V1_SET: ReadonlySet<string> = new Set(V1_MATRIX_KINDS);
const MATRIX_SET: ReadonlySet<string> = new Set(MATRIX_KINDS);
const CHANNEL_SET: ReadonlySet<string> = new Set(DELIVERY_CHANNELS);

export function isV1MatrixKind(value: string): value is V1MatrixKind {
  return V1_SET.has(value);
}

export function isMatrixKind(value: string): value is MatrixKind {
  return MATRIX_SET.has(value);
}

export function isDeliveryChannel(value: string): value is DeliveryChannel {
  return CHANNEL_SET.has(value);
}

// ---- RFC 4122 v5 (name-based, SHA-1) — dependency-free, synchronous, browser-safe --------------

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error('uuidV5: namespace is not a UUID');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < 16; i += 1) hex += (bytes[i] ?? 0).toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * RFC 4122 §4.3: sha1(namespace ‖ name), first 16 bytes, version nibble 5, variant bits 10.
 * Exported for the node:crypto parity check in tests; app code calls `syncSourceSubjectId`.
 */
export function uuidV5(namespace: string, name: string): string {
  const ns = uuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns, 0);
  input.set(nameBytes, ns.length);
  const digest = sha1(input);
  const bytes = digest.slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

/** FIPS 180-4 SHA-1 over a byte array → 20-byte digest. Only used for the v5 UUID above. */
function sha1(message: Uint8Array): Uint8Array {
  const length = message.length;
  const padded = Math.ceil((length + 1 + 8) / 64) * 64;
  const block = new Uint8Array(padded);
  block.set(message);
  block[length] = 0x80;
  const view = new DataView(block.buffer);
  const bitLength = length * 8;
  view.setUint32(padded - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(padded - 4, bitLength >>> 0, false);

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let offset = 0; offset < padded; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i += 1) {
      w[i] = rotl((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0), 1);
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (rotl(a, 5) + (f >>> 0) + e + k + (w[i] ?? 0)) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const out = new Uint8Array(20);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, h0, false);
  outView.setUint32(4, h1, false);
  outView.setUint32(8, h2, false);
  outView.setUint32(12, h3, false);
  outView.setUint32(16, h4, false);
  return out;
}
