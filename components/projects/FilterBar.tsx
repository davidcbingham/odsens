'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/primitives/Icon';
import { Select, type SelectOption } from '@/components/primitives/Select';
import { DEFAULT_PROJECT_SORT } from '@/lib/validation/filters';
import { PROJECT_TYPES, typeGlyph, type ProjectType } from '@/lib/format/project';
import styles from './FilterBar.module.css';

/**
 * FilterBar — DESIGN.md §5 "Filter bar", §6.2; 03 §2.3 `FilterBar` row. Client island
 * (03 C-16a: `components/projects/FilterBar.tsx`), child of `ProjectGrid` on `/projects`
 * (ADR-0002 A7). URL is the state (02 RP-02): type buttons are `next/link` `<a>`s with
 * `aria-current="true"` on the active one (03 C-13 — never `aria-pressed` on a link); selects
 * write through `router.replace({scroll:false})`. Reads current values from the URL; never
 * fetches (01 INV-09) — the version options arrive pre-grouped per 03 V-01
 * (`lib/versions.ts` `groupGameVersions()`, built by the page).
 *
 * Look: slab strip 2px `--line`; type buttons Bungee 12px with counts (`MODS 7`), glyph per
 * type (DESIGN.md §4 via `typeGlyph`), active = `--indigo` fill white text; selects right,
 * radius 3px. Phone: type row `overflow-x:auto` (scroll-snap), selects stack. All-types
 * default on `/projects` (02 §2.2: the bar shows ALL + one active).
 */
export type FilterOption = { value: string; label: string; count: number };
export type FilterGroup = {
  /** `'type'` on `/projects`, `'platform'` on `/seen-on` (03 `FilterBar` props). */
  key: string;
  options: FilterOption[];
};
/** 03 props cell: `selects: { name; label; options: SelectOption[] }[]` (`SelectOption` re-used from `Select`). */
export type FilterSelect = { name: string; label: string; options: SelectOption[] };
export type { SelectOption };

export type FilterBarProps = {
  groups: FilterGroup[];
  /** Version + sort on `/projects` (project on `/seen-on`). */
  selects: FilterSelect[];
};

export function FilterBar({ groups, selects }: FilterBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const hrefWith = (key: string, value: string | null): string => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === null) params.delete(key);
    else params.set(key, value);
    const qs = params.toString();
    return qs === '' ? pathname : `${pathname}?${qs}`;
  };

  const onSelect = (name: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === '' || (name === 'sort' && value === DEFAULT_PROJECT_SORT)) params.delete(name);
    else params.set(name, value);
    const qs = params.toString();
    router.replace(qs === '' ? pathname : `${pathname}?${qs}`, { scroll: false });
  };

  return (
    <div role="group" aria-label="Filter" className={styles['filter-bar']}>
      {groups.map((group) => {
        const active = searchParams.get(group.key);
        const total = group.options.reduce((sum, option) => sum + option.count, 0);
        return (
          <div key={group.key} className={styles['filter-bar-types']}>
            <Link
              href={hrefWith(group.key, null)}
              scroll={false}
              className={styles['filter-bar-type']}
              aria-current={active === null ? 'true' : undefined}
            >
              ALL <span className={styles['filter-bar-count']}>{total}</span>
            </Link>
            {group.options.map((option) => (
              <Link
                key={option.value}
                href={hrefWith(group.key, option.value)}
                scroll={false}
                className={styles['filter-bar-type']}
                aria-current={active === option.value ? 'true' : undefined}
              >
                {group.key === 'type' &&
                (PROJECT_TYPES as readonly string[]).includes(option.value) ? (
                  <span className={styles['filter-bar-glyph']} data-type={option.value}>
                    <Icon name={typeGlyph(option.value as ProjectType)} size={16} />
                  </span>
                ) : null}
                {option.label} <span className={styles['filter-bar-count']}>{option.count}</span>
              </Link>
            ))}
          </div>
        );
      })}
      <div className={styles['filter-bar-selects']}>
        {selects.map((select) => (
          <Select
            key={select.name}
            label={select.label}
            name={select.name}
            options={select.options}
            value={
              searchParams.get(select.name) ?? (select.name === 'sort' ? DEFAULT_PROJECT_SORT : '')
            }
            onChange={(value: string) => onSelect(select.name, value)}
            compact
          />
        ))}
      </div>
    </div>
  );
}
