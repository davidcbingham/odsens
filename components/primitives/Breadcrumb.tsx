import Link from 'next/link';
import styles from './Breadcrumb.module.css';

/**
 * Breadcrumb — DESIGN.md §6 #3 Project detail "breadcrumb"; 03 §2.2 `Breadcrumb`.
 * Server component: `<nav aria-label="Breadcrumb"><ol>`, 14px `--mute`, `/` separators
 * `aria-hidden`, last item `aria-current="page"` in `--chalk`.
 * e2e: `/projects/[slug]` has `nav[aria-label=Breadcrumb]` with last item
 * `aria-current=page` (05 T-E2E S1.2).
 */
export type BreadcrumbProps = {
  items: { label: string; href?: string }[];
  className?: string;
};

export function Breadcrumb({ items, className }: BreadcrumbProps) {
  const classes = className ? `${styles.breadcrumb} ${className}` : styles.breadcrumb;
  return (
    <nav aria-label="Breadcrumb" className={classes}>
      <ol className={styles['breadcrumb-list']}>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className={styles['breadcrumb-item']}>
              {typeof item.href === 'string' ? (
                <Link
                  href={item.href}
                  className={styles['breadcrumb-link']}
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined}>{item.label}</span>
              )}
              {last ? null : (
                <span className={styles['breadcrumb-sep']} aria-hidden="true">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
