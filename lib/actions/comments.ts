'use server';
/**
 * lib/actions/comments.ts — `postComment`, `editComment`, `deleteComment`, `toggleLike`,
 * `reportComment`, `moderateComment`, `banUser`, `renameUserHandle` (04 §1.2 — every cell;
 * SC-02..SC-08, SC-15, SC-22, SC-24; 01 INV-66 / INV-69; ADR-0002 A2 / A3 / A4 / A6 / C7 / #64 /
 * #69 / #71 / #72; ADR-0013; ADR-0028 D2).
 *
 * Every action = `return runAction(name, schema, input, fn)` (never throws to the client). Order
 * inside each user-scoped `fn`: auth (`requireOnboarded` — banned answers `banned` first, SC-05)
 * → cheap validation (the B3 link rule) → I/O preconditions (target visible, comments enabled,
 * parent, comment status) → rate limit (`assertRateLimit`, right before the write — a call
 * rejected by a precondition records no hit; the limiter's own rejection does) → writes through
 * the RLS SERVER CLIENT (`createServerClient()` — the user's cookie session, so RLS + the DB
 * triggers are the second line of defence) → events (`lib/notify/emit.ts`) → `revalidateTag`.
 * Moderator actions (`moderateComment`, `banUser`, `renameUserHandle`, the non-author path of
 * `deleteComment`) call `requireRole('moderator')` first and only then write through the service
 * client (SC-06), logging the SC-24 keys-only audit line before `ok`.
 *
 * `postComment` inserts the `decideCommentStatus` status and returns the row AS STORED — the
 * BEFORE INSERT trigger `comments_set_status()` recomputes it (ADR-0002 #72), so the UI never shows
 * `published` for a held comment. `moderation_mode` is read from `site_settings_public` on the
 * RLS client (ADR-0002 A3), never from `site_settings`. `reportComment` inserts WITHOUT returning
 * (reporters cannot select `comment_reports` — the RETURNING would be refused by RLS) and treats
 * the unique-violation as the idempotent no-op 00 S1.4.AC9 asks for.
 *
 * Input schemas live in `./comments.schema.ts` (a `'use server'` module may export only async
 * functions — ADR-0013). `revalidateTag(tag, 'max')` per 04 SC-07 / 02 §5: the target tag
 * `project:<slug>` for post/edit/delete/moderate/like; nothing for report/ban/rename.
 */
import { revalidateTag } from 'next/cache';
import {
  banUserInput,
  deleteCommentInput,
  editCommentInput,
  moderateCommentInput,
  postCommentInput,
  renameUserHandleInput,
  reportCommentInput,
  toggleLikeInput,
  type BanUserInput,
  type DeleteCommentInput,
  type EditCommentInput,
  type ModerateCommentInput,
  type PostCommentInput,
  type RenameUserHandleInput,
  type ReportCommentInput,
  type ToggleLikeInput,
} from '@/lib/actions/comments.schema';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { runAction, type ActionContext } from '@/lib/actions/run';
import { getViewer, requireOnboarded, requireRole, type Profile } from '@/lib/auth';
import { avatarUrlFor, type CommentAuthor, type CommentView } from '@/lib/data/comments';
import { log } from '@/lib/log';
import { emit } from '@/lib/notify/emit';
import { assertRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import type { Database, Json } from '@/lib/supabase/types';
import {
  countLinks,
  LINE_BANNED,
  LINE_COMMENTS_CLOSED,
  LINE_EDIT_WINDOW,
  LINE_FORBIDDEN,
  LINE_NOT_FOUND,
  LINE_TOO_MANY_LINKS,
  MAX_LINKS,
  codePointLength,
} from '@/lib/validation/comment';
import {
  HANDLE_RESERVED,
  HANDLE_TAKEN,
  REASON_CHARSET,
  handleReason,
} from '@/lib/validation/handle';
import {
  decideCommentStatus,
  isWithinEditWindow,
  nextStatus,
  shouldAutoHold,
} from '@/lib/validation/moderation';

type CommentRow = Database['public']['Tables']['comments']['Row'];
type CommentStatus = Database['public']['Enums']['comment_status'];
type ServerClient = Awaited<ReturnType<typeof createServerClient>>;
type AdminClient = ReturnType<typeof createAdminClient>;

const NOT_FOUND_PROJECT = "That project doesn't exist.";
const OWN_REPORT = "You can't report your own comment.";
const NOT_FOUND_PROFILE = "That account doesn't exist.";
const CONFLICT_TRANSITION = 'That already happened.';

const UNIQUE_VIOLATION = '23505';
const RLS_VIOLATION = '42501';

/** 04 §1.2 excerpt length (code points of the plain body). */
const EXCERPT_LENGTH = 140;

const COMMENT_COLUMNS =
  'id, target_type, target_id, author_id, parent_id, body, status, like_count, edited_at, moderated_by, moderated_at, created_at, updated_at';

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

/** SC-24: keys-only audit line, logged before every `ok:true` return of a `requireRole` action. */
function logAdmin(
  action: string,
  ctx: ActionContext,
  actorId: string,
  target: { type: string; id: string | null },
  input: object,
): void {
  log.info({
    action,
    id: ctx.id,
    msg: 'admin',
    meta: {
      actor_profile_id: actorId,
      target_type: target.type,
      target_id: target.id,
      fields: Object.keys(input),
    },
  });
}

/** `excerpt(140)` — plain body, ≤ 140 code points INCLUDING the ellipsis (04 §1.2 payload; 05 T-ACT-15). */
function excerpt(body: string): string {
  if (codePointLength(body) <= EXCERPT_LENGTH) return body;
  return `${Array.from(body)
    .slice(0, EXCERPT_LENGTH - 1)
    .join('')}…`;
}

/** The tag every comment write revalidates (04 §1.2 "Target tag": project → `project:<slug>`). */
function revalidateTarget(slug: string | null): void {
  if (slug) revalidateTag(`project:${slug}`, 'max');
}

type VisibleProject = { id: string; slug: string; title: string };

/** A visible project (published, not hidden) through `projects_public`, or null (→ `not_found`). */
async function readVisibleProject(
  client: ServerClient | AdminClient,
  projectId: string,
): Promise<VisibleProject | null> {
  const { data, error } = await client
    .from('projects_public')
    .select('id, slug, title')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`projects_public read failed: ${error.code}`);
  if (!data || data.id === null || data.slug === null || data.title === null) return null;
  return { id: data.id, slug: data.slug, title: data.title };
}

/** The slug of a project by id through the service client (the target may be hidden by now). */
async function readProjectSlug(admin: AdminClient, projectId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`projects read failed: ${error.code}`);
  return data?.slug ?? null;
}

/**
 * 04 §1.2 "Comments enabled" = `coalesce(project_overrides.comments_enabled,
 * not site_settings.comments_closed_default)` — both readable on the RLS client (the override of a
 * visible project; the public settings view).
 */
async function projectCommentsEnabled(client: ServerClient, projectId: string): Promise<boolean> {
  const [override, settings] = await Promise.all([
    client
      .from('project_overrides')
      .select('comments_enabled')
      .eq('project_id', projectId)
      .maybeSingle(),
    client.from('site_settings_public').select('comments_closed_default').maybeSingle(),
  ]);
  if (override.error) throw new Error(`project_overrides read failed: ${override.error.code}`);
  if (settings.error) throw new Error(`site_settings_public read failed: ${settings.error.code}`);
  if (override.data && override.data.comments_enabled !== null)
    return override.data.comments_enabled;
  return !(settings.data?.comments_closed_default ?? false);
}

/** `site_settings_public.moderation_mode` on the RLS client (ADR-0002 A3). */
async function readModerationMode(client: ServerClient): Promise<'auto' | 'hold_first_time'> {
  const { data, error } = await client
    .from('site_settings_public')
    .select('moderation_mode')
    .maybeSingle();
  if (error) throw new Error(`site_settings_public read failed: ${error.code}`);
  return data?.moderation_mode ?? 'auto';
}

/** One comment by id under the caller's RLS (own rows of any status; others' published only). */
async function readComment(
  client: ServerClient | AdminClient,
  commentId: string,
): Promise<CommentRow | null> {
  const { data, error } = await client
    .from('comments')
    .select(COMMENT_COLUMNS)
    .eq('id', commentId)
    .maybeSingle();
  if (error) throw new Error(`comments read failed: ${error.code}`);
  return data;
}

/** The public identity of a profile (`public_profiles` — 01 INV-45), or null. */
async function readAuthor(
  client: ServerClient | AdminClient,
  profileId: string,
): Promise<CommentAuthor | null> {
  const { data, error } = await client
    .from('public_profiles')
    .select('id, handle, avatar_path, role')
    .eq('id', profileId)
    .maybeSingle();
  if (error) throw new Error(`public_profiles read failed: ${error.code}`);
  if (!data || data.id === null || data.handle === null || data.role === null) return null;
  return {
    id: data.id,
    handle: data.handle,
    avatarUrl: avatarUrlFor(data.avatar_path),
    role: data.role,
  };
}

/** Whether the viewer has liked `commentId` (own like rows are readable — T-RLS-79). */
async function likedBy(client: ServerClient, commentId: string, userId: string): Promise<boolean> {
  const { data, error } = await client
    .from('comment_likes')
    .select('comment_id')
    .eq('comment_id', commentId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`comment_likes read failed: ${error.code}`);
  return data !== null;
}

function authorOf(profile: Profile & { handle: string }): CommentAuthor {
  return {
    id: profile.id,
    handle: profile.handle,
    avatarUrl: avatarUrlFor(profile.avatar_path),
    role: profile.role,
  };
}

/** 04 §1.2 `CommentView` from a stored row (the author is the caller for post/edit). */
function toCommentView(
  row: CommentRow,
  author: CommentAuthor | null,
  likedByViewer: boolean,
): CommentView {
  return {
    id: row.id,
    body: row.body,
    status: row.status,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    parentId: row.parent_id,
    likeCount: row.like_count,
    likedByViewer,
    author,
  };
}

/** The B3 rule as an action result (04 §7 `too_many_links`). */
function tooManyLinks<T>(): ActionResult<T> {
  return fail<T>('too_many_links', LINE_TOO_MANY_LINKS, { field: 'body' });
}

/** The shared target keys of every comment event payload (04 §1.2 postComment Effects). */
function targetPayload(target: VisibleProject): Record<string, Json> {
  return {
    target_type: 'project',
    target_id: target.id,
    target_title: target.title,
    target_slug: target.slug,
  };
}

// ---------------------------------------------------------------------------------------------
// postComment — 04 §1.2
// ---------------------------------------------------------------------------------------------

export async function postComment(
  input: PostCommentInput,
): Promise<ActionResult<{ comment: CommentView }>> {
  return runAction('postComment', postCommentInput, input, async (data) => {
    const { user, profile } = await requireOnboarded();
    if (countLinks(data.body) > MAX_LINKS) return tooManyLinks();

    const supabase = await createServerClient();
    const target = await readVisibleProject(supabase, data.target_id);
    if (target === null) return fail('not_found', NOT_FOUND_PROJECT);
    if (!(await projectCommentsEnabled(supabase, target.id))) {
      return fail('comments_closed', LINE_COMMENTS_CLOSED);
    }

    // Replies: the parent must be a published comment on the same target; a reply to a reply is
    // stored under the root (one level — data-model §2.5). `@handle` is the client's prefix.
    let rootId: string | null = null;
    let parentAuthorId: string | null = null;
    if (data.parent_id !== undefined) {
      const parent = await readComment(supabase, data.parent_id);
      if (
        parent === null ||
        parent.target_type !== 'project' ||
        parent.target_id !== target.id ||
        parent.status !== 'published'
      ) {
        return fail('not_found', LINE_NOT_FOUND);
      }
      rootId = parent.parent_id ?? parent.id;
      parentAuthorId = parent.author_id;
    }

    await assertRateLimit('comment', user.id);
    await assertRateLimit('comment_day', user.id);

    const [mode, own] = await Promise.all([
      readModerationMode(supabase),
      supabase.from('profiles').select('comment_count').eq('id', user.id).single(),
    ]);
    if (own.error) throw new Error(`profiles read failed: ${own.error.code}`);
    const authorCommentCount = own.data.comment_count;
    const status = decideCommentStatus({
      mode,
      authorCommentCount,
      authorRole: profile.role,
    });

    // The trigger recomputes `status`; the row comes back as stored (ADR-0002 #72).
    const { data: stored, error } = await supabase
      .from('comments')
      .insert({
        target_type: 'project',
        target_id: target.id,
        author_id: user.id,
        parent_id: rootId,
        body: data.body,
        status,
      })
      .select(COMMENT_COLUMNS)
      .single();
    if (error) {
      // The RLS insert policy is the second line: `can_comment()` false = closed/hidden/banned
      // between the checks above and the write.
      if (error.code === RLS_VIOLATION) return fail('comments_closed', LINE_COMMENTS_CLOSED);
      throw new Error(`comments insert failed: ${error.code}`);
    }

    const held = stored.status === 'held';
    const author = authorOf(profile);
    await emit(held ? 'comment.held' : 'comment.new', {
      actorId: user.id,
      subjectType: 'comment',
      subjectId: stored.id,
      payload: {
        comment_id: stored.id,
        ...targetPayload(target),
        excerpt: excerpt(stored.body),
        author: { profile_id: user.id, handle: profile.handle },
        first_time: authorCommentCount === 0,
        ...(held ? { reason: 'first_time' } : {}),
      },
    });

    if (rootId !== null && !held && parentAuthorId !== null && parentAuthorId !== user.id) {
      const parentAuthor = await readAuthor(supabase, parentAuthorId);
      await emit('comment.reply', {
        actorId: user.id,
        subjectType: 'comment',
        subjectId: stored.id,
        payload: {
          comment_id: stored.id,
          parent_id: data.parent_id ?? rootId,
          root_id: rootId,
          ...targetPayload(target),
          excerpt: excerpt(stored.body),
          author: { profile_id: user.id, handle: profile.handle },
          parent_author: {
            profile_id: parentAuthorId,
            handle: parentAuthor?.handle ?? null,
          },
        },
      });
    }

    revalidateTarget(target.slug);
    return ok({ comment: toCommentView(stored, author, false) });
  });
}

// ---------------------------------------------------------------------------------------------
// editComment — 04 §1.2 (author only, 15-minute window, `edited_at` set here — no trigger)
// ---------------------------------------------------------------------------------------------

export async function editComment(
  input: EditCommentInput,
): Promise<ActionResult<{ comment: CommentView }>> {
  return runAction('editComment', editCommentInput, input, async (data) => {
    const { user, profile } = await requireOnboarded();
    const supabase = await createServerClient();

    const row = await readComment(supabase, data.comment_id);
    if (row === null) return fail('not_found', LINE_NOT_FOUND);
    if (row.author_id !== user.id) return fail('forbidden', LINE_FORBIDDEN);
    if (row.status !== 'published' && row.status !== 'held') {
      return fail('not_found', LINE_NOT_FOUND);
    }
    if (!isWithinEditWindow(row.created_at)) {
      return fail('edit_window_expired', LINE_EDIT_WINDOW);
    }
    if (countLinks(data.body) > MAX_LINKS) return tooManyLinks();

    await assertRateLimit('comment_edit', user.id);

    const { data: stored, error } = await supabase
      .from('comments')
      .update({ body: data.body, edited_at: new Date().toISOString() })
      .eq('id', row.id)
      .select(COMMENT_COLUMNS)
      .maybeSingle();
    if (error) {
      // `comments_guard()` closes the window on the DB clock (T-RLS-72).
      if (error.code === RLS_VIOLATION) return fail('edit_window_expired', LINE_EDIT_WINDOW);
      throw new Error(`comments update failed: ${error.code}`);
    }
    if (stored === null) return fail('not_found', LINE_NOT_FOUND);

    const [liked, slug] = await Promise.all([
      likedBy(supabase, stored.id, user.id),
      readProjectSlug(createAdminClient(), stored.target_id),
    ]);
    revalidateTarget(slug);
    return ok({ comment: toCommentView(stored, authorOf(profile), liked) });
  });
}

// ---------------------------------------------------------------------------------------------
// deleteComment — 04 §1.2 (author, no window — OR moderator on others' comments, ADR-0002 A6)
// ---------------------------------------------------------------------------------------------

export async function deleteComment(
  input: DeleteCommentInput,
): Promise<ActionResult<{ comment_id: string; status: 'deleted' }>> {
  return runAction('deleteComment', deleteCommentInput, input, async (data, ctx) => {
    const viewer = await getViewer();
    if (viewer === null) return fail('unauthenticated', 'Sign in first.');
    // SC-05: a banned or not-yet-onboarded caller is answered before any table is read (the
    // author path's `requireOnboarded()` below re-checks; the moderator path cannot be banned).
    if (viewer.profile?.is_banned) return fail('banned', LINE_BANNED);
    if (!viewer.profile?.handle) return fail('onboarding_required', 'Pick a handle first.');

    const supabase = await createServerClient();
    const row = await readComment(supabase, data.comment_id);
    if (row === null || row.status === 'deleted') return fail('not_found', LINE_NOT_FOUND);

    const admin = createAdminClient();
    if (row.author_id === viewer.user.id) {
      // Author path: the own soft delete under RLS (`comments_guard()` allows `deleted`).
      const { user } = await requireOnboarded();
      await assertRateLimit('comment_delete', user.id);
      const { data: updated, error } = await supabase
        .from('comments')
        .update({ status: 'deleted' })
        .eq('id', row.id)
        .select('id');
      if (error) {
        if (error.code === RLS_VIOLATION) return fail('banned', LINE_BANNED);
        throw new Error(`comments update failed: ${error.code}`);
      }
      if (updated.length === 0) return fail('not_found', LINE_NOT_FOUND);
    } else {
      // Moderator path (ADR-0002 A6): service client after the role check, audit fields set.
      const { user } = await requireRole('moderator');
      const { error } = await admin
        .from('comments')
        .update({
          status: 'deleted',
          moderated_by: user.id,
          moderated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .neq('status', 'deleted');
      if (error) throw new Error(`comments update failed: ${error.code}`);
      logAdmin('deleteComment', ctx, user.id, { type: 'comment', id: row.id }, data);
    }

    revalidateTarget(await readProjectSlug(admin, row.target_id));
    return ok({ comment_id: row.id, status: 'deleted' as const });
  });
}

// ---------------------------------------------------------------------------------------------
// toggleLike — 04 §1.2 (like_count by trigger; revalidates `project:<slug>` — ADR-0002 "Also")
// ---------------------------------------------------------------------------------------------

export async function toggleLike(
  input: ToggleLikeInput,
): Promise<ActionResult<{ liked: boolean; like_count: number }>> {
  return runAction('toggleLike', toggleLikeInput, input, async (data) => {
    const { user } = await requireOnboarded();
    const supabase = await createServerClient();

    const row = await readComment(supabase, data.comment_id);
    if (row === null || row.status !== 'published' || row.target_type !== 'project') {
      return fail('not_found', LINE_NOT_FOUND);
    }
    const target = await readVisibleProject(supabase, row.target_id);
    if (target === null) return fail('not_found', LINE_NOT_FOUND);

    await assertRateLimit('like', user.id);

    let liked: boolean;
    if (await likedBy(supabase, row.id, user.id)) {
      const { error } = await supabase
        .from('comment_likes')
        .delete()
        .eq('comment_id', row.id)
        .eq('user_id', user.id);
      if (error) throw new Error(`comment_likes delete failed: ${error.code}`);
      liked = false;
    } else {
      const { error } = await supabase
        .from('comment_likes')
        .insert({ comment_id: row.id, user_id: user.id });
      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          liked = true; // a concurrent like landed first — same end state
        } else if (error.code === RLS_VIOLATION) {
          return fail('not_found', LINE_NOT_FOUND);
        } else {
          throw new Error(`comment_likes insert failed: ${error.code}`);
        }
      } else {
        liked = true;
      }
    }

    const { data: after, error: countError } = await supabase
      .from('comments')
      .select('like_count')
      .eq('id', row.id)
      .single();
    if (countError) throw new Error(`comments read failed: ${countError.code}`);

    revalidateTarget(target.slug);
    return ok({ liked, like_count: after.like_count });
  });
}

// ---------------------------------------------------------------------------------------------
// reportComment — 04 §1.2 + §5.1 M6–M8 (idempotent per reporter; auto-hold at 3 — Q38)
// ---------------------------------------------------------------------------------------------

async function countUnresolvedReports(admin: AdminClient, commentId: string): Promise<number> {
  const { count, error } = await admin
    .from('comment_reports')
    .select('id', { count: 'exact', head: true })
    .eq('comment_id', commentId)
    .is('resolved_at', null);
  if (error) throw new Error(`comment_reports count failed: ${error.code}`);
  return count ?? 0;
}

export async function reportComment(
  input: ReportCommentInput,
): Promise<ActionResult<{ report_count: number }>> {
  return runAction('reportComment', reportCommentInput, input, async (data) => {
    const { user } = await requireOnboarded();
    const supabase = await createServerClient();

    const row = await readComment(supabase, data.comment_id);
    if (row === null || row.status === 'deleted' || row.target_type !== 'project') {
      return fail('not_found', LINE_NOT_FOUND);
    }
    if (row.author_id === user.id) {
      return fail('validation', OWN_REPORT, {
        field: 'comment_id',
        issues: [{ path: 'comment_id', message: OWN_REPORT }],
      });
    }
    const target = await readVisibleProject(supabase, row.target_id);
    if (target === null) return fail('not_found', LINE_NOT_FOUND);

    await assertRateLimit('report', user.id);

    // No RETURNING: reporters cannot select `comment_reports` (mods only — T-RLS-85), so the
    // insert asks for nothing back; the unique (comment_id, reporter_id) makes a repeat a no-op.
    const admin = createAdminClient();
    const { error } = await supabase.from('comment_reports').insert({
      comment_id: row.id,
      reporter_id: user.id,
      reason: data.reason,
      note: data.note ?? null,
    });
    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return ok({ report_count: await countUnresolvedReports(admin, row.id) });
      }
      if (error.code === RLS_VIOLATION) return fail('not_found', LINE_NOT_FOUND);
      throw new Error(`comment_reports insert failed: ${error.code}`);
    }

    const reportCount = await countUnresolvedReports(admin, row.id);
    const author = row.author_id !== null ? await readAuthor(admin, row.author_id) : null;
    const authorRole = author?.role ?? 'user';

    // M6: the third distinct report holds a published user comment (staff never — M7).
    if (row.status === 'published' && shouldAutoHold(reportCount, authorRole)) {
      const { data: held, error: holdError } = await admin
        .from('comments')
        .update({ status: 'held', moderated_by: null, moderated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'published')
        .select('id');
      if (holdError) throw new Error(`comments update failed: ${holdError.code}`);
      if (held.length > 0) {
        await emit('comment.held', {
          actorId: user.id,
          subjectType: 'comment',
          subjectId: row.id,
          payload: {
            comment_id: row.id,
            ...targetPayload(target),
            excerpt: excerpt(row.body),
            author: author ? { profile_id: author.id, handle: author.handle } : null,
            first_time: false,
            reason: 'reports',
            report_count: reportCount,
          },
        });
        revalidateTarget(target.slug);
      }
    }

    await emit('comment.reported', {
      actorId: user.id,
      subjectType: 'comment',
      subjectId: row.id,
      payload: {
        comment_id: row.id,
        report_count: reportCount,
        reason: data.reason,
        excerpt: excerpt(row.body),
        ...targetPayload(target),
        author: author ? { profile_id: author.id, handle: author.handle } : null,
      },
    });

    return ok({ report_count: reportCount });
  });
}

// ---------------------------------------------------------------------------------------------
// moderateComment — 04 §1.2 (moderator; approve | hide | unhide | delete)
// ---------------------------------------------------------------------------------------------

export async function moderateComment(
  input: ModerateCommentInput,
): Promise<ActionResult<{ comment_id: string; status: CommentStatus }>> {
  return runAction('moderateComment', moderateCommentInput, input, async (data, ctx) => {
    const { user } = await requireRole('moderator');
    const admin = createAdminClient();

    const row = await readComment(admin, data.comment_id);
    if (row === null) return fail('not_found', LINE_NOT_FOUND);
    const next = nextStatus(data.action, row.status);
    if (next === null) return fail('conflict', CONFLICT_TRANSITION);

    const now = new Date().toISOString();
    const { error } = await admin
      .from('comments')
      .update({ status: next, moderated_by: user.id, moderated_at: now })
      .eq('id', row.id);
    if (error) throw new Error(`comments update failed: ${error.code}`);

    if (data.action !== 'unhide') {
      const { error: resolveError } = await admin
        .from('comment_reports')
        .update({ resolved_at: now, resolved_by: user.id })
        .eq('comment_id', row.id)
        .is('resolved_at', null);
      if (resolveError) throw new Error(`comment_reports update failed: ${resolveError.code}`);
    }

    if (data.action === 'approve') {
      const author = row.author_id !== null ? await readAuthor(admin, row.author_id) : null;
      await emit('comment.approved', {
        actorId: user.id,
        subjectType: 'comment',
        subjectId: row.id,
        payload: {
          comment_id: row.id,
          author: author ? { profile_id: author.id, handle: author.handle } : null,
        },
      });
    }

    revalidateTarget(await readProjectSlug(admin, row.target_id));
    logAdmin('moderateComment', ctx, user.id, { type: 'comment', id: row.id }, data);
    return ok({ comment_id: row.id, status: next });
  });
}

// ---------------------------------------------------------------------------------------------
// banUser — 04 §1.2 (moderator; target role `user`, not self; no cascade — ADR-0002 #64)
// ---------------------------------------------------------------------------------------------

export async function banUser(
  input: BanUserInput,
): Promise<ActionResult<{ profile_id: string; is_banned: boolean }>> {
  return runAction('banUser', banUserInput, input, async (data, ctx) => {
    const { user } = await requireRole('moderator');
    if (data.profile_id === user.id) return fail('forbidden', LINE_FORBIDDEN);

    const admin = createAdminClient();
    const { data: target, error } = await admin
      .from('profiles')
      .select('id, role')
      .eq('id', data.profile_id)
      .maybeSingle();
    if (error) throw new Error(`profiles read failed: ${error.code}`);
    if (target === null) return fail('not_found', NOT_FOUND_PROFILE);
    if (target.role !== 'user') return fail('forbidden', LINE_FORBIDDEN);

    const { error: updateError } = await admin
      .from('profiles')
      .update({
        is_banned: data.banned,
        banned_reason: data.banned ? (data.reason ?? null) : null,
      })
      .eq('id', target.id);
    if (updateError) throw new Error(`profiles update failed: ${updateError.code}`);

    logAdmin('banUser', ctx, user.id, { type: 'profile', id: target.id }, data);
    return ok({ profile_id: target.id, is_banned: data.banned });
  });
}

// ---------------------------------------------------------------------------------------------
// renameUserHandle — 04 §1.2 (moderator; target role `user` unless actor is admin; H-rules)
// ---------------------------------------------------------------------------------------------

type HandleStatus = 'available' | 'taken' | 'reserved' | 'invalid';
const HANDLE_STATUSES: readonly HandleStatus[] = ['available', 'taken', 'reserved', 'invalid'];

export async function renameUserHandle(
  input: RenameUserHandleInput,
): Promise<ActionResult<{ profile_id: string; handle: string }>> {
  return runAction('renameUserHandle', renameUserHandleInput, input, async (data, ctx) => {
    const { user, profile: actor } = await requireRole('moderator');
    const admin = createAdminClient();

    const { data: target, error } = await admin
      .from('profiles')
      .select('id, role, handle')
      .eq('id', data.profile_id)
      .maybeSingle();
    if (error) throw new Error(`profiles read failed: ${error.code}`);
    if (target === null) return fail('not_found', NOT_FOUND_PROFILE);
    if (target.role !== 'user' && actor.role !== 'admin') return fail('forbidden', LINE_FORBIDDEN);

    // RPC `check_handle` on the caller's cookie client (granted to `authenticated`); "taken"
    // excludes the CALLER's own row, so a rename onto the moderator's own handle falls through to
    // the unique index below, which answers `handle_taken` all the same.
    const supabase = await createServerClient();
    const { data: verdict, error: rpcError } = await supabase.rpc('check_handle', {
      p_handle: data.handle,
    });
    if (rpcError) throw new Error(`check_handle failed: ${rpcError.code}`);
    if (typeof verdict !== 'string' || !(HANDLE_STATUSES as readonly string[]).includes(verdict)) {
      throw new Error('check_handle returned an unexpected value');
    }
    switch (verdict as HandleStatus) {
      case 'taken':
        return fail('handle_taken', HANDLE_TAKEN, { field: 'handle' });
      case 'reserved':
        return fail('handle_reserved', HANDLE_RESERVED, { field: 'handle' });
      case 'invalid': {
        const message = handleReason(data.handle) ?? REASON_CHARSET;
        return fail('validation', message, {
          field: 'handle',
          issues: [{ path: 'handle', message }],
        });
      }
      case 'available':
        break;
    }

    const { error: updateError } = await admin
      .from('profiles')
      .update({ handle: data.handle, handle_changed_at: new Date().toISOString() })
      .eq('id', target.id);
    if (updateError) {
      if (updateError.code === UNIQUE_VIOLATION) {
        return fail('handle_taken', HANDLE_TAKEN, { field: 'handle' });
      }
      throw new Error(`profiles update failed: ${updateError.code}`);
    }

    logAdmin('renameUserHandle', ctx, user.id, { type: 'profile', id: target.id }, data);
    return ok({ profile_id: target.id, handle: data.handle });
  });
}
