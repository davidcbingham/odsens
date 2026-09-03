'use client';

import { useOptimistic, useState, useTransition } from 'react';
import type { Viewer } from '@/components/accounts/ViewerProvider';
import { SIGN_IN_PROMPT_ID } from '@/components/comments/SignInPrompt';
import { toggleLike } from '@/lib/actions/comments';
import { commentErrorLine } from '@/lib/validation/comment';
import styles from './LikeButton.module.css';

/**
 * LikeButton — DESIGN.md §5 Comment bubble "like button (`♥ 12`, 2px line; liked =
 * `--indigo-lift` fill with ink text)"; 03 §2.4 `LikeButton`; 00 S1.4.AC6. Client island
 * (03 C-16a): `useOptimistic` flips `liked` + count at once, `toggleLike` (`lib/actions/comments.ts`)
 * settles it — the returned `like_count` is the trigger-maintained truth and goes up to
 * `CommentThread` through `onChange` (additive, 03 C-03) so the merged list keeps it; an error
 * rolls the optimistic state back (the transition ends on the unchanged props) and prints one
 * plain line beside the button (`commentErrorLine`, 03 C-30 — never a toast).
 *
 * `liked` arrives from `CommentThread`'s client-side own-likes read (03 C-17a). Signed out
 * (`viewer === null`): a click scrolls to `SignInPrompt` and focuses its button, no state change.
 * States (03 §3): `aria-pressed` carries liked; `aria-busy` while pending; no `data-state`.
 */
export type LikeButtonProps = {
  commentId: string;
  count: number;
  liked: boolean;
  viewer: Viewer | null;
  /** Additive (03 C-03): the settled `{ liked, like_count }` after `toggleLike` returns ok. */
  onChange?: (liked: boolean, count: number) => void;
  className?: string;
};

type LikeState = { liked: boolean; count: number };

function focusSignInPrompt(): void {
  const prompt = document.getElementById(SIGN_IN_PROMPT_ID);
  if (!prompt) return;
  prompt.scrollIntoView({ block: 'center' });
  prompt.querySelector<HTMLElement>('button')?.focus();
}

export function LikeButton({
  commentId,
  count,
  liked,
  viewer,
  onChange,
  className,
}: LikeButtonProps) {
  const [state, setOptimistic] = useOptimistic<LikeState>({ liked, count });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick(): void {
    if (viewer === null) {
      focusSignInPrompt();
      return;
    }
    if (pending) return;
    startTransition(async () => {
      setError(null);
      setOptimistic({
        liked: !state.liked,
        count: Math.max(0, state.count + (state.liked ? -1 : 1)),
      });
      const result = await toggleLike({ comment_id: commentId });
      if (result.ok) {
        onChange?.(result.data.liked, result.data.like_count);
      } else {
        setError(commentErrorLine(result.error.code));
      }
    });
  }

  const classes = className ? `${styles['like-button']} ${className}` : styles['like-button'];
  const word = state.count === 1 ? 'like' : 'likes';

  return (
    <span className={styles['like-button-slot']}>
      <button
        type="button"
        className={classes}
        aria-pressed={state.liked}
        aria-label={`Like, ${state.count} ${word}`}
        aria-busy={pending ? 'true' : undefined}
        onClick={onClick}
      >
        <span aria-hidden="true">♥</span> <span aria-hidden="true">{state.count}</span>
      </button>
      {error ? (
        <span role="alert" className={styles['like-button-error']}>
          {error}
        </span>
      ) : null}
    </span>
  );
}
