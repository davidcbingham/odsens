'use client';

import { useActionState, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Viewer } from '@/components/accounts/ViewerProvider';
import { Avatar } from '@/components/primitives/Avatar';
import { Button } from '@/components/primitives/Button';
import { Chip } from '@/components/primitives/Chip';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { postComment } from '@/lib/actions/comments';
import { fail, type ActionResult } from '@/lib/actions/result';
import type { CommentTarget, CommentView } from '@/lib/data/comments';
import {
  BODY_MAX,
  COMPOSER_RULE,
  codePointLength,
  commentErrorLine,
  normalizeBody,
  validateBody,
} from '@/lib/validation/comment';
import styles from './Composer.module.css';

/**
 * Composer — DESIGN.md §11.2 Composer error ("danger border on the field, one plain line under
 * it, the rule restated beside POST. Never a modal."), §5 comment actions "Reply"; 03 §2.4
 * `Composer`; 00 S1.4.AC2/AC3/AC5. Client island (03 C-16a): controlled textarea with the
 * `n / 1000` counter (`PixelLabel`, gold from 900 — 03 C-27 keeps it at 11px), `useActionState`
 * around `postComment` (`lib/actions/comments.ts`; 03 C-17). States (03 §3): `data-state="idle"`
 * · `submitting` (`aria-busy`, POST pending) · `error` (`--danger-field` border, `aria-invalid`,
 * one `role="alert"` line from `commentErrorLine(code)` — 04 §7 codes, ADR-0002 C16). The rule
 * `COMPOSER_RULE` ("1000 characters, one link.") prints beside POST at all times (13px
 * `--mute-dim`) with the "Posting as @handle." line of the pass-3 frame.
 *
 * Body rules B1–B3 run client-side first (`validateBody`) so an empty, over-long or two-link body
 * never leaves the browser (T-E2E-25: POST is disabled while the trimmed body is empty; 1001
 * chars → "That didn't post."; two links → "That didn't post. Too many links."); the server
 * enforces the same rules again (01 INV-18). Reply mode (`parentId` + `replyToHandle` for a
 * depth-1 target): an `@handle` `Chip` sits above the field and the body is sent as
 * `@handle <text>` (the client-added prefix, 05 T-ACT-16 / T-E2E-24), with a Cancel ghost.
 * Enter inserts a newline; Ctrl/⌘+Enter submits. `onPosting` (additive, 03 C-03) fires inside
 * the action transition so `CommentThread` can add its optimistic bubble (`useOptimistic`);
 * `onPosted` hands the row back AS STORED (`held` under `hold_first_time` — ADR-0002 #72).
 */
export const COMPOSER_ID = 'comment-composer';
export const COMPOSER_PLACEHOLDER = 'Say something.';

export type ComposerPending = { body: string; parentId: string | null };

export type ComposerProps = {
  target: CommentTarget;
  /** The ROOT comment id replies attach to (one level — data-model §2.5). */
  parentId?: string;
  /** Depth-1 target: the reply opens with `@handle ` (the prefix is added here). */
  replyToHandle?: string;
  viewer: Viewer;
  autoFocus?: boolean;
  onPosted?: (comment: CommentView) => void;
  onCancel?: () => void;
  /** Additive (03 C-03): fires inside the action transition, before the request. */
  onPosting?: (pending: ComposerPending) => void;
  /** Additive: the textarea id (`COMPOSER_ID` for the thread composer; replies get their own). */
  id?: string;
  className?: string;
};

type PostResult = ActionResult<{ comment: CommentView }> | null;

export function Composer({
  target,
  parentId,
  replyToHandle,
  viewer,
  autoFocus = false,
  onPosted,
  onCancel,
  onPosting,
  id,
  className,
}: ComposerProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const valueRef = useRef('');
  const formRef = useRef<HTMLFormElement>(null);
  const generatedId = useId();
  const textareaId = id ?? `${COMPOSER_ID}-${generatedId}`;
  const ruleId = `${textareaId}-rule`;
  const errorId = `${textareaId}-error`;

  const prefix = replyToHandle ? `@${replyToHandle} ` : '';

  // POST: B1–B3 client-side first (no request when they fail), then `postComment`; the outcome is
  // applied inside the action — ok → clear + hand the stored row up; error → the plain line stays
  // until the next keystroke (03 C-17; no effect needed).
  const [, formAction, pending] = useActionState<PostResult>(async () => {
    const typed = normalizeBody(valueRef.current);
    const check = validateBody(prefix + typed);
    if (!check.ok) {
      setError(check.message);
      return fail(check.code, check.message);
    }
    onPosting?.({ body: check.body, parentId: parentId ?? null });
    const result = await postComment({
      target_type: target.type,
      target_id: target.id,
      body: check.body,
      ...(parentId ? { parent_id: parentId } : {}),
    });
    if (result.ok) {
      valueRef.current = '';
      setValue('');
      setError(null);
      onPosted?.(result.data.comment);
    } else {
      setError(commentErrorLine(result.error.code));
    }
    return result;
  }, null);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (!pending && normalizeBody(valueRef.current) !== '') formRef.current?.requestSubmit();
    }
  }

  const count = codePointLength(prefix + value);
  const empty = normalizeBody(value) === '';
  const state = pending ? 'submitting' : error ? 'error' : 'idle';
  const classes = className ? `${styles.composer} ${className}` : styles.composer;
  const handle = viewer.handle ?? '';

  return (
    <form
      ref={formRef}
      action={formAction}
      className={parentId ? `${classes} ${styles['composer-reply']}` : classes}
      data-state={state}
      aria-busy={pending ? 'true' : undefined}
    >
      {/* decorative: "Posting as @handle" names the author below (03 `Avatar`: alt="" when adjacent) */}
      <span aria-hidden="true">
        <Avatar src={viewer.avatarUrl} alt={handle} size={40} border={2} />
      </span>
      <div className={styles['composer-column']}>
        {replyToHandle ? (
          <div className={styles['composer-reply-to']}>
            <span className={styles['composer-reply-word']}>Replying to</span>
            <Chip label={`@${replyToHandle}`} />
          </div>
        ) : null}
        <textarea
          id={textareaId}
          name="body"
          className={styles['composer-textarea']}
          value={value}
          placeholder={COMPOSER_PLACEHOLDER}
          aria-label={parentId ? 'Your reply' : 'Your comment'}
          aria-describedby={error ? `${ruleId} ${errorId}` : ruleId}
          aria-invalid={error ? 'true' : undefined}
          autoFocus={autoFocus}
          rows={parentId ? 2 : 3}
          readOnly={pending}
          onChange={(event) => {
            valueRef.current = event.currentTarget.value;
            setValue(event.currentTarget.value);
            if (error) setError(null);
          }}
          onKeyDown={onKeyDown}
        />
        {error ? (
          <p id={errorId} role="alert" className={styles['composer-error']}>
            {error}
          </p>
        ) : null}
        <div className={styles['composer-foot']}>
          <Button variant="primary" type="submit" disabled={empty} pending={pending}>
            Post
          </Button>
          {onCancel ? (
            <Button variant="ghost" arrow={false} onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          ) : null}
          <p id={ruleId} className={styles['composer-meta']}>
            Posting as <span className={styles['composer-handle']}>@{handle}</span>. {COMPOSER_RULE}
          </p>
          <span className={styles['composer-counter']}>
            <PixelLabel informational tone={count >= 900 ? 'gold' : 'mute-dim'}>
              {`${count} / ${BODY_MAX}`}
            </PixelLabel>
          </span>
        </div>
      </div>
    </form>
  );
}
