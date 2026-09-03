'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useToast } from '@/components/layout/Toast';
import { Button } from '@/components/primitives/Button';
import { Field } from '@/components/primitives/Field';
import { InlineConfirm } from '@/components/primitives/InlineConfirm';
import { banUser, moderateComment, renameUserHandle } from '@/lib/actions/comments';
import type { ActionResult } from '@/lib/actions/result';
import { commentErrorLine } from '@/lib/validation/comment';
import { HANDLE_HELPER, HANDLE_MAX, handleReason } from '@/lib/validation/handle';
import type { CommentStatus, ModerateAction } from '@/lib/validation/moderation';
import styles from './ModActionRow.module.css';

/**
 * ModActionRow — DESIGN.md §11.1 Mod action row ("one accent max: filled emerald Approve,
 * outlined Hide, danger-bordered Ban user … Ban asks once, inline, in plain words and says where
 * to undo it"), §5 Admin table actions rule; 03 §2.4 `ModActionRow`; ADR-0028 D6 (`surface`);
 * 00 S1.4.AC4/AC12/AC14. Client island (03 C-16a): `moderateComment` / `banUser` /
 * `renameUserHandle` (`lib/actions/comments.ts`) inside `startTransition` (03 C-17); the server
 * re-checks the moderator role on every call (01 INV-18).
 *
 * Thread surface (default): Approve (only while `held`) · Hide (`published` | `held`) · Ban user
 * (`InlineConfirm` danger — "Ban @handle? They can't comment anywhere. Undo in Admin → Comments."
 * → Ban / Keep). `surface="admin"` (the `/admin/comments` row, ADR-0028 D6) adds Unhide (`hidden`
 * rows), Delete (`InlineConfirm` danger "Delete this comment?" → Delete it / Keep it) and Rename
 * handle (a `Field` with the `@` prefix + the `handleReason` rules + `InlineConfirm tone="neutral"`
 * "Rename @old to @new?" → Rename / Keep — composed only from existing primitives, 03 C-22).
 *
 * After an ok result: the G-04 toast where one exists ("Approved." · "Hidden." · "Banned."),
 * then `onDone(result)` when the caller passed one (the thread patches its list) — otherwise
 * `router.refresh()` (the `SyncStatus` precedent; the admin queue re-reads). Errors stay inline
 * as one plain line (`commentErrorLine`; `handle_taken` / `handle_reserved` / `validation` keep the
 * action's own words) — never a toast (03 C-30). `<div role="group" aria-label="Moderation">`;
 * every control ≥ 44px (03 C-24); `aria-busy` on the running button, label unchanged.
 */
export type ModActionResult =
  | { action: ModerateAction; status: CommentStatus }
  | { action: 'ban' }
  | { action: 'rename'; handle: string };

export type ModActionRowProps = {
  commentId: string;
  authorId: string;
  authorHandle: string;
  status: CommentStatus;
  /** Called after an ok result (additive result argument, 03 C-03); absent → `router.refresh()`. */
  onDone?: (result: ModActionResult) => void;
  /** `'admin'` adds Unhide · Delete · Rename handle (ADR-0028 D6). Default `'thread'`. */
  surface?: 'thread' | 'admin';
  className?: string;
};

export const BAN_CONFIRM = {
  confirmLabel: 'Ban',
  cancelLabel: 'Keep',
} as const;
export function banQuestion(handle: string): string {
  return `Ban @${handle}? They can't comment anywhere. Undo in Admin → Comments.`;
}

export const DELETE_CONFIRM = {
  question: 'Delete this comment?',
  confirmLabel: 'Delete it',
  cancelLabel: 'Keep it',
} as const;

export function renameQuestion(from: string, to: string): string {
  return `Rename @${from} to @${to}?`;
}

const TOASTS: Partial<Record<ModerateAction, string>> = { approve: 'Approved.', hide: 'Hidden.' };
const NEXT_STATUS: Record<ModerateAction, CommentStatus> = {
  approve: 'published',
  hide: 'hidden',
  unhide: 'published',
  delete: 'deleted',
};

/** Codes whose action message is already the plain line to show. */
const OWN_WORDS = new Set(['validation', 'handle_taken', 'handle_reserved']);

function errorLine(result: Extract<ActionResult<unknown>, { ok: false }>): string {
  return OWN_WORDS.has(result.error.code)
    ? result.error.message
    : commentErrorLine(result.error.code);
}

type Busy = ModerateAction | 'ban' | 'rename' | null;

export function ModActionRow({
  commentId,
  authorId,
  authorHandle,
  status,
  onDone,
  surface = 'thread',
  className,
}: ModActionRowProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [handle, setHandle] = useState('');
  const [handleError, setHandleError] = useState<string | null>(null);

  const admin = surface === 'admin';

  function finish(result: ModActionResult): void {
    if (onDone) onDone(result);
    else router.refresh();
  }

  /** One transition per control; resolves when the action settles (InlineConfirm's `pending`). */
  function run(kind: Exclude<Busy, null>, work: () => Promise<void>): Promise<void> {
    return new Promise((resolve) => {
      startTransition(async () => {
        setBusy(kind);
        setError(null);
        try {
          await work();
        } finally {
          setBusy(null);
          resolve();
        }
      });
    });
  }

  function moderate(action: ModerateAction): Promise<void> {
    return run(action, async () => {
      const result = await moderateComment({ comment_id: commentId, action });
      if (!result.ok) {
        setError(errorLine(result));
        return;
      }
      const line = TOASTS[action];
      if (line) toast(line);
      finish({ action, status: NEXT_STATUS[action] });
    });
  }

  function ban(): Promise<void> {
    return run('ban', async () => {
      const result = await banUser({ profile_id: authorId, banned: true });
      if (!result.ok) {
        setError(errorLine(result));
        return;
      }
      toast('Banned.');
      finish({ action: 'ban' });
    });
  }

  const nextHandle = handle.trim();
  const renameReason = nextHandle === '' ? null : handleReason(nextHandle);
  const canRename =
    nextHandle !== '' &&
    renameReason === null &&
    nextHandle.toLowerCase() !== authorHandle.toLowerCase();

  function rename(): Promise<void> {
    return run('rename', async () => {
      const result = await renameUserHandle({ profile_id: authorId, handle: nextHandle });
      if (!result.ok) {
        setHandleError(errorLine(result));
        return;
      }
      setRenaming(false);
      setHandle('');
      finish({ action: 'rename', handle: result.data.handle });
    });
  }

  const classes = className ? `${styles['mod-action-row']} ${className}` : styles['mod-action-row'];

  return (
    <div role="group" aria-label="Moderation" className={classes} data-surface={surface}>
      <div className={styles['mod-action-row-buttons']}>
        {status === 'held' ? (
          <button
            type="button"
            className={styles['mod-action-row-button']}
            data-tone="approve"
            disabled={busy !== null}
            aria-busy={busy === 'approve' ? 'true' : undefined}
            onClick={() => void moderate('approve')}
          >
            Approve
          </button>
        ) : null}
        {status === 'published' || status === 'held' ? (
          <button
            type="button"
            className={styles['mod-action-row-button']}
            data-tone="outline"
            disabled={busy !== null}
            aria-busy={busy === 'hide' ? 'true' : undefined}
            onClick={() => void moderate('hide')}
          >
            Hide
          </button>
        ) : null}
        {admin && status === 'hidden' ? (
          <button
            type="button"
            className={styles['mod-action-row-button']}
            data-tone="outline"
            disabled={busy !== null}
            aria-busy={busy === 'unhide' ? 'true' : undefined}
            onClick={() => void moderate('unhide')}
          >
            Unhide
          </button>
        ) : null}
        {admin && status !== 'deleted' ? (
          <InlineConfirm
            question={DELETE_CONFIRM.question}
            confirmLabel={DELETE_CONFIRM.confirmLabel}
            cancelLabel={DELETE_CONFIRM.cancelLabel}
            tone="danger"
            onConfirm={() => moderate('delete')}
            className={styles['mod-action-row-confirm']}
          >
            {(open) => (
              <button
                type="button"
                className={styles['mod-action-row-button']}
                data-tone="danger"
                disabled={busy !== null}
                onClick={open}
              >
                Delete
              </button>
            )}
          </InlineConfirm>
        ) : null}
        <InlineConfirm
          question={banQuestion(authorHandle)}
          confirmLabel={BAN_CONFIRM.confirmLabel}
          cancelLabel={BAN_CONFIRM.cancelLabel}
          tone="danger"
          onConfirm={ban}
          className={styles['mod-action-row-confirm']}
        >
          {(open) => (
            <button
              type="button"
              className={styles['mod-action-row-button']}
              data-tone="danger"
              disabled={busy !== null}
              onClick={open}
            >
              Ban user
            </button>
          )}
        </InlineConfirm>
        {admin ? (
          <button
            type="button"
            className={styles['mod-action-row-button']}
            data-tone="outline"
            aria-expanded={renaming}
            disabled={busy !== null}
            onClick={() => {
              setRenaming((open) => !open);
              setHandleError(null);
            }}
          >
            Rename handle
          </button>
        ) : null}
      </div>

      {admin && renaming ? (
        <div className={styles['mod-action-row-rename']}>
          <Field
            label="New handle"
            name={`handle-${commentId}`}
            prefix="@"
            maxLength={HANDLE_MAX}
            counter
            helper={renameReason ?? HANDLE_HELPER}
            error={handleError ?? undefined}
            inputProps={{
              value: handle,
              autoComplete: 'off',
              spellCheck: false,
              onChange: (event) => {
                setHandle(event.currentTarget.value);
                setHandleError(null);
              },
            }}
          />
          <InlineConfirm
            question={renameQuestion(authorHandle, nextHandle)}
            confirmLabel="Rename"
            cancelLabel="Keep"
            tone="neutral"
            onConfirm={rename}
          >
            {(open) => (
              <Button
                variant="secondary"
                size="sm"
                disabled={!canRename || busy !== null}
                onClick={open}
              >
                Rename
              </Button>
            )}
          </InlineConfirm>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className={styles['mod-action-row-error']}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
