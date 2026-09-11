import type { ReactNode } from 'react';
import styles from './template.module.css';

/**
 * Route-change fade (ADR-0035 D3; DESIGN.md §8 Motion). `template.tsx` remounts on every
 * navigation inside this segment — unlike `layout.tsx` — so the page (not the chrome) eases in:
 * opacity 0 → 1 and a 3px lift over `--dur-fast`, opacity only under `prefers-reduced-motion`.
 * Server Component; no state, no providers, no `experimental.*` (ADR-0002 C1).
 */
export default function PageTemplate({ children }: { children: ReactNode }) {
  return <div className={styles['page-in']}>{children}</div>;
}
