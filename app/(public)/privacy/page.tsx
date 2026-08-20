import type { Metadata } from 'next';
import { NoteCallout } from '@/components/primitives/NoteCallout';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import styles from './page.module.css';

/**
 * `/privacy` — DESIGN.md §11.3 #12 + §12.5 + §12.7 #24 (pass-3 "Privacy desktop" frame); 02 §1.1
 * ISR(600; —), no data. Bungee "WHAT WE KEEP", gold Bungee h2s, the handle guidance sentence, the
 * Google age-rules line, and the closing NOTE callout (05 T-E2E-12 strings).
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What odsens keeps: a handle, a picture if you upload one, and your comments.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <article className={styles.privacy}>
      <header className={styles['privacy-head']}>
        <PixelLabel tone="gold" size={11}>
          PRIVACY
        </PixelLabel>
        <h1 className={styles['privacy-title']}>WHAT WE KEEP</h1>
        <p className={styles['privacy-lead']}>
          Short version: a handle, a picture if you upload one, and whatever you type in the
          comments. No legalese below, either.
        </p>
      </header>

      <section className={styles['privacy-section']} aria-labelledby="store">
        <h2 id="store" className={styles['privacy-h2']}>
          WHAT WE STORE
        </h2>
        <ul className={styles['privacy-list']}>
          <li>Your Google account ID, so signing in works. Nothing else from Google.</li>
          <li>Your handle.</li>
          <li>Your picture, if you uploaded one.</li>
          <li>Your comments, likes and reports.</li>
        </ul>
        <p className={styles['privacy-body']}>That&apos;s the list.</p>
        <p className={styles['privacy-body']}>
          Handles are made-up names. Don&apos;t use your real one — nobody here needs to know it,
          including us.
        </p>
      </section>

      <section className={styles['privacy-section']} aria-labelledby="never">
        <h2 id="never" className={styles['privacy-h2']}>
          WHAT WE NEVER SHOW
        </h2>
        <p className={styles['privacy-body']}>
          Your real name. Your email. Your age, your location, your school. We don&apos;t ask for
          them and we don&apos;t display them — anywhere on the site you are your handle.
        </p>
      </section>

      <section className={styles['privacy-section']} aria-labelledby="tips">
        <h2 id="tips" className={styles['privacy-h2']}>
          TIPS AND DOWNLOADS
        </h2>
        <p className={styles['privacy-body']}>
          Tips happen on Ko-fi, under Ko-fi&apos;s own privacy terms. We only see that a tip
          arrived. Download counts are numbers, not people.
        </p>
      </section>

      <section className={styles['privacy-section']} aria-labelledby="deleting">
        <h2 id="deleting" className={styles['privacy-h2']}>
          DELETING YOUR ACCOUNT
        </h2>
        <p className={styles['privacy-body']}>
          Your profile has a Delete account button. It removes your handle, your picture and your
          comments. It can&apos;t be undone, and we don&apos;t keep a copy.
        </p>
      </section>

      <NoteCallout>
        Sign-in needs a Google account; Google&apos;s age rules apply. You can still download
        everything without an account.
      </NoteCallout>
    </article>
  );
}
