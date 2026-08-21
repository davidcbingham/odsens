import Link from 'next/link';
import type { ReactNode } from 'react';
import { FLAGS } from '@/lib/flags';
import { ProfileMenu } from '@/components/accounts/ProfileMenu';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { AdminNav } from './AdminShell.Nav';
import styles from './AdminShell.module.css';

/**
 * AdminShell — DESIGN.md §6.9 Admin (220px sidebar, gold left bar), §12.2; 03 §2.10 `AdminShell`;
 * 02 RP-14 sidebar order Comments · Projects · Skins · Art · Mentions · Stats · Settings (admin only)
 * · Orders (only when `FLAGS.commissions`). Server shell; `AdminNav` is the client leaf
 * (`usePathname` active). Header strip: "ADMIN" `PixelLabel` + `ProfileMenu` (viewer passed as a prop —
 * the admin layout mounts no `ViewerProvider`). `<main id="main">` for the page — `mainLandmark={false}`
 * (additive, 03 C-03; `/dev/components` only) renders that slot as a plain `<div>` so the preview page
 * keeps a single, top-level `main` landmark (T-E2E-48 axe).
 */
export type AdminShellProps = {
  /** `avatarUrl` is additive (03 C-03) so the header trigger shows the 28px picture (§11.1). */
  viewer: { handle: string; role: 'moderator' | 'admin'; avatarUrl?: string | null };
  counts: { heldComments: number };
  children: ReactNode;
  /** Default true. `/dev/components` passes false — its own `<main id="main">` wraps the specimen. */
  mainLandmark?: boolean;
};

export type AdminNavItem = { label: string; href: string; count?: number };

export function AdminShell({ viewer, counts, children, mainLandmark = true }: AdminShellProps) {
  const items: AdminNavItem[] = [
    { label: 'Comments', href: '/admin/comments', count: counts.heldComments },
    { label: 'Projects', href: '/admin/projects' },
    { label: 'Skins', href: '/admin/skins' },
    { label: 'Art', href: '/admin/art' },
    { label: 'Mentions', href: '/admin/mentions' },
    { label: 'Stats', href: '/admin/stats' },
    ...(viewer.role === 'admin' ? [{ label: 'Settings', href: '/admin/settings' }] : []),
    ...(FLAGS.commissions ? [{ label: 'Orders', href: '/admin/orders' }] : []),
  ];

  return (
    <div className={styles['admin-shell']}>
      <header className={styles['admin-shell-header']}>
        <div className={styles['admin-shell-header-inner']}>
          <Link href="/admin" className={styles['admin-shell-home']} aria-label="Admin home">
            <PixelLabel tone="chalk" size={12}>
              ADMIN
            </PixelLabel>
          </Link>
          <ProfileMenu
            viewer={{
              handle: viewer.handle,
              avatarUrl: viewer.avatarUrl ?? null,
              role: viewer.role,
            }}
          />
        </div>
      </header>
      <div className={styles['admin-shell-body']}>
        <AdminNav items={items} />
        {mainLandmark ? (
          <main id="main" tabIndex={-1} className={styles['admin-shell-main']}>
            {children}
          </main>
        ) : (
          <div className={styles['admin-shell-main']}>{children}</div>
        )}
      </div>
    </div>
  );
}
