import Link from 'next/link';
import { Icon } from '@/components/primitives/Icon';
import styles from './Chip.module.css';

/**
 * Chip — DESIGN.md §5 "Version / loader chip"; 03 §2.2 `Chip`, §3 (ARIA states, no
 * `data-state`). Shared (no directive; becomes client only under a client parent such as
 * `ActiveFilterChips`). Caps are the SURFACE's concern, not Chip's: 2 on `ProjectCard`,
 * 4 on `FeaturedHero` and the detail header, then a plain `Chip` with label `+N`
 * (O-14, ADR-0002 #54). Render rules (03 C-13):
 * - `unavailable` → `<span aria-disabled="true">`, not clickable, not focusable;
 * - `onRemove` → `<button aria-label="Remove filter <label>">` with a trailing ✕ `Icon`
 *   inside the ≥44px target (03 C-24); `removeLabel` replaces that accessible name for a
 *   removable chip that is not a filter (additive, 03 C-03 / ADR-0030 D19 — the admin-email
 *   chips on `/admin/settings` announce "Remove <email>");
 * - `href` → `<a>` via next/link, `aria-current="true"` when selected (never `aria-pressed`
 *   on a link);
 * - `selected` without `href` → radio chip: `role="radio"` + `aria-checked`; the parent
 *   `role="radiogroup"` owns interaction (ReportPicker / AmountPicker slices);
 * - otherwise a plain `<span>`.
 */
export type ChipProps = {
  label: string;
  href?: string;
  selected?: boolean;
  unavailable?: boolean;
  /** `ActiveFilterChips` remove control; client parents only (functions never cross INV-08). */
  onRemove?: () => void;
  /** The removable chip's `aria-label` (default "Remove filter <label>"; ADR-0030 D19). */
  removeLabel?: string;
  className?: string;
};

export function Chip({
  label,
  href,
  selected,
  unavailable = false,
  onRemove,
  removeLabel,
  className,
}: ChipProps) {
  const classes = className ? `${styles.chip} ${className}` : styles.chip;

  if (unavailable) {
    return (
      <span className={classes} aria-disabled="true">
        {label}
      </span>
    );
  }

  if (onRemove) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onRemove}
        aria-label={removeLabel ?? `Remove filter ${label}`}
      >
        {label}
        <Icon name="x" size={16} className={styles['chip-remove-icon']} />
      </button>
    );
  }

  if (typeof href === 'string') {
    return (
      <Link href={href} className={classes} aria-current={selected ? 'true' : undefined}>
        {label}
      </Link>
    );
  }

  if (selected !== undefined) {
    return (
      <span className={classes} role="radio" aria-checked={selected}>
        {label}
      </span>
    );
  }

  return <span className={classes}>{label}</span>;
}
