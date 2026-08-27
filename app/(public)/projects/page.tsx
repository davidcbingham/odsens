import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProjectCardSkeleton } from '@/components/layout/ProjectCardSkeleton';
import type { FilterGroup, FilterSelect } from '@/components/projects/FilterBar';
import { ProjectGrid } from '@/components/projects/ProjectGrid';
import { listPublishedProjects, type ProjectListItem } from '@/lib/data/projects';
import { PROJECT_TYPES, typeWord, type ProjectType } from '@/lib/format/project';
import type { ProjectSort } from '@/lib/validation/filters';
import { groupGameVersions } from '@/lib/versions';
import styles from './page.module.css';

/**
 * `/projects` — S1.2 replaces the S0 placeholder (02 §2.2; 00 S1.2.AC2/AC3/AC4; DESIGN.md §6.2,
 * §5 Filter bar, §11.7 empty). ISR(600; projects) — the full published list is fetched once via
 * `lib/data/projects.ts` on the cookie-less anon client (01 INV-09/INV-12/INV-15; tag `projects`
 * from the data cache, 02 §5) and passed as props to the `ProjectGrid` client island
 * (ADR-0002 A7), which owns filter/search/sort state client-side — URL is the state (02 RP-02:
 * `useSearchParams` inside the `<Suspense>` boundary below; the page itself never reads
 * `searchParams`, RP-03). Sections per 02 §2.2: `h1` PROJECTS, then the island renders the
 * count line, `SearchBox placement="page"`, `FilterBar`, `ActiveFilterChips` + "Showing n of N",
 * the 3-up grid and the §11.7 empty state.
 *
 * Metadata per 02 RP-05/RP-06: title `Projects` (renders `Projects — odsens`), canonical
 * `/projects`; description + OG default inherit from `app/layout.tsx`. Loading: `loading.tsx`
 * (`ProjectCardSkeleton` × 6 — 02 §2.2 States, 03 G-01, 00 S1.2.AC12).
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Projects',
  alternates: { canonical: '/projects' },
};

/**
 * Filter-button words — plural of 03's `typeWord` (05 T-E2E-2 asserts `MODS 1`, `DATAPACKS 1`,
 * `RESOURCE PACKS 1`, `PLUGINS 0` on seed; 00 S1.2.AC3 "MODS 7 style"). All four types render,
 * counts included, even at 0 (T-E2E-2's `PLUGINS 0`).
 */
function typeFilterLabel(type: ProjectType): string {
  return `${typeWord(type)}S`;
}

/** 02 §1.1 `/projects` data row: "counts per type" — computed here over the ISR list. */
function buildGroups(projects: readonly ProjectListItem[]): FilterGroup[] {
  return [
    {
      key: 'type',
      options: PROJECT_TYPES.map((type) => ({
        value: type,
        label: typeFilterLabel(type),
        count: projects.reduce((sum, project) => (project.type === type ? sum + 1 : sum), 0),
      })),
    },
  ];
}

/** 02 §2.2 `sort` values verbatim (ADR-0002 #39); labels per the pass-1 "Downloads ▾" prototype. */
const SORT_OPTIONS: { value: ProjectSort; label: string }[] = [
  { value: 'downloads', label: 'Downloads' },
  { value: 'updated', label: 'Updated' },
  { value: 'newest', label: 'Newest' },
  { value: 'title', label: 'Title' },
];

/**
 * Version + sort selects (02 §2.2): version options are the union of `game_versions` grouped
 * per 03 V-01 (`groupGameVersions` — `1.21.x` groups newest first, `snapshots` last); the empty
 * value clears the param (the island's `FilterBar` deletes empty values from the URL).
 */
function buildSelects(projects: readonly ProjectListItem[]): FilterSelect[] {
  const versionOptions = groupGameVersions(projects.flatMap((project) => project.gameVersions));
  return [
    {
      name: 'version',
      label: 'Version',
      options: [{ value: '', label: 'All versions' }, ...versionOptions],
    },
    { name: 'sort', label: 'Sort', options: SORT_OPTIONS },
  ];
}

export default async function ProjectsPage() {
  const projects = await listPublishedProjects();

  return (
    <section className={styles.projects}>
      <h1 className={styles['projects-title']}>PROJECTS</h1>
      {/* RP-02: the island reads the URL via useSearchParams — Suspense boundary required on an
          ISR page; the fallback mirrors the loading state (ProjectCardSkeleton, 03 G-01). */}
      <Suspense fallback={<ProjectCardSkeleton count={6} />}>
        <ProjectGrid
          projects={projects}
          groups={buildGroups(projects)}
          selects={buildSelects(projects)}
        />
      </Suspense>
    </section>
  );
}
