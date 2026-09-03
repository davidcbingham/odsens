import type { ReactNode } from 'react';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import styles from './HeldNotice.module.css';

/**
 * HeldNotice — DESIGN.md §5 Held for review; 03 §2.4 `HeldNotice`; 00 S1.4.AC4. Shared (no
 * directive): rendered inside the author's own held bubble by the client `Comment`
 * (`data-state="held"` draws the dashed 2px `--gold-deep` border on the bubble — this component
 * only owns the label, the body slot and the line). `⏳ HELD FOR REVIEW` = the prescribed glyph
 * (`aria-hidden`, 03 C-30) + a gold informational `PixelLabel` (11px — 03 C-27), then the body
 * (`children`, the pass-3 frame's order: label · body · line), then the plain line verbatim.
 * Author-only: the moderator view of a held comment renders the dashed bubble without it.
 */
export const HELD_LABEL = 'HELD FOR REVIEW';
export const HELD_LINE = 'Only you can see this until OddSense approves it. Usually quick.';

export type HeldNoticeProps = {
  /** The comment body, rendered between the label and the line. */
  children?: ReactNode;
  className?: string;
};

export function HeldNotice({ children, className }: HeldNoticeProps) {
  const classes = className ? `${styles['held-notice']} ${className}` : styles['held-notice'];
  return (
    <div className={classes} role="status">
      <p className={styles['held-notice-label']}>
        <span aria-hidden="true">⏳</span>
        <PixelLabel informational tone="gold">
          {HELD_LABEL}
        </PixelLabel>
      </p>
      {children}
      <p className={styles['held-notice-line']}>{HELD_LINE}</p>
    </div>
  );
}
