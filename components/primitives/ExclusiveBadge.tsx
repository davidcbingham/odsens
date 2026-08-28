import styles from './ExclusiveBadge.module.css';

/**
 * ExclusiveBadge — DESIGN.md §5 "Exclusive badge" ("★ ONLY ON ODSENS", Silkscreen 10px, gold
 * fill, gold-ink text, hatch overlay, `3px 3px 0 --gold-deep`); 03 §2.2 `ExclusiveBadge`;
 * 00 S1.3.AC1/AC8. Shared (no directive).
 *
 * Static chip, positioned BY THE PARENT (card top-left overlapping the outline by 1px; hero
 * badges row; detail meta row) — the component carries no position rules. One per card. It is
 * NEVER rendered when `source !== 'odsens'`: that is the PARENT's rule via the `isExclusive`
 * predicate, carried as the `exclusive` boolean everywhere (unit-tested in
 * `lib/data/projects.ts` — 05 T-UNIT-36). The `★` glyph is `aria-hidden` and a visually-hidden
 * "Exclusive:" prefix precedes the label — meaning never colour (or glyph) alone (03 C-26).
 */
export type ExclusiveBadgeProps = {
  className?: string;
};

const LABEL = 'ONLY ON ODSENS';

export function ExclusiveBadge({ className }: ExclusiveBadgeProps) {
  const classes = className
    ? `${styles['exclusive-badge']} ${className}`
    : styles['exclusive-badge'];
  return (
    <span className={classes}>
      <span className="visually-hidden">Exclusive: </span>
      <span aria-hidden="true">★ </span>
      {LABEL}
    </span>
  );
}
