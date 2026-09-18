import { TrackedLink } from '@/components/primitives/TrackedLink';
import styles from './TipPanel.module.css';

/**
 * TipPanel — DESIGN.md §6 #1 "compact gold tip panel" / §6 #3 rail "gold tip panel", §11.4;
 * 03 §2.3 `TipPanel` row ("gold hatched slab (`--gold` + `--hatch`), `--gold-ink` text, one plain
 * line, gold-ink button → `/support`. No begging copy (§7)"). Server Component — static: it never
 * reads `kofi_page` (only `/support` reacts to an empty page name, 04 §5.7).
 *
 * The line is the plain "Support OddSense on Ko-fi." (ADR-0035 D5 — the pass-3 slogan came out at
 * Oliver's request; 03 fixes it as the final copy). S1.5b swaps the plain `Button` link for a
 * `TrackedLink event="tip_click"` `{ from: 'tip-panel' }` (04 §5.6 — no `amount`): the gold-ink
 * button look lives in this module's CSS and the `<a>` carries `data-variant="gold-ink"` (03 §2.3
 * Tests cell; the 05 e2e locator) — the `GetItPanel` pattern. `compact` = the Home variant
 * (§6 #1), `data-compact` flag (03 C-14).
 */
export type TipPanelProps = {
  compact?: boolean;
  className?: string;
};

export function TipPanel({ compact = false, className }: TipPanelProps) {
  const classes = className ? `${styles['tip-panel']} ${className}` : styles['tip-panel'];
  return (
    <aside aria-label="Support" className={classes} {...(compact ? { 'data-compact': '' } : {})}>
      <p className={styles['tip-panel-line']}>Support OddSense on Ko-fi.</p>
      <TrackedLink
        event="tip_click"
        props={{ from: 'tip-panel' }}
        href="/support"
        className={styles['tip-panel-button']}
        data-variant="gold-ink"
      >
        Tip a dollar
      </TrackedLink>
    </aside>
  );
}
