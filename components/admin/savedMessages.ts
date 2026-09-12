/**
 * components/admin/savedMessages.ts — the `?saved=<key>` vocabulary of the admin PRG round-trip
 * (ADR-0038 D1). A plain module (no directive) so the server pages can validate the query key and
 * the `SavedToast` island can read the message: a client file's helpers cannot be called from a
 * Server Component.
 */
export const SAVED_MESSAGES = {
  saved: 'Saved.',
  created: 'Project created.',
  uploaded: 'Uploaded.',
  removed: 'Removed.',
} as const;

export type SavedMessageKey = keyof typeof SAVED_MESSAGES;

export function isSavedMessageKey(value: unknown): value is SavedMessageKey {
  return typeof value === 'string' && Object.hasOwn(SAVED_MESSAGES, value);
}
