'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/primitives/Button';
import { Chip } from '@/components/primitives/Chip';
import styles from './ActiveFilterChips.module.css';

/**
 * ActiveFilterChips — DESIGN.md §5 "Active filters echo below as removable chips plus a Clear
 * ghost link"; 03 §2.3 `ActiveFilterChips` row. Client island (03 C-16a:
 * `components/projects/ActiveFilterChips.tsx`), child of `ProjectGrid` (ADR-0002 A7). Reads
 * `useSearchParams`, removes a key with `router.replace({scroll:false})` (02 RP-02); never
 * fetches (01 INV-09). No active filter params → renders nothing. "Clear" (ghost `Button`
 * `arrow={false}`) removes ALL filter params and keeps `q` (03 row, verbatim).
 */
export type ActiveFilterChipsProps = {
  /** Param value → display label (built by `ProjectGrid` from its groups/selects). */
  labels: Record<string, string>;
};

/** The filter params that echo as chips (02 §2.2: `type`, `version`; `sort`/`q` are not filters). */
const FILTER_KEYS = ['type', 'version'] as const;

export function ActiveFilterChips({ labels }: ActiveFilterChipsProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const active = FILTER_KEYS.flatMap((key) => {
    const value = searchParams.get(key);
    return value === null || value === '' ? [] : [{ key, value }];
  });

  if (active.length === 0) return null;

  const replaceWithout = (keys: readonly string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of keys) params.delete(key);
    const qs = params.toString();
    router.replace(qs === '' ? pathname : `${pathname}?${qs}`, { scroll: false });
  };

  return (
    <ul aria-label="Active filters" className={styles['active-filter-chips']}>
      {active.map(({ key, value }) => (
        <li key={key} className={styles['active-filter-chips-item']}>
          <Chip label={labels[value] ?? value} onRemove={() => replaceWithout([key])} />
        </li>
      ))}
      <li className={styles['active-filter-chips-item']}>
        <Button variant="ghost" arrow={false} onClick={() => replaceWithout(FILTER_KEYS)}>
          Clear
        </Button>
      </li>
    </ul>
  );
}
