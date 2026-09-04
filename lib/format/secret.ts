/**
 * lib/format/secret.ts — `maskSecret` (05 T-UNIT-25; 04 §1.3 `updateSettings` "`discord_webhook_tail`
 * (last 4 chars, `maskSecret`)"; 04 §3.6 F2 / 01 INV-43 "masked to `…<last 4>` in every admin view
 * and never logged"; ADR-0030 D12 — this file is its home).
 *
 * Pure, locale-free, client-importable (the `NotificationMatrix` island renders the masked
 * placeholder; `getAdminSettings()` / `updateSettings` return the tail, never the URL).
 *
 *   maskSecret('https://discord.com/api/webhooks/123/abcdefghij') → '…ghij'
 *   maskSecret('')  / maskSecret(null) / maskSecret(undefined)    → 'NOT SET'
 *   maskSecret('abc')                                            → '…abc'   (shorter than 4)
 */

/** The prefix every masked value carries — one character, so a tail never reads as the secret. */
export const MASK_PREFIX = '…';

/** The words shown for an unset secret (DESIGN.md §12.1 / `StatusPill` "NOT SET"). */
export const SECRET_NOT_SET = 'NOT SET';

/** How many trailing characters survive the mask (04 §1.3 "last 4"). */
export const SECRET_TAIL_LENGTH = 4;

/** The last `SECRET_TAIL_LENGTH` characters (the whole string when shorter), or `null` when unset. */
export function secretTail(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value.slice(-SECRET_TAIL_LENGTH);
}

/** `…<last 4>` for a set secret, `NOT SET` otherwise. */
export function maskSecret(value: string | null | undefined): string {
  const tail = secretTail(value);
  return tail === null ? SECRET_NOT_SET : `${MASK_PREFIX}${tail}`;
}
