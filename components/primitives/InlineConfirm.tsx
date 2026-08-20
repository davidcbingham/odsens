'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/primitives/Button';
import styles from './InlineConfirm.module.css';

/**
 * InlineConfirm — DESIGN.md §11.2 "Delete asks once inline on a `--danger-wash` / `--danger-line`
 * strip", §11.1 "Ban asks once, inline"; 03 §2.2 `InlineConfirm`. Never a modal.
 * closed (only the trigger) · `data-state="open"` (strip with the question, confirm + cancel) ·
 * `pending` while `onConfirm` runs. Focus moves to Cancel on open and returns to the trigger on
 * close; Esc = cancel. The strip is `role="group"` labelled by the question. The render-prop trigger
 * unmounts while the strip is open and remounts fresh on close, so focus is restored after the
 * closed state commits, to the first focusable element inside the root (= the trigger).
 */
export type InlineConfirmProps = {
  question: string;
  confirmLabel: string;
  cancelLabel: string;
  tone?: 'danger' | 'neutral';
  onConfirm: () => void | Promise<void>;
  /** Render-prop for the trigger: `(open) => <Button onClick={open}>Delete</Button>`. */
  children: (open: () => void) => ReactNode;
  className?: string;
};

type State = 'closed' | 'open' | 'pending';

export function InlineConfirm({
  question,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  onConfirm,
  children,
  className,
}: InlineConfirmProps) {
  const [state, setState] = useState<State>('closed');
  const questionId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const open = useCallback(() => setState('open'), []);

  const close = useCallback(() => {
    restoreFocus.current = true;
    setState('closed');
  }, []);

  // open → focus lands on Cancel; closed (after Cancel / Esc / confirm settled) → back to the trigger.
  useEffect(() => {
    if (state === 'open') {
      cancelRef.current?.focus();
      return;
    }
    if (state !== 'closed' || !restoreFocus.current) return;
    restoreFocus.current = false;
    rootRef.current
      ?.querySelector<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      ?.focus();
  }, [state]);

  async function confirm(): Promise<void> {
    setState('pending');
    try {
      await onConfirm();
    } finally {
      // The caller may have navigated away (deleteAccount → `/`); only touch state while mounted.
      if (mounted.current) close();
    }
  }

  const classes = className ? `${styles['inline-confirm']} ${className}` : styles['inline-confirm'];

  return (
    <div ref={rootRef} className={classes} data-state={state} data-tone={tone}>
      {state === 'closed' ? (
        children(open)
      ) : (
        <div
          role="group"
          aria-labelledby={questionId}
          className={styles['inline-confirm-strip']}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && state === 'open') {
              event.preventDefault();
              close();
            }
          }}
        >
          <p id={questionId} className={styles['inline-confirm-question']}>
            {question}
          </p>
          <div className={styles['inline-confirm-actions']}>
            <button
              type="button"
              className={styles['inline-confirm-confirm']}
              aria-busy={state === 'pending' ? 'true' : undefined}
              disabled={state === 'pending'}
              onClick={() => void confirm()}
            >
              {confirmLabel}
            </button>
            <Button
              ref={cancelRef}
              variant="ghost"
              arrow={false}
              disabled={state === 'pending'}
              onClick={close}
            >
              {cancelLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
