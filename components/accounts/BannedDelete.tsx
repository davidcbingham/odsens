'use client';

import { useState, useTransition } from 'react';
import { InlineConfirm } from '@/components/primitives/InlineConfirm';
import { deleteAccount } from '@/lib/actions/accounts';
import styles from './BannedDelete.module.css';

/**
 * BannedDelete — the `/banned` Delete account control (ADR-0021; DESIGN.md §11.3 #19 as of v1.5;
 * 02 §1.2 `/banned` row). The one thing a banned account may still do besides Sign out: the same
 * `InlineConfirm` + `deleteAccount` pair as `ProfilePanel`, minus everything else. On success it
 * leaves with a DOCUMENT navigation (not the router): the onboarding shell mounts no `ViewerProvider`
 * to notify, and a full load lands anon with nothing stale (the ADR-0017 lesson). The action itself
 * cleared the auth cookies, so `/` renders signed out.
 */
export function BannedDelete() {
  const [, startDelete] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 03 C-17: mutations run through `startTransition`; the returned promise settles when the action
  // does, so `InlineConfirm` shows `pending` for exactly that long (same shape as `ProfilePanel`).
  function onDelete(): Promise<void> {
    return new Promise((resolve) => {
      startDelete(async () => {
        setError(null);
        try {
          const result = await deleteAccount({ confirm: true });
          if (result.ok) {
            window.location.assign('/');
          } else {
            setError(result.error.message);
          }
        } finally {
          resolve();
        }
      });
    });
  }

  return (
    <div className={styles['banned-delete']}>
      <InlineConfirm
        question="Delete your account? Your handle, picture and comments go with it."
        confirmLabel="Delete it"
        cancelLabel="Keep it"
        tone="danger"
        onConfirm={onDelete}
      >
        {(open) => (
          <button type="button" className={styles['banned-delete-button']} onClick={open}>
            Delete account
          </button>
        )}
      </InlineConfirm>
      {error ? (
        <p role="alert" className={styles['banned-delete-error']}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
