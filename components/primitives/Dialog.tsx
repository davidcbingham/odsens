'use client';

import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type SyntheticEvent,
} from 'react';
import { Button } from '@/components/primitives/Button';
import styles from './Dialog.module.css';

/**
 * Dialog — DESIGN.md v1.10 §11.3 #20 "Admin — Project editor v2" leave dialog (480px `--slab`,
 * 2px `--line-soft`, `6px 6px 0 --ink-deep`, Bungee 22px title, one plain line, two right-aligned
 * buttons, scrim `--scrim`, focus trapped, Esc = Stay); 03 §2.10 `Dialog` row; ADR-0039 D3 (the
 * unsaved-changes guard opens it: Stay = primary + default, Leave anyway = ghost) / D5 (the look);
 * on the 03 §1.4 C-16a client-island list. Data arrives as props (01 INV-09). e2e: T-E2E-55.
 *
 * Native `<dialog>`: `showModal()` when `open` turns true (guarded — a second `showModal()` on an
 * open dialog throws), `close()` when it turns false (guarded — only while open). Controlled:
 * nothing closes the dialog but the `open` prop. Esc arrives as the native `cancel` event
 * (`preventDefault` + `onCancel`); a click on the backdrop → `onCancel` (the box is an inner panel,
 * so only the `::backdrop` and the 2px border target the `<dialog>` itself — and a press that
 * started inside the panel and was released on the backdrop is ignored); a user-agent close that
 * skipped `cancel` (Chrome's close watcher after a prevented Esc) is caught on `close` and reported
 * once as `onCancel`. `aria-labelledby` → title, `aria-describedby` → body (`useId`).
 * Focus: the cancel button is the PRIMARY `Button` and receives focus on open — it is the default
 * (Enter = cancel); confirm is a `ghost` `Button` (`arrow={false}`) to its left. Both are
 * `type="button"` and there is no `<form>` inside, so Enter never submits a form the island sits
 * beside (the editor's server forms). Focus returns to the opener on close (native `dialog.close()`
 * + an unmount fallback, `Lightbox` precedent). Body scroll locked while open (`Lightbox`).
 * closed · open (03 row) — no `data-state`, the native `open` attribute is the state.
 */
export type DialogProps = {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function Dialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);
  /** Latest `open` prop for the native `close` handler (a UA close is only reported while open). */
  const openRef = useRef(open);
  /** True when the last `pointerdown` landed on the backdrop, not inside the panel. */
  const backdropPressRef = useRef(false);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    openRef.current = open;
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!open) {
      if (dialog.open) dialog.close(); // close() on a closed dialog is a no-op by spec; guarded anyway
      return;
    }

    openerRef.current = document.activeElement;
    if (!dialog.open && dialog.isConnected) dialog.showModal(); // guard: an open dialog would throw
    cancelRef.current?.focus(); // the default button, not the first in DOM order
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // body scroll locked (Lightbox precedent)
    return () => {
      document.body.style.overflow = previousOverflow;
      // dialog.close() restores focus natively; this covers unmount-while-open (e.g. the island
      // leaving the tree after "Leave anyway" navigates).
      const opener = openerRef.current;
      if (
        opener instanceof HTMLElement &&
        opener.isConnected &&
        document.activeElement === document.body
      ) {
        opener.focus();
      }
    };
  }, [open]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>): void => {
    event.preventDefault(); // Esc: the parent owns `open`; it closes through the prop
    onCancel();
  };

  const handleNativeClose = (): void => {
    // A close the prop did not drive (UA close watcher, form method="dialog"): report it once.
    if (openRef.current) onCancel();
  };

  const handlePointerDown = (event: PointerEvent<HTMLDialogElement>): void => {
    backdropPressRef.current = event.target === event.currentTarget;
  };

  const handleClick = (event: MouseEvent<HTMLDialogElement>): void => {
    const onBackdrop = event.target === event.currentTarget && backdropPressRef.current;
    backdropPressRef.current = false;
    if (onBackdrop) onCancel(); // click on the scrim = cancel
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      <div className={styles['dialog-panel']}>
        <h2 id={titleId} className={styles['dialog-title']}>
          {title}
        </h2>
        <p id={bodyId} className={styles['dialog-body']}>
          {body}
        </p>
        <div className={styles['dialog-actions']}>
          <Button variant="ghost" arrow={false} type="button" onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button ref={cancelRef} variant="primary" type="button" onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
