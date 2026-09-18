'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { KofiPanelSlot } from '@/components/support/KofiPanelSlot';
import { trackEvent } from '@/lib/analytics';
import { kofiPageUrl } from '@/lib/support';
import styles from './KofiCard.module.css';

/**
 * KofiCard — DESIGN.md §6 #7 Support, §11.4 wrapper, §12.7 C19; 03 §2.9 `KofiCard` row; 02 §2.7;
 * 04 §5.6 / §5.7. Client island (03 C-16a). Was `AmountPicker` until ADR-0042: Ko-fi's panel takes
 * no preset amount (no URL parameter, no message channel — 04 §5.7), so a $1 / $3 / $5 picker of
 * ours was a choice the panel then contradicted. The amount is chosen once, in Ko-fi.
 *
 * `card` (default): the gold hatched slab — title, one line, one TIP ON KO-FI
 * `Button variant="gold-ink"` and the "on Ko-fi ↗" ghost link (the only thing that leaves the
 * site). The button fires `tip_click {from:'support'}` and swaps the slab for Ko-fi's panel IN
 * PLACE — `panel`: a bar with "← Back" and the same ghost link over `KofiPanelSlot` `loaded`. One
 * box at a time, never both (ADR-0042 D2). Focus follows the swap: to Back when the panel opens, to
 * the button when it closes. Nothing is fetched from Ko-fi before the click (01 INV-58).
 *
 * `kofiPage === null` (Settings → Ko-fi page name empty): button disabled, the line
 * "Tips open soon.", no ghost link, no panel (04 §5.7; 00 S1.5b.AC1).
 */
export type KofiCardProps = {
  kofiPage: string | null;
};

export function KofiCard({ kofiPage }: KofiCardProps) {
  const [open, setOpen] = useState(false);
  const tipRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const swapped = useRef(false);

  // Move focus with the swap — but never on first render.
  useEffect(() => {
    if (!swapped.current) return;
    (open ? backRef : tipRef).current?.focus();
  }, [open]);

  function show(next: boolean) {
    swapped.current = true;
    setOpen(next);
  }

  function handleTip() {
    if (kofiPage === null) return;
    trackEvent('tip_click', { from: 'support' });
    show(true);
  }

  const out =
    kofiPage === null ? null : (
      <a
        className={styles['kofi-card-out']}
        href={kofiPageUrl(kofiPage)}
        target="_blank"
        rel="noopener noreferrer"
      >
        on Ko-fi ↗<span className="visually-hidden">(opens in new tab)</span>
      </a>
    );

  if (open && kofiPage !== null) {
    return (
      <section className={styles['kofi-card']} data-state="panel" aria-label="Tip on Ko-fi">
        <div className={styles['kofi-card-bar']}>
          <button
            ref={backRef}
            type="button"
            className={styles['kofi-card-back']}
            onClick={() => show(false)}
          >
            <span aria-hidden="true">←</span> Back
          </button>
          {out}
        </div>
        <KofiPanelSlot kofiPage={kofiPage} loaded />
      </section>
    );
  }

  return (
    <div className={styles['kofi-card']} data-state="card">
      <div
        className={styles['kofi-card-slab']}
        {...(kofiPage === null ? { 'data-disabled': '' } : {})}
      >
        <h2 className={styles['kofi-card-title']}>BUY ME A BLOCK</h2>
        <p className={styles['kofi-card-line']}>
          Tips go through Ko-fi. You pick the amount there.
        </p>
        <div className={styles['kofi-card-actions']}>
          <Button ref={tipRef} variant="gold-ink" disabled={kofiPage === null} onClick={handleTip}>
            TIP ON KO-FI
          </Button>
          {kofiPage === null ? (
            <p className={styles['kofi-card-soon']}>Tips open soon.</p>
          ) : (
            <>
              <p className={styles['kofi-card-note']}>Loads right here. No account needed.</p>
              {out}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
