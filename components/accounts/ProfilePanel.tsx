'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useId, useRef, useState, useTransition } from 'react';
import { AvatarUpload } from '@/components/accounts/AvatarUpload';
import { HandleField } from '@/components/accounts/HandleField';
import {
  VIEWER_REFRESH_EVENT,
  VIEWER_SIGNED_OUT_EVENT,
} from '@/components/accounts/ViewerProvider';
import { useToast } from '@/components/layout/Toast';
import { Button } from '@/components/primitives/Button';
import { InlineConfirm } from '@/components/primitives/InlineConfirm';
import { deleteAccount, updateProfile } from '@/lib/actions/accounts';
import type { ActionResult } from '@/lib/actions/result';
import styles from './ProfilePanel.module.css';

/**
 * ProfilePanel — DESIGN.md §11.3 #11 Your profile (pass-3 "Your profile desktop" frame); 02 §2.5.
 * The `/profile` client island (03 §1.4 C-16a row via ADR-0014 — the `/profile` counterpart of
 * `OnboardingPanel`): `HandleField` takes an `onValidity` function, `InlineConfirm` a render-prop and
 * `onConfirm`, `useActionState` wraps `updateProfile`, `startTransition` wraps `deleteAccount`, and
 * the "Saved." toast needs `useToast()`. Picture row (Change / Remove → `updateProfile`, anchor
 * `#picture`), handle row + SAVE with the consequence line (anchor `#handle`), footer strip (what we
 * store + Privacy link + Delete account behind `InlineConfirm` → `deleteAccount`). The 7-day
 * "You can change it again on …" line is the `limitedUntil` prop, computed by the server page — this
 * component never reads the clock. The root `<section>` carries `data-state="idle" | "submitting" |
 * "error"` (03 §3) exactly like `OnboardingPanel` — a `section`, not a `div`, so the e2e root locators
 * `div[data-state]:has(input[name="handle"])` keep matching only `HandleField` / `AvatarUpload`.
 */
export type ProfilePanelProps = {
  handle: string;
  avatarUrl: string | null;
  /** `YYYY-MM-DD` (`lib/format/date.ts` `formatDay`) while the 7-day rename limit holds, else null. */
  limitedUntil: string | null;
};

type SaveResult = ActionResult<{ handle: string; avatar_path: string | null }> | null;

async function save(_previous: SaveResult, formData: FormData): Promise<SaveResult> {
  return updateProfile(formData);
}

export function ProfilePanel({ handle, avatarUrl, limitedUntil }: ProfilePanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [pictureResult, pictureAction, picturePending] = useActionState(save, null);
  const [handleResult, handleAction, handlePending] = useActionState(save, null);
  const [, startDelete] = useTransition();
  const [canSave, setCanSave] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const pictureForm = useRef<HTMLFormElement>(null);
  const seen = useRef<{ picture: SaveResult; handle: SaveResult }>({ picture: null, handle: null });
  const pictureErrorId = useId();
  const handleErrorId = useId();

  // After a successful save: toast, refresh the server data (a rename brings the new `handle` and
  // `limitedUntil` props down with it), and tell ViewerProvider to re-read. A handle save also
  // disarms SAVE right away (the refreshed `handle` prop remounts the field).
  useEffect(() => {
    const freshPicture = pictureResult && pictureResult !== seen.current.picture;
    const freshHandle = handleResult && handleResult !== seen.current.handle;
    seen.current = { picture: pictureResult, handle: handleResult };
    if (freshHandle && handleResult.ok) setCanSave(false);
    if ((freshPicture && pictureResult.ok) || (freshHandle && handleResult.ok)) {
      toast('Saved.');
      window.dispatchEvent(new Event(VIEWER_REFRESH_EVENT));
      router.refresh();
    }
  }, [pictureResult, handleResult, toast, router]);

  const pictureError = pictureResult && !pictureResult.ok ? pictureResult.error.message : null;
  const handleError = handleResult && !handleResult.ok ? handleResult.error.message : null;

  // 03 §3 `ProfilePanel`: `submitting` while either form's action is pending, `error` while an inline
  // action error is shown, else `idle` — the same derivation as `OnboardingPanel`. Delete pending is
  // `InlineConfirm`'s own `pending` (ADR-0014), so it does not drive the root.
  const state =
    picturePending || handlePending
      ? 'submitting'
      : pictureError || handleError || deleteError
        ? 'error'
        : 'idle';

  // 03 C-17: mutations run through `<form action>`, `useActionState`, or `startTransition`. The
  // returned promise settles when the transition's work is done, so `InlineConfirm` shows `pending`
  // for exactly that long — and always settles, so the strip never sticks if the action throws.
  function onDelete(): Promise<void> {
    return new Promise((resolve) => {
      startDelete(async () => {
        setDeleteError(null);
        try {
          const result = await deleteAccount({ confirm: true });
          if (result.ok) {
            // The server session is gone (04 §1.1 deleteAccount signs out), but the browser client
            // still holds it: tell ViewerProvider to sign out locally so the nav drops the old
            // handle + picture at once — then back to the front door.
            window.dispatchEvent(new Event(VIEWER_SIGNED_OUT_EVENT));
            router.replace('/');
            router.refresh();
          } else {
            setDeleteError(result.error.message);
          }
        } finally {
          resolve();
        }
      });
    });
  }

  return (
    <section className={styles['profile-panel']} data-state={state}>
      {/* ---- picture row ---- */}
      <form
        id="picture"
        ref={pictureForm}
        action={pictureAction}
        className={styles['profile-panel-row']}
        aria-describedby={pictureError ? pictureErrorId : undefined}
      >
        <div className={styles['profile-panel-row-head']}>
          <h2 className={styles['profile-panel-label']}>Picture</h2>
          <p className={styles['profile-panel-hint']}>Optional. Blank is a fine look.</p>
        </div>
        <AvatarUpload
          name="avatar"
          current={avatarUrl}
          size={88}
          onChange={() => {
            // Change (cropped file ready) and Remove both save straight away (02 §2.5).
            pictureForm.current?.requestSubmit();
          }}
        />
        {pictureError ? (
          <p id={pictureErrorId} role="alert" className={styles['profile-panel-error']}>
            {pictureError}
          </p>
        ) : null}
      </form>

      {/* ---- handle row ---- */}
      <form
        id="handle"
        action={handleAction}
        className={styles['profile-panel-row']}
        aria-describedby={handleError ? handleErrorId : undefined}
      >
        <div className={styles['profile-panel-handle-row']}>
          <HandleField
            key={handle}
            name="handle"
            defaultValue={handle}
            currentHandle={handle}
            onValidity={(v) =>
              setCanSave(v.valid && v.value.toLowerCase() !== handle.toLowerCase())
            }
            className={styles['profile-panel-handle-field']}
          />
          <Button
            variant="primary"
            type="submit"
            disabled={!canSave}
            pending={handlePending}
            className={styles['profile-panel-save']}
          >
            SAVE
          </Button>
        </div>
        <p className={styles['profile-panel-hint']}>
          Changing it renames you on every comment you&apos;ve left.
        </p>
        {limitedUntil ? (
          <p className={styles['profile-panel-hint']}>You can change it again on {limitedUntil}.</p>
        ) : null}
        {handleError ? (
          <p id={handleErrorId} role="alert" className={styles['profile-panel-error']}>
            {handleError}
          </p>
        ) : null}
      </form>

      {/* ---- footer strip: what we store + Delete account ---- */}
      <div className={styles['profile-panel-foot']}>
        <p className={styles['profile-panel-foot-line']}>
          We keep your Google account ID for sign-in, your handle, your picture, and your comments,
          likes and reports. Nothing else. <Link href="/privacy">What we store</Link>
        </p>
        <div className={styles['profile-panel-delete']}>
          <InlineConfirm
            question="Delete your account? Your handle, picture and comments go with it."
            confirmLabel="Delete it"
            cancelLabel="Keep it"
            tone="danger"
            onConfirm={onDelete}
          >
            {(open) => (
              <button
                type="button"
                className={styles['profile-panel-delete-button']}
                onClick={open}
              >
                Delete account
              </button>
            )}
          </InlineConfirm>
          {deleteError ? (
            <p role="alert" className={styles['profile-panel-error']}>
              {deleteError}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
