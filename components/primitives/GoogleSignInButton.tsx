'use client';

import { useState } from 'react';
import { publicEnv } from '@/lib/env/public';
import { trackEvent } from '@/lib/analytics';
import { safeNext } from '@/lib/validation/next';
import styles from './GoogleSignInButton.module.css';

/**
 * GoogleSignInButton — DESIGN.md §5 Sign-in prompt ("chalk-filled Continue with Google button with
 * dark text"), §11.3 #18 Admin gate, §5 Nav "Sign in"; 03 §2.2 `GoogleSignInButton` (C-17 exception 3;
 * ADR-0002 C3). Sign-in starts client-side: `trackEvent('sign_in', {from})`, then the lazily imported
 * browser client (ADR-0008) calls `signInWithOAuth` with `redirectTo` built from `NEXT_PUBLIC_SITE_URL`
 * (never `window.location`) and a `safeNext`-validated `next`. The browser then follows Supabase's
 * `/auth/v1/authorize?provider=google` redirect. States are exactly 03 §2.2's rest · hover · active ·
 * focus · pending (`aria-busy` while the redirect starts). If `signInWithOAuth` does not start,
 * `pending` simply clears and the button can be clicked again — no error state, nothing logged.
 *
 * `label="Sign in"` is the Nav slot: the outlined block (14px 700, 2px `--line-strong`) of 03 N-04,
 * `data-variant="outlined"`; every other label is the chalk-filled block with the Google mark,
 * `data-variant="chalk"` (ADR-0014). The mark's four fills are Google's brand colours — a brand
 * asset, not a design colour (ADR-0014).
 */
export type GoogleSignInButtonProps = {
  /** Return path incl. hash; default = current pathname + hash. Validated by `safeNext` (02 RP-20). */
  next?: string;
  label?: 'Continue with Google' | 'Sign in';
  /** 04 §5.6 values: nav slot · `SignInPrompt` · `AdminGate`. */
  from: 'nav' | 'prompt' | 'admin';
  className?: string;
};

function GoogleMark() {
  return (
    <svg
      className={styles['google-sign-in-button-mark']}
      width={18}
      height={18}
      viewBox="0 0 18 18"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function GoogleSignInButton({
  next,
  label = 'Continue with Google',
  from,
  className,
}: GoogleSignInButtonProps) {
  const [pending, setPending] = useState(false);
  const variant = label === 'Sign in' ? 'outlined' : 'chalk';
  const classes = className
    ? `${styles['google-sign-in-button']} ${className}`
    : styles['google-sign-in-button'];

  async function start(): Promise<void> {
    if (pending) return;
    setPending(true);
    trackEvent('sign_in', { from });
    const target = safeNext(next ?? `${window.location.pathname}${window.location.hash}`);
    const redirectTo = `${publicEnv.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(target)}`;
    try {
      const { createBrowserClient } = await import('@/lib/supabase/client');
      const { error } = await createBrowserClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      // On success the browser is navigating to Google; `pending` stays on until the page unloads.
      if (error) setPending(false);
    } catch {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className={classes}
      data-variant={variant}
      aria-busy={pending ? 'true' : undefined}
      disabled={pending}
      onClick={() => void start()}
    >
      {variant === 'chalk' ? <GoogleMark /> : null}
      <span>{label}</span>
    </button>
  );
}
