/**
 * lib/validation/moderation.ts — the pure moderation rules of 04 §1.2 / §5.1 (05 T-UNIT-6, 7, 8):
 * `decideCommentStatus` (status on insert, table M2–M5 — the DB trigger `comments_set_status()`
 * applies the same table and wins, ADR-0002 #72), `shouldAutoHold` (M6/M7, `AUTO_HOLD_REPORTS`
 * = 3 — Q38), `isWithinEditWindow` (`EDIT_WINDOW_MS` = 15 min, boundary exclusive) and the
 * `moderateComment` transition table (04 §1.2: approve `held → published`; hide
 * `published|held → hidden`; unhide `hidden → published`; delete any non-deleted → `deleted`).
 * Client-safe: no zod, no server imports (the comment islands read the edit window).
 */

export type ModerationMode = 'auto' | 'hold_first_time';
export type CommentStatus = 'published' | 'held' | 'hidden' | 'deleted';
export type AuthorRole = 'user' | 'moderator' | 'admin';
export type ModerateAction = 'approve' | 'hide' | 'unhide' | 'delete';

/** Q38 / 04 §1.2 reportComment: unresolved reports that auto-hold a published comment. */
export const AUTO_HOLD_REPORTS = 3;

/** 04 §1.2 editComment: `created_at > now() - 15 min`, boundary exclusive. */
export const EDIT_WINDOW_MS = 900_000;

function isStaff(role: AuthorRole): boolean {
  return role === 'moderator' || role === 'admin';
}

/** 04 §5.1 M2–M5: staff are never held; `hold_first_time` + `comment_count = 0` → held. */
export function decideCommentStatus(input: {
  mode: ModerationMode;
  authorCommentCount: number;
  authorRole: AuthorRole;
}): 'published' | 'held' {
  if (isStaff(input.authorRole)) return 'published';
  if (input.mode === 'hold_first_time' && input.authorCommentCount === 0) return 'held';
  return 'published';
}

/** 04 §5.1 M6/M7: ≥ 3 unresolved reports hold a user's comment; staff comments never auto-hold. */
export function shouldAutoHold(reportCount: number, authorRole: AuthorRole): boolean {
  if (isStaff(authorRole)) return false;
  return reportCount >= AUTO_HOLD_REPORTS;
}

/** True strictly inside the window: 14:59 → true, 15:00 → false, 15:01 → false (05 T-UNIT-8). */
export function isWithinEditWindow(
  createdAt: string | number | Date,
  now: number | Date = Date.now(),
): boolean {
  const created = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  const ref = now instanceof Date ? now.getTime() : now;
  if (Number.isNaN(created)) return false;
  return ref - created < EDIT_WINDOW_MS;
}

/** 04 §1.2 moderateComment transitions — `from` statuses per action. */
export const MODERATION_TRANSITIONS: Readonly<
  Record<ModerateAction, { from: readonly CommentStatus[]; to: CommentStatus }>
> = {
  approve: { from: ['held'], to: 'published' },
  hide: { from: ['published', 'held'], to: 'hidden' },
  unhide: { from: ['hidden'], to: 'published' },
  delete: { from: ['published', 'held', 'hidden'], to: 'deleted' },
};

/** The status after `action` from `current`, or `null` for an illegal transition (→ `conflict`). */
export function nextStatus(action: ModerateAction, current: CommentStatus): CommentStatus | null {
  const rule = MODERATION_TRANSITIONS[action];
  return rule.from.includes(current) ? rule.to : null;
}
