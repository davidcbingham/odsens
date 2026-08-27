import { formatCount } from '@/lib/format/number';
import styles from './StatTile.module.css';

/**
 * StatTile — DESIGN.md §11.1 Stat tile ("Slab, 2px `--line-soft`, 11px Silkscreen label, 34px
 * Bungee number, one 14px line of context"); 03 §2.2 `StatTile`. Server Component — not on the
 * C-16a client-island list (03 §1.4). `<dl>`-shaped: label `<dt>`, value `<dd>`; a number value
 * goes through `lib/format/number.ts` `formatCount` (`1.2M` — ADR-0002 C16 module split), a
 * string renders verbatim. Context tones: `up` → `--emerald`, `attention` → `--gold`,
 * `neutral` → `--mute`. Grid placement (4-across desktop, 2×2 phone) is the parent's duty.
 * Before any snapshot exists the caller passes `0` + context "No data yet." (ADR-0002 #29) —
 * no special-casing here. First use: `/admin` dashboard tiles (02 §1.3, S1.2).
 */
export type StatTileProps = {
  label: string;
  value: string | number;
  context?: { text: string; tone: 'up' | 'attention' | 'neutral' };
  className?: string;
};

export function StatTile({ label, value, context, className }: StatTileProps) {
  const classes = className ? `${styles['stat-tile']} ${className}` : styles['stat-tile'];
  return (
    <dl className={classes}>
      <dt className={styles['stat-tile-label']}>{label}</dt>
      <dd className={styles['stat-tile-value']}>
        {typeof value === 'number' ? formatCount(value) : value}
      </dd>
      {context ? (
        <dd className={styles['stat-tile-context']} data-tone={context.tone}>
          {context.text}
        </dd>
      ) : null}
    </dl>
  );
}
