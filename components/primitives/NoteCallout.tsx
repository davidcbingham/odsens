import type { ReactNode } from 'react';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import styles from './NoteCallout.module.css';

/**
 * NoteCallout — DESIGN.md §6.3 "note callout with a Silkscreen NOTE tag", §11.3 #12 Privacy;
 * 03 §2.2 `NoteCallout`. Server component: `--slab-raised` slab, 2px `--line-soft`, `PixelLabel`
 * NOTE tag top-left, body 15–17px. `<aside aria-label="Note">`.
 */
export type NoteCalloutProps = {
  children: ReactNode;
  /** Tag text (default NOTE). */
  label?: string;
  className?: string;
};

export function NoteCallout({ children, label = 'NOTE', className }: NoteCalloutProps) {
  const classes = className ? `${styles['note-callout']} ${className}` : styles['note-callout'];
  return (
    <aside aria-label="Note" className={classes}>
      <PixelLabel tone="gold" size={11}>
        {label}
      </PixelLabel>
      <div className={styles['note-callout-body']}>{children}</div>
    </aside>
  );
}
