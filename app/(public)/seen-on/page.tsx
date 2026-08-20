import type { Metadata } from 'next';
import styles from '../placeholder.module.css';

/**
 * `/seen-on` — S0 placeholder (ADR-0002 C20; 02 RP-16; ADR-0005): title + "Not yet. Soon.".
 * Static: no data reads, no `revalidate`, no `loading.tsx`. Replaced by the real page in its slice.
 */
export const metadata: Metadata = {
  title: 'Seen on',
  alternates: { canonical: '/seen-on' },
};

export default function SeenOnPage() {
  return (
    <section className={styles.placeholder}>
      <h1 className={styles['placeholder-title']}>SEEN ON</h1>
      <p className={styles['placeholder-line']}>Not yet. Soon.</p>
    </section>
  );
}
