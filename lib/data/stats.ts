/**
 * lib/data/stats.ts — the `/admin/stats` read (02 §1.3 `/admin/stats` row: Data `stats_daily`;
 * 00 §S1.9 AC2 / AC9; registry Modules `data/<area>.ts`; 01 INV-12 "reads go through
 * `lib/data/<area>.ts`"). ONE request-scoped read on the REQUEST-COOKIE server client
 * (`lib/supabase/server.ts` — the admin read seam, 01 INV-12 / INV-14 / INV-15; the service client is
 * banned from `lib/data/**`): the `stats_daily` SITE rows from `fromDay` on, the four tile / chart
 * metrics only, ordered `day, metric, source` — at most `READ_WINDOW_DAYS` × 6 rows, so no paging;
 * no cache (the route is dynamic and the cookie client is never cached, 01 INV-13) — ADR-0049 D15.
 *
 * RLS is the second gate (01 INV-31): an `admin` session reads every row (05 T-RLS-107 admin = A);
 * a `moderator` session gets NO rows (mod = D — the frozen matrix is not widened, ADR-0049 D13), so the page
 * renders every tile at `0` + "No data yet." and an empty chart for a moderator. The arithmetic is
 * `lib/stats.ts`'s (ADR-0049 D10 / ADR-0049 D11): `buildStatsTiles` / `chartDays` take these rows as returned.
 * Tests: 05 T-E2E-40 (the page on the seed pair, after the job, empty, as moderator).
 */
import 'server-only';
import type { SiteSnapshotRow } from '@/lib/stats';
import { createServerClient } from '@/lib/supabase/server';

export type { SiteSnapshotRow } from '@/lib/stats';

/** The metrics the page consumes (ADR-0049 D15) — the four tiles + the chart; `entity_type = 'site'` only. */
const SITE_METRICS = ['downloads', 'comments', 'comments_held', 'tips'] as const;

/**
 * Site snapshots with `day >= fromDay` (the caller passes `today − (READ_WINDOW_DAYS − 1)` — ADR-0049 D11),
 * ascending by day, then metric, then source. Throws on a read error (the page's error boundary —
 * 02 RP-10); an RLS-filtered empty answer is a normal `[]`.
 */
export async function readSiteSnapshots(fromDay: string): Promise<SiteSnapshotRow[]> {
  const db = await createServerClient();
  const { data, error } = await db
    .from('stats_daily')
    .select('day, metric, source, value')
    .eq('entity_type', 'site')
    .gte('day', fromDay)
    .in('metric', [...SITE_METRICS])
    .order('day', { ascending: true })
    .order('metric', { ascending: true })
    .order('source', { ascending: true });
  if (error) throw new Error(`stats read failed: ${error.code}`);
  // `value` is bigint: PostgREST serialises int8 as a JSON number (the generated type agrees) —
  // `Number()` only guards a client that ever hands the column back as a string.
  return (data ?? []).map((row) => ({
    day: row.day,
    metric: row.metric,
    source: row.source,
    value: Number(row.value),
  }));
}
