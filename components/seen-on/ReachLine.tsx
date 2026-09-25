import { Fragment } from 'react';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { formatReachLine } from '@/lib/format/reach';
import styles from './ReachLine.module.css';

/**
 * ReachLine — DESIGN.md §12.1 Reach line ("Silkscreen emerald, letter-spaced: '1.2M VIEWS · 6
 * VIDEOS · 4 CREATORS'. The numbers brag, the copy doesn't."); 03 §2.8 `ReachLine` row; 02 §2.1
 * item 3; 05 T-UNIT-9 (`formatReachLine`); ADR-0002 #77; ADR-0045 D18. Server Component.
 *
 * A `<p>` of `PixelLabel` segments (`tone="emerald" size={11} informational`) joined by ` · `: the
 * whole line is eight words and `PixelLabel` refuses more than five (it is never a sentence), so
 * each segment — at most two words — is its own label, and the separators are plain text set in
 * the same Silkscreen, so the line's DOM text is exactly `1.2M VIEWS · 6 VIDEOS · 4 CREATORS`. The visible run is `aria-hidden`; a screen
 * reader gets the `spoken` form instead, with the abbreviations expanded ("1.2 million views").
 * Numbers and nouns come from `lib/format/reach.ts`: compact counts, singular for exactly 1, no
 * views segment when the total is 0 (a platform that gives no count is not a zero). Totals are the
 * caller's — over ALL published mentions, never the featured subset (`reachTotals`).
 *
 * Nothing to say (no mentions at all) → renders nothing.
 */
export type ReachLineProps = {
  views: number;
  videos: number;
  creators: number;
  className?: string;
};

export function ReachLine({ views, videos, creators, className }: ReachLineProps) {
  const { segments, spoken } = formatReachLine({ views, videos, creators });
  if (segments.length === 0) return null;

  const classes = className ? `${styles['reach-line']} ${className}` : styles['reach-line'];
  return (
    <p className={classes}>
      <span className={styles['reach-line-run']} aria-hidden="true">
        {segments.map((segment, index) => (
          <Fragment key={segment}>
            {/* A real text separator: the line's DOM text is the 05 T-UNIT-9 string, verbatim. */}
            {index > 0 ? ' · ' : null}
            <PixelLabel size={11} informational tone="emerald">
              {segment}
            </PixelLabel>
          </Fragment>
        ))}
      </span>
      <span className="visually-hidden">{spoken}</span>
    </p>
  );
}
