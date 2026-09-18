'use client';

import { PixelLabel } from '@/components/primitives/PixelLabel';
import { kofiEmbedUrl } from '@/lib/support';
import styles from './KofiPanelSlot.module.css';

/**
 * KofiPanelSlot — DESIGN.md §11.4 v1.11 ("replaces the slab with Ko-fi's own panel — their look,
 * inside our frame"; the dashed labelled slot "survives only as the component gallery's stand-in"),
 * §12.7 C19; 03 §2.9 `KofiPanelSlot` row; 01 INV-58; 04 §5.7.
 * Client island (03 C-16a): the ONLY place a Ko-fi iframe may appear, and only once `loaded` —
 * click-to-load like every other embed, so nothing is fetched from Ko-fi before TIP ON KO-FI.
 * `loaded` = the iframe, 712px desktop / 620px phone (ADR-0002 #50) — what `KofiCard` renders in
 * place of its slab (ADR-0042 D2). `idle` = dashed slot + `PixelLabel` + one line — no page shows
 * it any more; it stays for the `/dev/components` gallery, which never frames Ko-fi. There is no
 * `amount`: Ko-fi's panel takes no preset (ADR-0042 D1).
 */
export type KofiPanelSlotProps = {
  kofiPage: string;
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
