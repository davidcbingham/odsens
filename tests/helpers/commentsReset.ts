/**
 * tests/helpers/commentsReset.ts — service-client arrange / inspect / restore helpers for the S1.4
 * comment flows (05 §1.3 "service = arrange state and inspect it", H-1 `mutatesSeed` restore; SEED-9).
 * Never used to assert a policy. Playwright-safe: no `import.meta`, no Vitest imports — the e2e specs
 * and the db lane may both import it.
 *
 *   readCommentRow(id)                     → the `comments` row (RLS bypass) or null
 *   commentIdsBy(authorId, since?)         → ids of that author's comments on pixel-chameleon (…0102)
 *                                            created at/after `since` — to `trackComment` rows posted
 *                                            through the UI, or to assert what a flow stored
 *   deleteCommentsBy(authorId, since?)     → hard-deletes them (replies, likes and reports cascade)
 *   deleteNonSeedComments()                → every comment on pixel-chameleon that is not a SEED-9 row
 *                                            (the seed-thread restore; a failed run's leftovers included)
 *   deleteLike(commentId, userId)          → one `comment_likes` row (0 rows is a no-op)
 *   deleteReport(commentId, reporterId)    → one `comment_reports` row (0 rows is a no-op)
 *   countReports(commentId, reporterId?)   → `comment_reports` rows on a comment (one reporter or all)
 *   restoreSeedHeldComment()               → SEED-9 `…0203` back to `held`, `moderated_by/at` NULL
 *   setModerationMode(mode)                → `site_settings.moderation_mode` (restore `'auto'` in afterAll)
 */
import { asRole, loose } from './asRole';
import { SEED_COMMENTS, SEED_PROJECTS } from './seedIds';

export type CommentRowView = {
  id: string;
  status: 'published' | 'held' | 'hidden' | 'deleted';
  body: string;
  parent_id: string | null;
  author_id: string | null;
  like_count: number;
  edited_at: string | null;
  moderated_by: string | null;
  moderated_at: string | null;
  created_at: string;
};

export type ModerationMode = 'auto' | 'hold_first_time';

const COLUMNS =
  'id, status, body, parent_id, author_id, like_count, edited_at, moderated_by, moderated_at, created_at';

export async function readCommentRow(id: string): Promise<CommentRowView | null> {
  const { data, error } = await loose(asRole('service'))
    .from('comments')
    .select(COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`readCommentRow(${id}): ${error.message}`);
  return (data as CommentRowView | null) ?? null;
}

export async function commentIdsBy(
  authorId: string,
  since?: string,
  targetId: string = SEED_PROJECTS.pixelChameleon,
): Promise<string[]> {
  let query = loose(asRole('service'))
    .from('comments')
    .select('id')
    .eq('author_id', authorId)
    .eq('target_id', targetId)
    .order('created_at', { ascending: true });
  if (since !== undefined) query = query.gte('created_at', since);
  const { data, error } = await query;
  if (error) throw new Error(`commentIdsBy(${authorId}): ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

/** Returns the number of rows removed. */
export async function deleteCommentsBy(
  authorId: string,
  since?: string,
  targetId: string = SEED_PROJECTS.pixelChameleon,
): Promise<number> {
  const ids = await commentIdsBy(authorId, since, targetId);
  if (ids.length === 0) return 0;
  const { error } = await loose(asRole('service')).from('comments').delete().in('id', ids);
  if (error) throw new Error(`deleteCommentsBy(${authorId}): ${error.message}`);
  return ids.length;
}

/**
 * Removes every comment on `targetId` whose id is not one of the five SEED-9 rows — this file's
 * posts, factory rows, and the author-less orphans a failed run leaves behind (`author_id` is set
 * NULL when a factory user is deleted before its comment was tracked). Returns the number removed.
 */
export async function deleteNonSeedComments(
  targetId: string = SEED_PROJECTS.pixelChameleon,
): Promise<number> {
  const seedIds = Object.values(SEED_COMMENTS);
  const { data, error } = await loose(asRole('service'))
    .from('comments')
    .select('id')
    .eq('target_id', targetId);
  if (error) throw new Error(`deleteNonSeedComments: read failed: ${error.message}`);
  const extras = ((data ?? []) as { id: string }[])
    .map((row) => row.id)
    .filter((id) => !seedIds.includes(id));
  if (extras.length === 0) return 0;
  const { error: deleteError } = await loose(asRole('service'))
    .from('comments')
    .delete()
    .in('id', extras);
  if (deleteError) throw new Error(`deleteNonSeedComments: delete failed: ${deleteError.message}`);
  return extras.length;
}

export async function deleteLike(commentId: string, userId: string): Promise<void> {
  const { error } = await loose(asRole('service'))
    .from('comment_likes')
    .delete()
    .eq('comment_id', commentId)
    .eq('user_id', userId);
  if (error) throw new Error(`deleteLike(${commentId}, ${userId}): ${error.message}`);
}

export async function deleteReport(commentId: string, reporterId: string): Promise<void> {
  const { error } = await loose(asRole('service'))
    .from('comment_reports')
    .delete()
    .eq('comment_id', commentId)
    .eq('reporter_id', reporterId);
  if (error) throw new Error(`deleteReport(${commentId}, ${reporterId}): ${error.message}`);
}

export async function countReports(commentId: string, reporterId?: string): Promise<number> {
  let query = loose(asRole('service'))
    .from('comment_reports')
    .select('id', { count: 'exact', head: true })
    .eq('comment_id', commentId);
  if (reporterId !== undefined) query = query.eq('reporter_id', reporterId);
  const { count, error } = await query;
  if (error) throw new Error(`countReports(${commentId}): ${error.message}`);
  return count ?? 0;
}

/** SEED-9 `…0203` (seed_user2's first comment) back to its documented shape. */
export async function restoreSeedHeldComment(): Promise<void> {
  const { error } = await loose(asRole('service'))
    .from('comments')
    .update({ status: 'held', moderated_by: null, moderated_at: null })
    .eq('id', SEED_COMMENTS.held);
  if (error) throw new Error(`restoreSeedHeldComment: ${error.message}`);
}

/** `site_settings.moderation_mode` — the one-row table (id 1); the seed value is `'auto'`. */
export async function setModerationMode(mode: ModerationMode): Promise<void> {
  const { error } = await loose(asRole('service'))
    .from('site_settings')
    .update({ moderation_mode: mode })
    .eq('id', 1);
  if (error) throw new Error(`setModerationMode(${mode}): ${error.message}`);
}
