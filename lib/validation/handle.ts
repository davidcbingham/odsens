/**
 * lib/validation/handle.ts — handle rules H1 + H3 (04 §1.1; 01 INV-49; ADR-0002 #63).
 *
 * Plain, client-safe module — NO zod import (ADR-0008 Decision 3: zod stays server-only; this file is
 * reached from the `HandleField` client island, so anything it imports ships to the browser).
 * `HandleField` uses `handleReason()` for instant feedback while typing; the server truth is the SQL
 * RPC `check_handle` (H1 regex + the same reserved list + H2 citext uniqueness), which the
 * `checkHandle` action calls. The two lists MUST stay identical — 05 T-UNIT-2 (list) and T-ACT-7
 * (SQL parity) assert it. Validation is structural only: no "looks like a real name" heuristic
 * (Q34 / DESIGN.md §12.5).
 *
 * The zod form (`handleSchema`, T-UNIT-1) lives server-side in `lib/actions/accounts.schema.ts` and
 * is built on `validateHandle()` below, so the messages have one source of truth.
 *
 * Copy (DESIGN.md §11.1, plain words — never "invalid input"):
 *   resting helper  "3–20 characters. Letters, numbers, underscore."
 *   available       "That one's free."      taken  "That one's taken."
 */

/** H1 — structural rule; `@`, spaces, dots and email-likes fail by construction. */
export const HANDLE_RE = /^[A-Za-z0-9_]{3,20}$/;

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;

/** H3 — 04 §1.1 order, 22 entries (ADR-0002 #63). Mirrored verbatim inside SQL `check_handle`. */
export const RESERVED_HANDLES = [
  'admin',
  'administrator',
  'oddsense',
  'odsens',
  'moderator',
  'mod',
  'mods',
  'root',
  'system',
  'support',
  'allay',
  'api',
  'staff',
  'help',
  'null',
  'undefined',
  'anonymous',
  'deleted',
  'me',
  'you',
  'everyone',
  'here',
] as const;

const RESERVED_SET: ReadonlySet<string> = new Set<string>(RESERVED_HANDLES);

/** Helper text shown while the field is resting (DESIGN.md §11.1). */
export const HANDLE_HELPER = '3–20 characters. Letters, numbers, underscore.';
export const HANDLE_AVAILABLE = "That one's free.";
export const HANDLE_TAKEN = "That one's taken.";
export const HANDLE_RESERVED = "That one's reserved.";

export const REASON_TOO_SHORT = 'Too short. 3 characters minimum.';
export const REASON_TOO_LONG = 'Too long. 20 characters maximum.';
export const REASON_AT_SIGN = 'No @ — we add it.';
export const REASON_CHARSET = 'Letters, numbers and underscore only.';

/** Result of `validateHandle` — `reason` is the plain-words copy shown under the field. */
export type HandleCheck = { ok: true } | { ok: false; reason: string };

/** Case-insensitive membership in `RESERVED_HANDLES`. */
export function isReserved(handle: string): boolean {
  return RESERVED_SET.has(handle.toLowerCase());
}

/**
 * The plain-words reason a handle fails H1/H3, or `null` when it passes both. Checked in order:
 * `@` present → too short → too long → charset → reserved. Uniqueness (H2) is the server's call.
 */
export function handleReason(value: string): string | null {
  if (value.includes('@')) return REASON_AT_SIGN;
  if (value.length < HANDLE_MIN) return REASON_TOO_SHORT;
  if (value.length > HANDLE_MAX) return REASON_TOO_LONG;
  if (!HANDLE_RE.test(value)) return REASON_CHARSET;
  if (isReserved(value)) return HANDLE_RESERVED;
  return null;
}

/**
 * Pure H1 + H3 check with the same reasons as `handleReason` in a discriminated shape — what the
 * server-side `handleSchema` (lib/actions/accounts.schema.ts) refines on. Not uniqueness.
 */
export function validateHandle(value: string): HandleCheck {
  const reason = handleReason(value);
  return reason === null ? { ok: true } : { ok: false, reason };
}

/** True when `value` passes H1 and H3 (not uniqueness). */
export function isValidHandle(value: string): boolean {
  return handleReason(value) === null;
}
