import { PixelLabel } from '@/components/primitives/PixelLabel';
import styles from './page.module.css';

/**
 * `/admin` — dashboard placeholder (02 §1.3; 00 S1.1 "AdminShell dashboard placeholder").
 * S1.2 adds `SyncStatus`, S1.4 the held count, S1.6 the videos list. Title comes from the layout.
 * The page's one `h1` is visually hidden ("Admin" — DESIGN.md §9 headings in order; `AdminShell` has
 * no heading); the "ADMIN" `PixelLabel` is an eyebrow (`as="p"`), never a heading. Bungee section
 * titles arrive with S1.2.
 */
export default function AdminPage() {
  return (
    <section className={styles['admin-home']}>
      <h1 className="visually-hidden">Admin</h1>
      <PixelLabel as="p" tone="gold" size={11}>
        ADMIN
      </PixelLabel>
      <p className={styles['admin-home-line']}>Nothing to do yet.</p>
    </section>
  );
}
