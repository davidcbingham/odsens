'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useViewer } from '@/components/accounts/ViewerProvider';
import { Avatar } from '@/components/primitives/Avatar';
import { GoogleSignInButton } from '@/components/primitives/GoogleSignInButton';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import styles from './ProfileMenu.module.css';

/**
 * ProfileMenu — DESIGN.md §11.1 Profile menu; 03 §2.5 `ProfileMenu`, N-04/N-06; 02 RP-12 items.
 * Anon / loading (`useViewer().status !== 'signed-in'`) → `GoogleSignInButton label="Sign in"
 * from="nav"` (the outlined block; no layout shift — C-17a). Signed in → trigger (28px `Avatar` +
 * handle + ▾ in a `--line-strong` outlined block, `aria-expanded`) and, `data-state="open"`, the
 * 236px slab (`4px 4px 0 --ink-deep`): header 40px `Avatar` + handle + SIGNED IN, then Your profile ·
 * [Admin — role ≥ moderator] · Sign out in `--danger` behind a 2px top `--line` as
 * `<form method="post" action="/auth/sign-out">` (01 INV-17). The former handle / picture shortcut
 * items are gone (ADR-0018 — all three opened `/profile`; the page keeps its `#handle` / `#picture`
 * anchors). `role="menu"`, Esc closes + focus back, click-outside closes, arrows move.
 * Dynamic routes may pass `viewer`; ISR pages rely on `useViewer()`. Inside the phone panel `Nav`
 * passes a className whose rules (in `Nav.module.css`, attribute selectors) turn the popover into a
 * static full-width block.
 */
export type ProfileMenuProps = {
  viewer?: { handle: string; avatarUrl: string | null; role: 'user' | 'moderator' | 'admin' };
  /** S2.2 — "Your orders (n)"; unused until `FLAGS.commissions`. */
  ordersUnread?: number;
  className?: string;
};

type MenuItem = { label: string; href: string };

export function ProfileMenu({ viewer: viewerProp, className }: ProfileMenuProps) {
  const { status, viewer: contextViewer } = useViewer();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const viewer =
    viewerProp ??
    (status === 'signed-in' && contextViewer && contextViewer.handle
      ? {
          handle: contextViewer.handle,
          avatarUrl: contextViewer.avatarUrl,
          role: contextViewer.role,
        }
      : null);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Esc closes (focus back); click outside closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    const onPointer = (event: globalThis.PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, close]);

  // Opening moves focus to the first item.
  useEffect(() => {
    if (!open) return;
    const first = panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, [open]);

  const items = (): HTMLElement[] =>
    Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>): void {
    const list = items();
    if (list.length === 0) return;
    const index = list.findIndex((el) => el === document.activeElement);
    let next = -1;
    switch (event.key) {
      case 'ArrowDown':
        next = (index + 1) % list.length;
        break;
      case 'ArrowUp':
        next = (index - 1 + list.length) % list.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = list.length - 1;
        break;
      case 'Tab':
        close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    list[next]?.focus();
  }

  const classes = className ? `${styles['profile-menu']} ${className}` : styles['profile-menu'];

  if (!viewer) {
    return (
      <div className={classes}>
        <GoogleSignInButton label="Sign in" from="nav" />
      </div>
    );
  }

  // Your profile · [Admin] — handle and picture are edited on /profile itself (ADR-0018).
  const links: MenuItem[] = [
    { label: 'Your profile', href: '/profile' },
    ...(viewer.role === 'moderator' || viewer.role === 'admin'
      ? [{ label: 'Admin', href: '/admin' }]
      : []),
  ];

  return (
    <div ref={rootRef} className={classes} data-state={open ? 'open' : 'closed'}>
      <button
        ref={triggerRef}
        type="button"
        className={styles['profile-menu-trigger']}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {/* decorative: the handle text sits beside it (03 `Avatar` a11y: alt="" when adjacent) — the
            handle still feeds the initial glyph, so the wrapper hides it instead */}
        <span aria-hidden="true" className={styles['profile-menu-avatar']}>
          <Avatar src={viewer.avatarUrl} alt={viewer.handle} size={28} border={2} />
        </span>
        <span className={styles['profile-menu-handle']}>{viewer.handle}</span>
        <span className={styles['profile-menu-caret']} aria-hidden="true">
          ▾
        </span>
      </button>
      <div
        id={panelId}
        ref={panelRef}
        role="menu"
        aria-label="Account"
        className={styles['profile-menu-panel']}
        hidden={!open}
        onKeyDown={onMenuKey}
      >
        {open ? (
          <>
            <div className={styles['profile-menu-header']}>
              <span aria-hidden="true" className={styles['profile-menu-avatar']}>
                <Avatar src={viewer.avatarUrl} alt={viewer.handle} size={40} border={2} />
              </span>
              <div className={styles['profile-menu-header-text']}>
                <span className={styles['profile-menu-header-handle']}>{viewer.handle}</span>
                <PixelLabel size={11} tone="mute-dim">
                  SIGNED IN
                </PixelLabel>
              </div>
            </div>
            {/* items sit directly in the role=menu panel — a <ul>/<li> (role=list/listitem) between
                them breaks aria-required-children / aria-required-parent (axe critical) */}
            {links.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                className={styles['profile-menu-item']}
                onClick={() => close(false)}
              >
                {item.label}
              </Link>
            ))}
            <form method="post" action="/auth/sign-out" className={styles['profile-menu-sign-out']}>
              <button
                type="submit"
                role="menuitem"
                className={styles['profile-menu-sign-out-button']}
              >
                Sign out
              </button>
            </form>
          </>
        ) : null}
      </div>
    </div>
  );
}
