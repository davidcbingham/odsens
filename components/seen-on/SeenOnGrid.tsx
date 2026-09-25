'use client';

import { useSearchParams } from 'next/navigation';
import { useId } from 'react';
import { EmptyState } from '@/components/primitives/EmptyState';
import {
  FilterBarView,
  type FilterGroup,
  type FilterSelect,
} from '@/components/projects/FilterBar';
import { MentionCard } from '@/components/seen-on/MentionCard';
import {
  applyMentionFilters,
  parseMentionFilters,
  platformCounts,
  projectOptions,
  type MentionCardData,
  type MentionFilters,
} from '@/lib/mentions';
import styles from './SeenOnGrid.module.css';

/**
 * SeenOnGrid — DESIGN.md §12.2 "Seen on page — … filter bar (ALL + platform counts, project select
 * at right), 3-up mention grid tagged with their project, newest first. 1-up on phone with the
 * filter row scrolling", §12.7 #62 empty filter; 02 §2.6 "Query (client-side)"; 00 S1.8.AC6.
 * Client island added by ADR-0045 D15 (the `ProjectGrid` / `VideoStage` precedents — ADR-0002
 * A7, ADR-0043 D4): `/seen-on` is ISR and may not read `searchParams` (02 RP-02 / RP-03, 01
 * INV-38), so ONE island owns the `?platform=` / `?project=` filter state over the full published
 * list it is handed. It never fetches (01 INV-09); the URL is the state, written by the
 * `FilterBar` the way `/projects` writes it (platform buttons = `next/link scroll={false}`, the
 * select = `router.replace({scroll:false})`).
 *
 * Two exports, one view:
 *   `SeenOnGrid`      reads the URL with `useSearchParams` — the page wraps it in `<Suspense>`.
 *   `SeenOnGridView`  the same markup for a query string it is given, with no URL read — the page
 *                     uses it as the `<Suspense>` FALLBACK with `query=""`, so the bar and every
 *                     card are in the ISR HTML and the resolved island renders identical markup
 *                     for an unfiltered visit: zero shift.
 *
 * Filters (`lib/mentions.ts`): `platform` = one of the buttons on the bar — only platforms with at
 * least one mention get a button, `ALL` first, counts over the full list (not faceted by the
 * select); `project` = a project slug, or `odsens` for the mentions about OddSense generally —
 * the select lists the projects with at least one mention + "About OddSense". A value the bar
 * does not offer falls away silently (an unknown slug would otherwise empty the grid while the
 * select reads "All projects"); the bar is handed the same cleaned query, so what it highlights
 * is always what the grid shows.
 *
 * Grid: `<ul>`, 3-up / 2-up tablet / 1-up phone, gap 20, order as given (newest first — the
 * reader's), every card `withProjectFooter`. A filter that matches nothing → the §12.7 #62 empty
 * state, strings verbatim (`h3` under the section's visually-hidden `h2`). The result count is
 * announced politely to screen readers ("Showing n of N", the `/projects` wording) — no new
 * visible copy. No mentions at all → renders nothing (the page prints its title only, 02 §2.6).
 */
export type SeenOnGridProps = {
  /** Every published mention, newest first (`listPublishedMentions`). */
  mentions: MentionCardData[];
  className?: string;
};

export type SeenOnGridViewProps = SeenOnGridProps & {
  /** The current query string, no leading `?` — what `useSearchParams().toString()` gives. */
  query: string;
};

/** DESIGN.md §12.7 #62 / ADR-0002 #62, verbatim (05 T-E2E-10). */
const EMPTY_TITLE = 'NOTHING HERE';
const EMPTY_LINE = 'Try another filter.';

const ALL_PROJECTS = { value: '', label: 'All projects' };

/** The query the bar gets: every param kept, but a filter value the bar does not offer removed. */
function cleanedQuery(params: URLSearchParams, filters: MentionFilters): string {
  const next = new URLSearchParams(params);
  if (filters.platform === null) next.delete('platform');
  if (filters.project === null) next.delete('project');
  return next.toString();
}

export function SeenOnGrid({ mentions, className }: SeenOnGridProps) {
  const query = useSearchParams().toString();
  return <SeenOnGridView mentions={mentions} query={query} className={className} />;
}

export function SeenOnGridView({ mentions, query, className }: SeenOnGridViewProps) {
  const headingId = useId();
  if (mentions.length === 0) return null;

  const platforms = platformCounts(mentions);
  const projects = projectOptions(mentions);
  const groups: FilterGroup[] = [{ key: 'platform', options: platforms }];
  const selects: FilterSelect[] = [
    { name: 'project', label: 'Project', options: [ALL_PROJECTS, ...projects] },
  ];

  const params = new URLSearchParams(query);
  const parsed = parseMentionFilters(
    params,
    projects.map((option) => option.value),
  );
  const filters: MentionFilters = {
    // A platform with no mention has no button — it falls away like an unknown project.
    platform: platforms.some((option) => option.value === parsed.platform) ? parsed.platform : null,
    project: parsed.project,
  };
  const shown = applyMentionFilters(mentions, filters);

  const classes = className ? `${styles['seen-on-grid']} ${className}` : styles['seen-on-grid'];
  return (
    <section aria-labelledby={headingId} className={classes}>
      <h2 id={headingId} className="visually-hidden">
        All mentions
      </h2>
      <FilterBarView groups={groups} selects={selects} query={cleanedQuery(params, filters)} />
      <p className="visually-hidden" aria-live="polite">
        Showing {shown.length} of {mentions.length}
      </p>
      {shown.length > 0 ? (
        <ul className={styles['seen-on-grid-list']}>
          {shown.map((mention) => (
            <li key={mention.id} className={styles['seen-on-grid-item']}>
              <MentionCard mention={mention} withProjectFooter />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState as="h3" title={EMPTY_TITLE} line={EMPTY_LINE} />
      )}
    </section>
  );
}
