import { Button } from '@/components/primitives/Button';
import styles from './TipPanel.module.css';

/**
 * TipPanel — DESIGN.md §6 #1 "compact gold tip panel" / §6 #3 rail "gold tip panel", §11.4;
 * 03 §2.3 `TipPanel` row ("gold hatched slab (`--gold` + `--hatch`), `--gold-ink` text, one dry
 * line, `Button variant="gold-ink"` → `/support`. No begging copy (§7)"). Server Component.
 *
 * S1.2 renders the placeholder slab pointing at `/support` (00 S1.2: "`TipPanel` **placeholder
 * slab pointing at `/support`** until S1.9"); S1.9 lands the final §7-voice copy and swaps the
 * link to `TrackedLink event="tip_click"` `{ from: 'tip-panel' }` — only `download` is wired in
 * S1.2 (ADR-0002 A10), so this is a plain `Button` link for now. Dry line borrowed from the
 * pass-3 tip-panel mockup (provisional until S1.9). `compact` = the Home variant (§6 #1),
 * `data-compact` flag (03 C-14).
 */
export type TipPanelProps = {
  compact?: boolean;
  className?: string;
};

export function TipPanel({ compact = false, className }: TipPanelProps) {
  const classes = className ? `${styles['tip-panel']} ${className}` : styles['tip-panel'];
  return (
    <aside aria-label="Support" className={classes} {...(compact ? { 'data-compact': '' } : {})}>
      <p className={styles['tip-panel-line']}>Keeps the mods free and the pipe loud.</p>
      <Button variant="gold-ink" href="/support">
        Tip a dollar
      </Button>
    </aside>
  );
}
