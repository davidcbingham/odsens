'use client';

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import type { Viewer } from '@/components/accounts/ViewerProvider';
import { Composer, type ComposerPending } from '@/components/comments/Composer';
import { HeldNotice } from '@/components/comments/HeldNotice';
import { LikeButton } from '@/components/comments/LikeButton';
import { ModActionRow, type ModActionResult } from '@/components/comments/ModActionRow';
import { ReportPicker } from '@/components/comments/ReportPicker';
import { Avatar } from '@/components/primitives/Avatar';
import { Button } from '@/components/primitives/Button';
import { InlineConfirm } from '@/components/primitives/InlineConfirm';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { StatusPill } from '@/components/primitives/StatusPill';
import { deleteComment, editComment } from '@/lib/actions/comments';
import { fail, type ActionResult } from '@/lib/actions/result';
import type { CommentTarget, CommentView } from '@/lib/data/comments';
import { relativeTime } from '@/lib/format/date';
import { commentErrorLine, linkify, normalizeBody, validateBody } from '@/lib/validation/comment';
import { EDIT_WINDOW_MS, isWithinEditWindow } from '@/lib/validation/moderation';
import styles from './Comment.module.css';

/**
 * Comment — DESIGN.md §5 Comment bubble, §11.1 MOD / CREATOR tags, §11.2 own / hidden / deleted /
 * edited / editing / report states; 03 §2.4 `Comment` (one client file — not split, ADR-0002 #57);
 * 00 S1.4.AC5–AC8, AC12. Client island (03 C-16a) for the inline UI: edit mode
 * (`useActionState(editComment)`), delete (`InlineConfirm` "Delete this comment?" → Delete it /
 * Keep it, `startTransition(deleteComment)`), report (`ReportPicker`), reply (`Composer` under the
 * comment with `parentId` = the ROOT id and `replyToHandle` for depth-1 targets — the `@handle`
 * prefix, data-model §2.5). Everything arrives as props from `CommentThread` (03 C-17); results go
 * back up through the additive callbacks (03 C-03) so the merged list is patched in place.
 *
 * `data-state` (03 §3): `published` (40px `Avatar border=2`, handle 14px 700 + `<time>` relative
 * `--mute-dim` [+ "· edited"], `CREATOR` gold tag when `author.id === ownerProfileId` (ADR-0002
 * #55), `MOD` indigo-wash tag for moderator/admin authors, `--slab-raised` bubble with 2px
 * `--line`, actions row `LikeButton` · ghost Reply · own → Edit (inside the 15-minute window —
 * `isWithinEditWindow`, client clock; the ghost drops at 15:00) + Delete · others → Report; all
 * inline ghosts `arrow={false}`) · `held` (author: `HeldNotice` inside the dashed `--gold-deep`
 * bubble; moderator: the dashed bubble + `StatusPill first-comment` when `isFirstComment` + the
 * `ModActionRow` the thread asks for) · `hidden` ("Hidden by a moderator." sunk slot — no handle,
 * body or actions) · `deleted` ("Deleted." slot; the replies `children` keep their indent) ·
 * `editing` (bubble → `--indigo-lift` textarea "Edit comment", SAVE primary + Cancel ghost).
 * Flags: `data-own` · `data-creator` · `data-mod` · `data-depth="0|1"`; a pending optimistic
 * bubble carries `aria-busy` and no actions (03 §2.4 `CommentThread`).
 *
 * Body → `linkify()` from `lib/validation/comment.ts` (ADR-0002 C16 — never the server-only
 * markdown renderer). Markup:
 * `<li>` + `<article aria-labelledby=<handle id>>`; replies render in a nested `<ol>` inside the
 * `<li>` (DESIGN.md §5 Reply: 52px margin = avatar + gap, 16px padding, 2px `--line` border).
 * Relative times carry `suppressHydrationWarning` (the `SyncStatus` precedent — the ISR HTML was
 * rendered earlier than the client clock).
 */
export const HIDDEN_LINE = 'Hidden by a moderator.';
export const DELETED_LINE = 'Deleted.';
export const EDITED_NOTE = 'Edits show an "edited" note.';

export const DELETE_CONFIRM = {
  question: 'Delete this comment?',
  confirmLabel: 'Delete it',
  cancelLabel: 'Keep it',
} as const;

export type CommentProps = {
  comment: CommentView;
  viewer: Viewer | null;
  depth: 0 | 1;
  canModerate: boolean;
  showModRow: boolean;
  ownerProfileId: string | null;
  /** Additive (03 C-03): the thread target for the reply `Composer`. */
  target: CommentTarget;
  /** Additive: the root id a reply posts under (this comment at depth 0, its parent at depth 1). */
  rootId: string;
  /** Additive: the viewer may post (signed in, onboarded, not banned, thread open). */
  canReply: boolean;
  /** Additive: an optimistic bubble awaiting `postComment` (`aria-busy`, no actions). */
  pending?: boolean;
  onPosting?: (pending: ComposerPending) => void;
  onPosted?: (comment: CommentView) => void;
  onEdited?: (comment: CommentView) => void;
  onDeleted?: (id: string) => void;
  onModerated?: (id: string, result: ModActionResult) => void;
  onLiked?: (id: string, liked: boolean, count: number) => void;
  /** The nested replies (`<Reply>` elements), rendered in the `<ol>` under this root. */
  children?: ReactNode;
  className?: string;
};

type Mode = 'view' | 'editing' | 'replying' | 'reporting';
type EditResult = ActionResult<{ comment: CommentView }> | null;

/** The slot rows (hidden / deleted / an author-less row): no handle, no body, no actions. */
function CommentSlot({
  status,
  depth,
  children,
  className,
}: {
  status: 'hidden' | 'deleted';
  depth: 0 | 1;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <li className={className} data-state={status} data-depth={depth}>
      <div className={styles['comment-row']}>
        <span className={styles['comment-slot-avatar']} aria-hidden="true" />
        <div className={styles['comment-body']}>
          <p className={styles['comment-slot']}>
            {status === 'hidden' ? HIDDEN_LINE : DELETED_LINE}
          </p>
        </div>
      </div>
      {children ? <ol className={styles['comment-replies']}>{children}</ol> : null}
    </li>
  );
}

export function Comment({
  comment,
  viewer,
  depth,
  canModerate,
  showModRow,
  ownerProfileId,
  target,
  rootId,
  canReply,
  pending = false,
  onPosting,
  onPosted,
  onEdited,
  onDeleted,
  onModerated,
  onLiked,
  children,
  className,
}: CommentProps) {
  const classes = className ? `${styles.comment} ${className}` : styles.comment;
  const author = comment.author;

  const [mode, setMode] = useState<Mode>('view');
  const [reportKey, setReportKey] = useState(0);
  const [editValue, setEditValue] = useState(comment.body);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [windowClosed, setWindowClosed] = useState(() => !isWithinEditWindow(comment.createdAt));
  const editRef = useRef(comment.body);
  const [, startDelete] = useTransition();
  const authorLabelId = useId();

  const own = viewer !== null && author !== null && viewer.id === author.id;

  // The Edit ghost drops at exactly 15:00 after `createdAt` (04 §1.2 window, client clock).
  useEffect(() => {
    if (!own || windowClosed) return;
    const remaining = new Date(comment.createdAt).getTime() + EDIT_WINDOW_MS - Date.now();
    const timer = setTimeout(() => setWindowClosed(true), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [own, windowClosed, comment.createdAt]);

  // SAVE: the B1–B3 check runs first (no request for an empty / over-long / two-link body), then
  // `editComment`; the outcome is applied inside the action (03 C-17 — no effect needed).
  const [, editAction, editPending] = useActionState<EditResult>(async () => {
    const check = validateBody(editRef.current);
    if (!check.ok) {
      setEditError(check.message);
      return fail(check.code, check.message);
    }
    const result = await editComment({ comment_id: comment.id, body: check.body });
    if (result.ok) {
      setEditError(null);
      setMode('view');
      onEdited?.(result.data.comment);
    } else {
      setEditError(commentErrorLine(result.error.code));
    }
    return result;
  }, null);

  if (comment.status === 'hidden' || comment.status === 'deleted' || author === null) {
    return (
      <CommentSlot
        status={comment.status === 'hidden' ? 'hidden' : 'deleted'}
        depth={depth}
        className={classes}
      >
        {children}
      </CommentSlot>
    );
  }

  const held = comment.status === 'held';
  const creator = ownerProfileId !== null && author.id === ownerProfileId;
  const mod = author.role === 'moderator' || author.role === 'admin';
  const signedIn = viewer !== null && !viewer.isBanned && viewer.handle !== null;
  const canEdit = own && !windowClosed;
  const showFirstComment = canModerate && held && comment.isFirstComment === true;
  const state = mode === 'editing' ? 'editing' : held ? 'held' : 'published';

  function startEdit(): void {
    editRef.current = comment.body;
    setEditValue(comment.body);
    setEditError(null);
    setMode('editing');
  }

  /** Resolves when the delete transition settles (drives `InlineConfirm`'s pending). */
  function remove(): Promise<void> {
    return new Promise((resolve) => {
      startDelete(async () => {
        setDeleteError(null);
        try {
          const result = await deleteComment({ comment_id: comment.id });
          if (result.ok) onDeleted?.(comment.id);
          else setDeleteError(commentErrorLine(result.error.code));
        } finally {
          resolve();
        }
      });
    });
  }

  const body = <p className={styles['comment-text']}>{linkify(comment.body)}</p>;

  return (
    <li
      className={classes}
      data-state={state}
      data-depth={depth}
      {...(own ? { 'data-own': '' } : {})}
      {...(creator ? { 'data-creator': '' } : {})}
      {...(mod ? { 'data-mod': '' } : {})}
    >
      <article
        className={styles['comment-row']}
        aria-labelledby={authorLabelId}
        aria-busy={pending ? 'true' : undefined}
      >
        <Avatar
          src={author.avatarUrl}
          alt={author.avatarUrl ? '' : author.handle}
          size={depth === 1 ? 34 : 40}
          border={2}
        />
        <div className={styles['comment-body']}>
          <div className={styles['comment-head']}>
            <span id={authorLabelId} className={styles['comment-handle']}>
              @{author.handle}
            </span>
            {creator ? <PixelLabel fill="gold">CREATOR</PixelLabel> : null}
            {mod ? <PixelLabel fill="indigo-wash">MOD</PixelLabel> : null}
            {showFirstComment ? <StatusPill status="first-comment" /> : null}
            <span className={styles['comment-time']}>
              <time dateTime={comment.createdAt} suppressHydrationWarning>
                {relativeTime(comment.createdAt)}
              </time>
              {comment.editedAt !== null ? ' · edited' : null}
            </span>
          </div>

          {mode === 'editing' ? (
            <form action={editAction} className={styles['comment-edit']}>
              <textarea
                className={styles['comment-edit-textarea']}
                aria-label="Edit comment"
                aria-invalid={editError ? 'true' : undefined}
                value={editValue}
                rows={3}
                autoFocus
                readOnly={editPending}
                onChange={(event) => {
                  editRef.current = event.currentTarget.value;
                  setEditValue(event.currentTarget.value);
                  if (editError) setEditError(null);
                }}
              />
              {editError ? (
                <p role="alert" className={styles['comment-error']}>
                  {editError}
                </p>
              ) : null}
              <div className={styles['comment-edit-foot']}>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={normalizeBody(editValue) === ''}
                  pending={editPending}
                >
                  Save
                </Button>
                <Button
                  variant="ghost"
                  arrow={false}
                  disabled={editPending}
                  onClick={() => setMode('view')}
                >
                  Cancel
                </Button>
                <span className={styles['comment-edit-note']}>{EDITED_NOTE}</span>
              </div>
            </form>
          ) : (
            <div className={styles['comment-bubble']}>
              {held && own ? <HeldNotice>{body}</HeldNotice> : body}
            </div>
          )}

          {!pending && mode !== 'editing' ? (
            <div className={styles['comment-actions']}>
              {!held ? (
                <LikeButton
                  commentId={comment.id}
                  count={comment.likeCount}
                  liked={comment.likedByViewer}
                  viewer={viewer}
                  onChange={(liked, count) => onLiked?.(comment.id, liked, count)}
                />
              ) : null}
              {!held && canReply ? (
                <Button
                  variant="ghost"
                  arrow={false}
                  aria-expanded={mode === 'replying'}
                  onClick={() => setMode(mode === 'replying' ? 'view' : 'replying')}
                >
                  Reply
                </Button>
              ) : null}
              {canEdit ? (
                <Button variant="ghost" arrow={false} onClick={startEdit}>
                  Edit
                </Button>
              ) : null}
              {own ? (
                <InlineConfirm
                  question={DELETE_CONFIRM.question}
                  confirmLabel={DELETE_CONFIRM.confirmLabel}
                  cancelLabel={DELETE_CONFIRM.cancelLabel}
                  tone="danger"
                  onConfirm={remove}
                  className={styles['comment-delete']}
                >
                  {(open) => (
                    <Button variant="ghost" arrow={false} onClick={open}>
                      Delete
                    </Button>
                  )}
                </InlineConfirm>
              ) : null}
              {!held && !own && signedIn ? (
                <Button
                  variant="ghost"
                  arrow={false}
                  aria-expanded={mode === 'reporting'}
                  onClick={() => {
                    setReportKey((key) => key + 1);
                    setMode(mode === 'reporting' ? 'view' : 'reporting');
                  }}
                >
                  Report
                </Button>
              ) : null}
            </div>
          ) : null}

          {deleteError ? (
            <p role="alert" className={styles['comment-error']}>
              {deleteError}
            </p>
          ) : null}

          {mode === 'reporting' ? (
            <ReportPicker
              key={reportKey}
              commentId={comment.id}
              onDone={() => {
                // The confirmation line stays in the picker's own `done` state (03 §2.4).
              }}
              onCancel={() => setMode('view')}
            />
          ) : null}

          {mode === 'replying' && viewer !== null ? (
            <Composer
              target={target}
              parentId={rootId}
              {...(depth === 1 ? { replyToHandle: author.handle } : {})}
              viewer={viewer}
              autoFocus
              onPosting={onPosting}
              onPosted={(posted) => {
                setMode('view');
                onPosted?.(posted);
              }}
              onCancel={() => setMode('view')}
            />
          ) : null}

          {showModRow && !pending ? (
            <ModActionRow
              commentId={comment.id}
              authorId={author.id}
              authorHandle={author.handle}
              status={comment.status}
              onDone={(result) => onModerated?.(comment.id, result)}
            />
          ) : null}
        </div>
      </article>
      {children ? <ol className={styles['comment-replies']}>{children}</ol> : null}
    </li>
  );
}
