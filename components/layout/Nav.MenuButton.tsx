'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { Icon } from '@/components/primitives/Icon';
import styles from './Nav.module.css';

/**
 * NavMenuButton — 44px burger + full-width phone panel under the bar (03 N-05, N-08).
 * Same links in order, Support last as a full-width gold Button. Esc closes, focus returns to
 * the burger, body scroll is locked while open, closes on route change. Display: none ≥900px.
 */
export type NavMenuButtonProps = {
  links: { label: string; href: string }[];
  support: { label: string; href: string };
  /** Panel element id (default `nav-menu`); only the component preview passes another value so two instances can coexist (03 C-03). */
  panelId?: string;
};

const PANEL_ID = 'nav-menu';

/** Same rule as NavLinks (02 RP-12): pathname === href or startsWith(href + '/'). */
function isCurrentPath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavMenuButton({ links, support, panelId = PANEL_ID }: NavMenuButtonProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const burgerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Close on route change (03 N-05) — derived-state adjustment during render, no effect.
  const [seenPathname, setSeenPathname] = useState(pathname);
  if (pathname !== seenPathname) {
    setSeenPathname(pathname);
    setOpen(false);
  }

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  // Esc closes; focus returns to the burger; body scroll locked while open.
  useEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        wasOpen.current = false;
        burgerRef.current?.focus();
      }
      return;
    }
    wasOpen.current = true;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        ref={burgerRef}
        type="button"
        className={styles['nav-burger']}
        aria-label="Menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <Icon name={open ? 'close' : 'menu'} />
      </button>
      <div
        id={panelId}
        className={styles['nav-menu']}
        data-state={open ? 'open' : 'closed'}
        hidden={!open}
      >
        {/* Panel content mounts only while open: one Support link in the <nav> at a time. */}
        {open ? (
          <>
            <ul className={styles['nav-menu-list']}>
              {links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={styles['nav-menu-link']}
                    aria-current={isCurrentPath(pathname, link.href) ? 'page' : undefined}
                    onClick={close}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className={styles['nav-menu-support']}>
              <Button
                variant="gold"
                href={support.href}
                className={styles['nav-menu-support-button']}
              >
                {support.label}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
