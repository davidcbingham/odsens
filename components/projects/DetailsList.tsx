import type { ReactNode } from 'react';
import styles from './DetailsList.module.css';

/**
 * DetailsList — DESIGN.md §6 #3 "DETAILS list (type, updated, licence, source)"; pass-3 detail
 * mockup (label left in mute, value right 700 chalk); 03 §2.3 `DetailsList` row. Server
 * Component (03 C-16). A bare `<dl>` of `<dt>/<dd>` pairs — the page owns the surrounding
 * panel slab and DETAILS eyebrow. Values are `ReactNode` so `Source` can be a link.
 */
export type DetailsListItem = {
  label: string;
  value: ReactNode;
};

export type DetailsListProps = {
  items: DetailsListItem[];
  className?: string;
};

export function DetailsList({ items, className }: DetailsListProps) {
  const classes = className ? `${styles['details-list']} ${className}` : styles['details-list'];
  return (
    <dl className={classes}>
      {items.map(({ label, value }) => (
        <div key={label} className={styles['details-list-row']}>
          <dt className={styles['details-list-label']}>{label}</dt>
          <dd className={styles['details-list-value']}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
