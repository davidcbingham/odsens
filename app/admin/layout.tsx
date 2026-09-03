import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AdminGate } from '@/components/admin/AdminGate';
import { AdminShell } from '@/components/admin/AdminShell';
import { SkipLink } from '@/components/layout/SkipLink';
import { ToastProvider } from '@/components/layout/Toast';
import { getViewer } from '@/lib/auth';
import { countHeldComments } from '@/lib/data/admin';
import { publicEnv } from '@/lib/env/public';

/**
 * `app/admin/layout.tsx` — the role gate (02 §4 "Admin gate", RP-09, RP-11; ADR-0002 C4; 01 INV-31).
 * `getViewer()`: no user → `AdminGate` (HTTP 200, no shell); user without a handle → 307
 * `/welcome?next=/admin` (the proxy does this too); role `user` → `notFound()` = the root 404, never
 * a 403 body or a gate variant; `moderator|admin` → `AdminShell` with the RP-14 sidebar. The proxy
 * never reads `role` (02 RP-19) — this file is the only place the admin role is checked for pages.
 * `noindex` metadata here + `X-Robots-Tag` from next.config.ts (02 RP-07).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

/** Public-bucket template (same as `ViewerProvider` / `/profile`); `lib/files.ts` is server-only + admin client (01 INV-14). */
function avatarUrl(path: string | null): string | null {
  if (!path) return null;
  return `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;
}

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer();

  if (!viewer) {
    return (
      <>
        <SkipLink />
        <ToastProvider>
          <main id="main" tabIndex={-1}>
            <AdminGate />
          </main>
        </ToastProvider>
      </>
    );
  }

  const profile = viewer.profile;
  if (!profile || !profile.handle) redirect('/welcome?next=/admin');
  if (profile.role === 'user') notFound();

  // 02 §1.3 `/admin` Data cell: `comments` count where `status='held'` — the RP-14 sidebar count
  // (S1.4). Read after the role gate on the request-cookie client (`lib/data/admin.ts`, 01
  // INV-12); moderators read every comment row (data-model §4), so the number is exact for
  // both roles. The layout is `force-dynamic`, so a `router.refresh()` from `ModActionRow`
  // re-reads it (05 T-E2E-36 "queue count in sidebar updates").
  const heldComments = await countHeldComments();

  return (
    <>
      <SkipLink />
      <ToastProvider>
        <AdminShell
          viewer={{
            handle: profile.handle,
            role: profile.role,
            avatarUrl: avatarUrl(profile.avatar_path),
          }}
          counts={{ heldComments }}
        >
          {children}
        </AdminShell>
      </ToastProvider>
    </>
  );
}
