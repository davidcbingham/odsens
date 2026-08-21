'use client';

import { useSearchParams } from 'next/navigation';
import { useActionState, useEffect, useId, useState } from 'react';
import { AvatarUpload } from '@/components/accounts/AvatarUpload';
import { HandleField } from '@/components/accounts/HandleField';
import { Button } from '@/components/primitives/Button';
import { NoteCallout } from '@/components/primitives/NoteCallout';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { completeOnboarding } from '@/lib/actions/accounts';
import type { ActionResult } from '@/lib/actions/result';
import { safeNext } from '@/lib/validation/next';
import styles from './OnboardingPanel.module.css';

/**
 * OnboardingPanel — DESIGN.md §11.3 #10 Handle onboarding, §12.5 guidance block; 03 §2.5
 * `OnboardingPanel`; 02 §2.4. 560px slab centred on the faint 45° `--indigo` hatch (the page paints
 * it), STEP 1 OF 1, "PICK A HANDLE", the line, `HandleField`, the "What's a handle?" block (a
 * `NoteCallout`, 03 C-22), optional `AvatarUpload` (Upload only — no Skip button, ADR-0017: leaving
 * the picture empty and pressing DONE is the skip), footer strip with DONE (disabled until the
 * handle validates — the picture never gates it) and "You can change both later. Your Google name
 * and email stay hidden." `useActionState` around `completeOnboarding`; server errors inline under
 * DONE (never a modal / toast). No props — nothing is prefilled from Google (Q34).
 *
 * On ok the panel leaves with a DOCUMENT navigation, `window.location.assign(next)` (`?next=`
 * through `safeNext`), not `router.replace` (ADR-0017): the client router's prefetch cache can hold
 * `/` as the proxy's M5 answer "307 → /welcome" (the `/` prefetch was made while the handle was still
 * null), so a soft navigation "home" landed right back here. A document load asks the server fresh,
 * and the public layout's `ViewerProvider` starts with the new handle. The onboarding layout's
 * wordmark link also has `prefetch={false}` so the poisoned entry is not created in the first place.
 */
export type OnboardingPanelProps = Record<string, never>;

type Result = ActionResult<{ handle: string; avatar_path: string | null }> | null;

async function submit(_previous: Result, formData: FormData): Promise<Result> {
  return completeOnboarding(formData);
}

export function OnboardingPanel() {
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const [result, formAction, pending] = useActionState(submit, null);
  const [valid, setValid] = useState(false);
  const titleId = useId();
  const helpId = useId();
  const errorId = useId();

  useEffect(() => {
    if (result?.ok) window.location.assign(next);
  }, [result, next]);

  const error = result && !result.ok ? result.error : null;
  const state = pending ? 'submitting' : error ? 'error' : 'idle';

  return (
    <section className={styles['onboarding-panel']} data-state={state} aria-labelledby={titleId}>
      <form action={formAction} aria-describedby={error ? errorId : undefined}>
        <div className={styles['onboarding-panel-head']}>
          <PixelLabel tone="gold" size={11}>
            STEP 1 OF 1
          </PixelLabel>
          <h1 id={titleId} className={styles['onboarding-panel-title']}>
            PICK A HANDLE
          </h1>
          <p className={styles['onboarding-panel-line']}>
            Pick a handle. It&apos;s all anyone will ever see.
          </p>
        </div>

        <div className={styles['onboarding-panel-section']}>
          <HandleField name="handle" onValidity={(v) => setValid(v.valid)} />
          <NoteCallout label="WHAT'S A HANDLE?">
            Handles are made-up names. Don&apos;t use your real one — nobody here needs to know it,
            including us.
          </NoteCallout>
        </div>

        <div className={styles['onboarding-panel-section']}>
          <p className={styles['onboarding-panel-label']}>
            Picture <span className={styles['onboarding-panel-optional']}>— optional</span>
          </p>
          <div className={styles['onboarding-panel-picture']}>
            <AvatarUpload name="avatar" current={null} size={88} />
          </div>
        </div>

        <div className={styles['onboarding-panel-foot']}>
          <div className={styles['onboarding-panel-foot-row']}>
            <Button
              variant="primary"
              type="submit"
              disabled={!valid}
              pending={pending}
              aria-describedby={helpId}
              className={styles['onboarding-panel-done']}
            >
              DONE
            </Button>
            <p id={helpId} className={styles['onboarding-panel-foot-line']}>
              You can change both later. Your Google name and email stay hidden.
            </p>
          </div>
          {error ? (
            <p id={errorId} role="alert" className={styles['onboarding-panel-error']}>
              {error.message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
