import { GoogleSignInButton } from '@/components/primitives/GoogleSignInButton';
import styles from './SignInPrompt.module.css';

/**
 * SignInPrompt — DESIGN.md §5 Sign-in prompt; 03 §2.4 `SignInPrompt`; 00 S1.4.AC1. Shared (no
 * directive, no server-only imports): rendered by the client `CommentThread` in the composer slot
 * while the viewer is signed out (also the pre-hydration shape — 03 C-17a). Slab panel: Bungee
 * 17px "SIGN IN TO COMMENT", one `--mute` line (03 §2.4 copy verbatim), then the chalk-filled
 * `GoogleSignInButton from="prompt"` whose `next` is the thread fragment
 * (`/projects/<slug>#comments`, 02 §2.3). The section id is the scroll target `LikeButton` uses
 * for a signed-out click (03 §2.4 "click → scrolls to `SignInPrompt`").
 */
export const SIGN_IN_PROMPT_ID = 'comments-sign-in';

export const SIGN_IN_TITLE = 'SIGN IN TO COMMENT';
export const SIGN_IN_LINE = 'Sign in to comment. Your handle is all anyone sees.';

export type SignInPromptProps = {
  /** Return path incl. hash (`/projects/<slug>#comments`). */
  next: string;
  className?: string;
};

export function SignInPrompt({ next, className }: SignInPromptProps) {
  const titleId = `${SIGN_IN_PROMPT_ID}-title`;
  const classes = className ? `${styles['sign-in-prompt']} ${className}` : styles['sign-in-prompt'];
  return (
    <section id={SIGN_IN_PROMPT_ID} aria-labelledby={titleId} className={classes}>
      <h3 id={titleId} className={styles['sign-in-prompt-title']}>
        {SIGN_IN_TITLE}
      </h3>
      <p className={styles['sign-in-prompt-line']}>{SIGN_IN_LINE}</p>
      <GoogleSignInButton from="prompt" next={next} />
    </section>
  );
}
