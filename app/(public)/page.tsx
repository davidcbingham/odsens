import type { Metadata } from 'next';
import styles from './page.module.css';

/**
 * Home `/` — S0 shell (02 §2.1; 00 S0). ISR shell with no data reads (01 INV-38).
 * FeaturedHero + Featured 4-up arrive in S1.2; Latest videos S1.6; IN THE WILD S1.8; TipPanel S1.9.
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: { absolute: 'odsens' },
  alternates: { canonical: '/' },
};

export default function HomePage() {
  return (
    <section className={styles.home}>
      <h1 className={styles['home-title']}>ODSENS</h1>
      <p className={styles['home-line']}>Mods and other odd things, made by OddSense.</p>
    </section>
  );
}
