'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import type { AdminNavItem } from './AdminShell';
import styles from './AdminShell.module.css';

/**
 * AdminNav — the sidebar leaf of `AdminShell` (03 §2.10; file `AdminShell.Nav.tsx`). Client for
 * `usePathname` → `aria-current="page"` (4px `--gold` left bar + `--chalk` 700). Comments carries
 * the held count as a `PixelLabel` (`--gold` when > 0) with an sr "N held". Phone: a top row with
 * `overflow-x: auto` (shared `AdminShell.module.css`).
 */
export type AdminNavProps = { items: AdminNavItem[] };

function isCurrent(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav({ items }: AdminNavProps) {
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className={styles['admin-nav']}>
      <ul className={styles['admin-nav-list']}>
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={styles['admin-nav-link']}
              aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
            >
              <span>{item.label}</span>
              {typeof item.count === 'number' ? (
                <>
                  <PixelLabel
                    size={11}
                    informational
                    tone={item.count > 0 ? 'gold' : 'mute-dim'}
                    className={styles['admin-nav-count']}
                  >
                    {String(item.count)}
                  </PixelLabel>
                  <span className="visually-hidden"> held</span>
                </>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
