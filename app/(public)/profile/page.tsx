import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ProfilePanel } from '@/components/accounts/ProfilePanel';
import { getViewer } from '@/lib/auth';
import { publicEnv } from '@/lib/env/public';
import { formatDay } from '@/lib/format/date';
import styles from './page.module.css';

/**
 * `/profile` — DESIGN.md §11.3 #11 Your profile; 02 §1.1, §2.5. Dynamic, `onboarded`: anon → 307 `/`;
 * null handle → 307 `/welcome?next=/profile`. 720px column: title, then the `ProfilePanel` (picture
 * row `#picture`, handle row `#handle` + SAVE, footer strip with Delete account). `noindex`.
 * Data = `getViewer()` only (01 INV-12: pages never import a Supabase client or call `.from(`); the avatar URL
 * is the public-bucket template over `publicEnv` (the same one `ViewerProvider` uses) — `lib/files.ts`
 * is server-only and pulls the admin client in, which a page must never do (01 INV-14).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your profile',
  robots: { index: false, follow: false },
};

/** 04 §1.1 `updateProfile`: one rename per 7 days, measured from `profiles.handle_changed_at`. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function avatarUrl(path: string | null): string | null {
  if (!path) return null;
  return `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${path}`;
}

/**
 * The day the next rename is allowed, as `YYYY-MM-DD` (ADR-0002 #27; the same arithmetic and
 * `formatDay` as `updateProfile`'s `rate_limited` message), or null once the window has passed.
 * Computed here, per request, so `ProfilePanel` only renders a string and never reads the clock.
 */
function limitedUntilOf(handleChangedAt: string | null): string | null {
  if (!handleChangedAt) return null;
  const changed = Date.parse(handleChangedAt);
  if (Number.isNaN(changed)) return null;
  const until = changed + SEVEN_DAYS_MS;
  return until > Date.now() ? formatDay(new Date(until)) : null;
}

export default async function ProfilePage() {
  const viewer = await getViewer();
  if (!viewer) redirect('/');
  const profile = viewer.profile;
  if (!profile || !profile.handle) redirect('/welcome?next=/profile');

  return (
    <section className={styles.profile}>
      <div className={styles['profile-head']}>
        <h1 className={styles['profile-title']}>YOUR PROFILE</h1>
        <p className={styles['profile-line']}>
          Two things live here. That&apos;s the whole account.
        </p>
      </div>
      <ProfilePanel
        handle={profile.handle}
        avatarUrl={avatarUrl(profile.avatar_path)}
        limitedUntil={limitedUntilOf(profile.handle_changed_at)}
      />
    </section>
  );
}
