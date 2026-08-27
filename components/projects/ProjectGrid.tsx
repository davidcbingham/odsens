'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useId } from 'react';
import { EmptyState } from '@/components/primitives/EmptyState';
import { SearchBox } from '@/components/primitives/SearchBox';
import { ActiveFilterChips } from './ActiveFilterChips';
import { FilterBar, type FilterGroup, type FilterSelect } from './FilterBar';
import { ProjectCard, type ProjectCardProps } from './ProjectCard';
import {
  DEFAULT_PROJECT_SORT,
  PROJECT_SORTS,
  parseProjectFilters,
  type ProjectFilters,
  type ProjectSort,
} from '@/lib/validation/filters';
import { matchesVersionGroup } from '@/lib/versions';
import styles from './ProjectGrid.module.css';

/**
 * ProjectGrid — 03 §2.3 `ProjectGrid` row (new client island, ADR-0002 A7); 02 §2.2 `/projects`;
 * DESIGN.md §6.2, §11.7 empty state, §12.7 #39 count line. Client island (03 C-16a:
 * `components/projects/ProjectGrid.tsx`): owns filter/search/sort state over the full published
 * list passed as props from the ISR page — URL is the state (02 RP-02, `useSearchParams` inside
 * the page's `<Suspense>` boundary), applied client-side with no refetch (01 INV-09: islands
 * never fetch). Renders `FilterBar`, `SearchBox placement="page"`, `ActiveFilterChips` as its
 * children, the count lines, the card grid (`<ul>` of `<li>`, 3-up / 2-up tablet / 1-up phone —
 * DESIGN.md §6.2) and the §11.7 empty state ("NOTHING MATCHES" / "Try fewer filters." →
 * Clear filters; zero projects at all → same state without the action, 02 §2.2).
 *
 * 02 §2.2 params: `type` single-select · `version` one 03 V-01 group (`lib/versions.ts`
 * `matchesVersionGroup`) · `sort` `downloads|updated|newest|title` default `downloads`
 * (ADR-0002 #39) · `q` case-insensitive substring on title + description.
 */
export type ProjectListItem = ProjectCardProps['project'] & {
  /** Raw `game_versions` for the 03 V-01 `?version=` group match (02 §2.2). */
  gameVersions: string[];
  /** `external_updated_at` — `sort=updated` orders by it desc (02 §2.2). */
  externalUpdatedAt: string | null;
  /** `published_at` — `sort=newest` orders by it desc (02 §2.2). */
  publishedAt: string | null;
};

export type ProjectGridProps = {
  /** Full published list, ISR-fetched (03: `ProjectCardProps['project'][]` + the sort/filter fields). */
  projects: ProjectListItem[];
  groups: FilterGroup[];
  selects: FilterSelect[];
  /** Default sort when the URL has none — `downloads` per ADR-0002 #39. */
  sort?: ProjectSort;
};

/** §12.7 #39 count line ("1 thing. Useful or not." when N = 1 — 03 V-02). */
export function projectCountLine(n: number): string {
  return n === 1 ? '1 thing. Useful or not.' : `${n} things. Some useful, some not.`;
}

/** DESIGN.md §11.7 Projects empty state, verbatim (05 T-E2E-2; 02 SM-02). */
const EMPTY_TITLE = 'NOTHING MATCHES';
const EMPTY_LINE = 'Try fewer filters.';
const EMPTY_ACTION = 'Clear filters';

/**
 * Applies the 02 §2.2 filters + sort client-side over the full list. Pure and exported for unit
 * tests (05 COV-6: component logic is unit-testable; the pieces — `parseProjectFilters`,
 * `matchesVersionGroup` — are T-UNIT-21/39). Stable sort; `null` dates order last.
 */
export function applyProjectFilters(
  projects: readonly ProjectListItem[],
  filters: ProjectFilters,
  sort: ProjectSort,
): ProjectListItem[] {
  const q = filters.q.toLowerCase();
  const list = projects.filter((project) => {
    if (filters.type !== null && project.type !== filters.type) return false;
    if (filters.version !== null && !matchesVersionGroup(project.gameVersions, filters.version)) {
      return false;
    }
    if (
      q !== '' &&
      !project.title.toLowerCase().includes(q) &&
      !project.description.toLowerCase().includes(q)
    ) {
      return false;
    }
    return true;
  });
  return list.sort(comparators[sort]);
}

/** 02 §2.2: `updated` = `external_updated_at desc`, `newest` = `published_at desc`, `title` = A→Z. */
const comparators: Record<ProjectSort, (a: ProjectListItem, b: ProjectListItem) => number> = {
  downloads: (a, b) => b.downloadsTotal - a.downloadsTotal,
  updated: (a, b) => toTime(b.externalUpdatedAt) - toTime(a.externalUpdatedAt),
  newest: (a, b) => toTime(b.publishedAt) - toTime(a.publishedAt),
  // Locale-free on purpose (01 INV-68/INV-93): server and client must order identically.
  title: (a, b) => {
    const at = a.title.toLowerCase();
    const bt = b.title.toLowerCase();
    return at < bt ? -1 : at > bt ? 1 : 0;
  },
};

function toTime(value: string | null): number {
  if (value === null) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

export function ProjectGrid({ projects, groups, selects, sort }: ProjectGridProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const headingId = useId();

  const filters = parseProjectFilters(new URLSearchParams(searchParams.toString()));
  const urlSort = searchParams.get('sort');
  const effectiveSort: ProjectSort =
    urlSort !== null && (PROJECT_SORTS as readonly string[]).includes(urlSort)
      ? (urlSort as ProjectSort)
      : (sort ?? DEFAULT_PROJECT_SORT);
  const shown = applyProjectFilters(projects, filters, effectiveSort);

  // Chip labels: param value → display label, from the same options the FilterBar renders.
  const labels: Record<string, string> = {};
  for (const group of groups) {
    for (const option of group.options) labels[option.value] = option.label;
  }
  for (const select of selects) {
    if (select.name === 'sort') continue;
    for (const option of select.options) labels[option.value] ??= option.label;
  }

  return (
    <section aria-labelledby={headingId} className={styles['project-grid']}>
      <h2 id={headingId} className="visually-hidden">
        All projects
      </h2>
      <p className={styles['project-grid-count']}>{projectCountLine(projects.length)}</p>
      <SearchBox placement="page" />
      <FilterBar groups={groups} selects={selects} />
      <div className={styles['project-grid-status']}>
        <p className={styles['project-grid-showing']} aria-live="polite">
          Showing {shown.length} of {projects.length}
        </p>
        <ActiveFilterChips labels={labels} />
      </div>
      {shown.length > 0 ? (
        <ul className={styles['project-grid-list']}>
          {shown.map((project) => (
            <li key={project.slug} className={styles['project-grid-item']}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={EMPTY_TITLE}
          line={EMPTY_LINE}
          as="h3"
          {...(projects.length > 0
            ? { action: { label: EMPTY_ACTION, href: pathname, variant: 'ghost' as const } }
            : {})}
        />
      )}
    </section>
  );
}
