import { GoogleSignInButton } from '@/components/primitives/GoogleSignInButton';
import styles from './AdminGate.module.css';

/**
 * AdminGate — DESIGN.md §11.3 #18 Admin sign-in gate (pass-3 "Admin gate" frame); 03 §2.10
 * `AdminGate`; ADR-0002 C4. Rendered only for anon on `/admin/*` (HTTP 200): a 400px slab with
 * "ADMINS ONLY" in Bungee and the chalk Google button. Nothing else on the page — no other variant.
 */
export type AdminGateProps = Record<string, never>;

export function AdminGate() {
  return (
    <div className={styles['admin-gate']}>
      <section className={styles['admin-gate-slab']} aria-labelledby="admin-gate-title">
        <h1 id="admin-gate-title" className={styles['admin-gate-title']}>
          ADMINS ONLY
        </h1>
        <GoogleSignInButton from="admin" next="/admin" />
      </section>
    </div>
  );
}
