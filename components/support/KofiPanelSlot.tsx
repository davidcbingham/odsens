'use client';

import { PixelLabel } from '@/components/primitives/PixelLabel';
import { kofiEmbedUrl } from '@/lib/support';
import styles from './KofiPanelSlot.module.css';

/**
 * KofiPanelSlot — DESIGN.md §11.4 ("a labelled dashed slot shows where Ko-fi's own panel renders —
 * their look, inside our frame"), §12.7 C19; 03 §2.9 `KofiPanelSlot` row; 01 INV-58; 04 §5.7.
 * Client island (03 C-16a): the ONLY place a Ko-fi iframe may appear, and only once `loaded` —
 * click-to-load like every other embed, so nothing is fetched from Ko-fi before CONTINUE ON KO-FI.
 * `idle` = dashed slot + `PixelLabel` + one line; `loaded` = the iframe, 712px desktop / 620px
 * phone (ADR-0002 #50). `amount` is accepted for the day Ko-fi documents a preset-amount parameter
 * (04 §5.7) — it is not part of the URL in v1.
 */
export type KofiPanelSlotProps = {
  kofiPage: string;
  amount: number | null;
  loaded: boolean;
};

export function KofiPanelSlot({ kofiPage, loaded }: KofiPanelSlotProps) {
  return (
    <div className={styles['kofi-slot']} data-state={loaded ? 'loaded' : 'idle'} aria-live="polite">
      {loaded ? (
        <>
          <p className="visually-hidden">Ko-fi panel loading below.</p>
          <iframe
            className={styles['kofi-slot-frame']}
            src={kofiEmbedUrl(kofiPage)}
            title="Ko-fi"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </>
      ) : (
        <div className={styles['kofi-slot-idle']}>
          <PixelLabel size={11} tone="mute-dim">
            KO-FI PANEL LOADS HERE
          </PixelLabel>
          <p className={styles['kofi-slot-line']}>Their look, our frame.</p>
        </div>
      )}
    </div>
  );
}
