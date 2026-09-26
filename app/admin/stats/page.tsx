import type { Metadata } from 'next';
import { SyncStatus, type SyncStatusProps } from '@/components/admin/SyncStatus';
import { FlatBarChart } from '@/components/primitives/FlatBarChart';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { sectionTitleId } from '@/components/primitives/SectionTitle';
import { StatTile } from '@/components/primitives/StatTile';
import { getViewer } from '@/lib/auth';
import { listSyncStatus, STATS_SYNC_SOURCES } from '@/lib/data/admin';
import { readSiteSnapshots } from '@/lib/data/stats';
import { COMBINED_COUNT_LINE } from '@/lib/format/downloads';
import {
  addDays,
  buildStatsTiles,
  CHART_TITLE,
  chartDays,
  READ_WINDOW_DAYS,
  utcDay,
} from '@/lib/stats';
import styles from './page.module.css';

/**
 * `/admin/stats` — the numbers page (02 §1.3 `/admin/stats` row + auth rule; 00 §S1.9 AC2 / AC3 /
 * AC10; DESIGN.md §11.3 #16, §11.1 Stat tile / Flat bar chart, §6 #9). Dynamic + session-backed
 * under the `app/admin/layout.tsx` gate (01 INV-31); reads go through `lib/data/stats.ts` +
 * `lib/data/admin.ts` on the request-cookie client (01 INV-12 / INV-15; ADR-0022). Read-only: this
 * page mutates nothing and has no PRG — the one control is `SyncStatus`'s own "Sync now" island.
 *
 * Structure (§11.3 #16): head (visually-hidden `h1` "Stats", the "ADMIN" eyebrow, the intro line,
 * the moderator line when the viewer is not an admin) → four `StatTile`s (03 §2.2 first use of the
 * S1.9 labels: downloads 7 days · downloads all time · comments with the held count · tips 30 days;
 * 4-across ≥ 900px, 2×2 below — the grid is this parent's duty) → DOWNLOADS · LAST 30 DAYS: the
 * `FlatBarChart` (both variants, the width decides — ADR-0049 D12; the visible `h2` here is the SVG's
 * accessible name through `titleId`) + the honest line `COMBINED_COUNT_LINE` verbatim → SYNC:
 * `SyncStatus` over `STATS_SYNC_SOURCES` — every job that feeds the numbers, the `stats` row
 * included, so a dead snapshot cron shows on its own row (ADR-0049 D14; T-E2E-40 "the 3 seeded ok runs").
 *
 * Numbers (ADR-0049 D11 / ADR-0049 D25): `today` = the UTC calendar date at request time; ONE `stats_daily` read
 * over `READ_WINDOW_DAYS` (38) days (`readSiteSnapshots`, ADR-0049 D15); `buildStatsTiles` derives the
 * tiles and their §5 context lines, `chartDays` the 30 daily columns (per-source deltas, ADR-0049 D10).
 * Before any snapshot exists every tile is `0` + "No data yet." (ADR-0002 #29) and the chart is
 * 30 empty columns — the same page, no special case.
 *
 * Moderators (02 §1.3 auth rule; ADR-0049 D13): the layout lets role ≥ moderator in, and the RLS-filtered
 * read (05 T-RLS-107 mod = D) returns no rows — so a moderator sees every tile at `0` + "No data
 * yet.", an empty chart and the one mute line "Only admins see the numbers."; `SyncStatus`
 * renders "Sync now" disabled under `title="Admin only"` (`canTrigger` = admin), never absent.
 * The frozen RLS matrix is NOT widened for this page.
 *
 * The page's one `h1` is visually hidden (the admin list-page precedent); "ADMIN" is an eyebrow.
 * Role gate: the layout renders `AdminGate` / the root 404; this page bails quietly for anon /
 * no-handle / role `user` (RP-04 — a page-thrown `notFound()` would replace the anon gate).
 * Tests: 05 T-E2E-40 (this page), T-E2E-42 (axe + shots at 1280 and 390 — 00 AC10).
 */
export const metadata: Metadata = {
  title: 'Stats · Admin',
};

/** §5 copy (ADR-0049 D23). The chart heading is the visible `h2`; `CHART_TITLE` names the hidden table. */
const CHART_HEADING = 'DOWNLOADS · LAST 30 DAYS';
const INTRO_LINE = 'One snapshot a day, taken at 03:00 UTC.';
const MODERATOR_LINE = 'Only admins see the numbers.';

export default async function AdminStatsPage() {
  // RP-04: bail quietly for anon / role `user` — the layout renders `AdminGate` / the root 404;
  // a page-thrown `notFound()` here would replace the anon gate (defence in depth, 01 INV-31).
  const viewer = await getViewer();
  const role = viewer?.profile?.role;
  if (!viewer?.profile?.handle || role === undefined || role === 'user') return null;
  const isAdmin = role === 'admin';

  // ADR-0049 D25: the UTC day at request time anchors every window (01 INV-68 — never a local getter).
  const today = utcDay(new Date());
  const [rows, syncSources] = await Promise.all([
    readSiteSnapshots(addDays(today, -(READ_WINDOW_DAYS - 1))), // ADR-0049 D11 / ADR-0049 D15
    listSyncStatus(STATS_SYNC_SOURCES), // ADR-0049 D14
  ]);
  const tiles = buildStatsTiles(rows, today);
  const days = chartDays(rows, today);

  const sources: SyncStatusProps['sources'] = syncSources.map((row) => ({
    source: row.source,
    lastRun: row.lastRun,
    stale: row.stale,
    triggerable: true,
  }));

  const chartId = sectionTitleId(CHART_HEADING);
  const syncId = sectionTitleId('SYNC');

  return (
    <div className={styles['admin-stats']}>
      <header className={styles['admin-stats-head']}>
        <h1 className="visually-hidden">Stats</h1>
        <PixelLabel as="p" tone="gold" size={11}>
          ADMIN
        </PixelLabel>
        <p className={styles['admin-stats-intro']}>{INTRO_LINE}</p>
        {isAdmin ? null : <p className={styles['admin-stats-moderator']}>{MODERATOR_LINE}</p>}
      </header>

      <div className={styles['admin-stats-tiles']}>
        <StatTile {...tiles.downloads7} />
        <StatTile {...tiles.downloadsAll} />
        <StatTile {...tiles.comments} />
        <StatTile {...tiles.tips} />
      </div>

      <section className={styles['admin-stats-section']} aria-labelledby={chartId}>
        <h2 id={chartId} className={styles['admin-stats-heading']}>
          {CHART_HEADING}
        </h2>
        <FlatBarChart days={days} title={CHART_TITLE} titleId={chartId} />
        <p className={styles['admin-stats-honest']}>{COMBINED_COUNT_LINE}</p>
      </section>

      <section className={styles['admin-stats-section']} aria-labelledby={syncId}>
        <h2 id={syncId} className={styles['admin-stats-heading']}>
          SYNC
        </h2>
        <SyncStatus sources={sources} canTrigger={isAdmin} />
      </section>
    </div>
  );
}
