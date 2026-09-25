/**
 * tests/db/jobs/refreshMentions.test.ts — T-ACT-54, T-ACT-71 (mentions no-key), T-ACT-45, T-ACT-70
 * and "T-ACT-74 refreshMentions" (04 §3.4 as amended by ADR-0045; 04 §3 J-F/J-P/J-I/J-D,
 * SC-11/SC-13/SC-16; 00 S1.8 AC7; 05 §7.2 jobs layer; migration 20260919120000).
 * `mutatesSeed`: every run adds a `sync_runs` row and a run whose upstream answers SEED-10's
 * `seedvid0001` would rewrite that seed row — the file snapshots the content tables (`mentions` +
 * `sync_runs` included) and restores them in `afterAll`, so SEED-10 is back for the e2e build
 * (05 H-1). Its own rows come from `makeMention` / `makeProject` and leave with `cleanupFactories`.
 *
 * Harness per 05 §7.2: the job runs against the local DB with the adapter's `fetch` mocked.
 * `spyFetch` key = the real request prefix `${YOUTUBE_API_BASE}/videos` — ALWAYS routed: the base is
 * a loopback host, and an unrouted loopback URL passes through `spyFetch` to the real network.
 * Upstream payloads: `youtube/videos-mentions.json` (hand-made, `fixmen00001` → 95,400 views,
 * `fixmen00002` → 401,200) and in-memory responders that answer the ids of the request they were
 * sent (F-6: a fixture is never hand-edited; derived payloads live in the test).
 *
 * The seed is accounted for, not removed: SEED-10 `…0301` (YouTube, `seedvid0001`, published) is an
 * eligible row in every run here. No payload below ever answers `seedvid0001`, so it is the
 * standing "id missing from the response → unchanged" case; SEED-10 `…0302` (TikTok) is the standing
 * "non-YouTube mention untouched" case. Assertions are scoped to rows this file created plus those
 * two.
 *
 * The tests share state in file order (as the §3.1–§3.3 job files do): fixture run → rerun → hidden
 * count → general mention → batches (failed batch · 120 failed writes · 3 good requests) → paging →
 * gather failures → per-row write faults → no-key → lock → J-F.
 *
 * "T-ACT-74 refreshMentions" (AC7, ADR-0045): the `sync.failed` edge through the shared runner for
 * this job, plus the delivery leg — a forced Data-API list failure writes ONE event and one
 * `runNotify` tick delivers it through Resend (`tests/db/jobs/syncYoutube.test.ts` pattern;
 * `admin_notify_emails` restored through `restoreSeedSettings()`).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '@/lib/env';
import { runNotify } from '@/lib/jobs/notify';
import { refreshMentions } from '@/lib/jobs/refreshMentions';
import type { JobSummary } from '@/lib/jobs/types';
import type { Database } from '@/lib/supabase/types';
import { touchSeedSyncRuns } from '@/tests/helpers/arrange';
import { asRole } from '@/tests/helpers/asRole';
import { setupActionMocks } from '@/tests/helpers/callAction';
import {
  restoreContentTables,
  restoreSeedSettings,
  snapshotContentTables,
  type ContentSnapshot,
} from '@/tests/helpers/contentReset';
import { withDbFault, withDbHook } from '@/tests/helpers/dbFault';
import {
  cleanupFactories,
  makeMention,
  makeProject,
  makeSyncRun,
  purgeNotificationEvents,
  trackNotificationEvent,
} from '@/tests/helpers/factories';
import { loadFixture } from '@/tests/helpers/fixtures';
import { SEED_MENTIONS } from '@/tests/helpers/seedIds';
import { spyFetch, spyLog, spyRevalidateTag } from '@/tests/helpers/spies';

setupActionMocks();

const service = asRole('service');

const API_BASE = process.env.YOUTUBE_API_BASE ?? '';
const API_KEY = process.env.YOUTUBE_API_KEY ?? '';
if (API_BASE === '' || API_KEY === '') {
  throw new Error('YOUTUBE_API_BASE / YOUTUBE_API_KEY are not set — is .env.test loaded?');
}
const VIDEOS_URL = `${API_BASE}/videos`;
const RESEND_URL = `${process.env.RESEND_API_BASE ?? ''}/emails`;
const EMAIL_A = 'seed-admin@localhost.test';

/** The hand-made fixture answers these two ids whatever was asked (tests/fixtures/README.md). */
const FIXTURE_OK = { [VIDEOS_URL]: 'youtube/videos-mentions.json' };
const FIX_1 = 'fixmen00001';
const FIX_2 = 'fixmen00002';
const FIX_1_VIEWS = 95_400;
const FIX_2_VIEWS = 401_200;
const SEED_VIDEO_ID = 'seedvid0001';

/** The stale number `perturb()` writes so a run visibly has something to update. */
const STALE_VIEWS = 5;
/** What the in-memory responder answers for a factory (`t_…`) id. */
const BATCH_VIEWS = 4_242;
const BATCH_SIZE = 120;

type MentionRow = Database['public']['Tables']['mentions']['Row'];

let snapshot: ContentSnapshot;
let projectId = '';
let projectSlug = '';

/** Eligible — on the factory project, `fixmen00001`. */
let onProject = '';
/** Eligible — a second mention of the SAME video (`fixmen00001`), about OddSense generally. */
let sameVideo = '';
/** Eligible — a DRAFT, general, `fixmen00002` (04 §3.4: draft and published are refreshed). */
let draftGeneral = '';
/** Not eligible — TikTok, no external id. */
let tiktok = '';
/** Not eligible — HIDDEN, although its id (`fixmen00001`) is in every fixture response. */
let hidden = '';
/** Not eligible — SUGGESTED, with an id of its own that must never be asked for. */
let suggested = '';
let suggestedVideoId = '';
/** Not eligible — a YouTube mention with no `external_id` (a channel link pasted by hand). */
let noExternalId = '';

function run(): Promise<JobSummary> {
  return refreshMentions({ trigger: 'manual' });
}

async function mentionRow(id: string): Promise<MentionRow> {
  const { data, error } = await service.from('mentions').select('*').eq('id', id).single();
  if (error) throw new Error(error.message);
  return data;
}

/** Full rows (every column, `updated_at` included) — equality proves "not written at all". */
async function mentionRows(ids: string[]): Promise<MentionRow[]> {
  const rows: MentionRow[] = [];
  for (let start = 0; start < ids.length; start += 50) {
    const { data, error } = await service
      .from('mentions')
      .select('*')
      .in('id', ids.slice(start, start + 50));
    if (error) throw new Error(error.message);
    rows.push(...data);
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id));
}

async function setViews(ids: string[], viewCount: number | null): Promise<void> {
  const { error } = await service.from('mentions').update({ view_count: viewCount }).in('id', ids);
  if (error) throw new Error(error.message);
}

/** Arranges stale numbers on the three eligible factory rows so a good run would write all three. */
async function perturb(): Promise<void> {
  await setViews([onProject, sameVideo, draftGeneral], STALE_VIEWS);
}

/** How many rows the 04 §3.4 select matches right now (the job's `summary.mentions`). */
async function eligibleCount(): Promise<number> {
  const { count, error } = await service
    .from('mentions')
    .select('id', { count: 'exact', head: true })
    .eq('platform', 'youtube')
    .not('external_id', 'is', null)
    .in('status', ['draft', 'published']);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function syncRunCount(): Promise<number> {
  const { count, error } = await service
    .from('sync_runs')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'mentions');
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function runRow(id: string) {
  const { data, error } = await service
    .from('sync_runs')
    .select('source, started_at, finished_at, ok, items, error')
    .eq('id', id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/** The ids one `videos.list` request asked for. */
function idsOf(url: string): string[] {
  return (new URL(url).searchParams.get('id') ?? '').split(',').filter((id) => id !== '');
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

/**
 * An upstream that answers the ids it was asked for: `answer(id)` → a count, `null` = the item comes
 * back with its statistics hidden, `undefined` = the item is missing from the response.
 */
function statsResponder(answer: (id: string) => number | null | undefined) {
  return (request: Request): Response => {
    const items = idsOf(request.url).flatMap((id) => {
      const count = answer(id);
      if (count === undefined) return [];
      return [
        {
          kind: 'youtube#video',
          id,
          ...(count === null ? {} : { statistics: { viewCount: String(count) } }),
        },
      ];
    });
    return new Response(JSON.stringify({ kind: 'youtube#videoListResponse', items }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  };
}

/** Only factory (`t_…`) ids are answered — `fixmen…` and `seedvid0001` stay "missing". */
const answerFactoryIds = statsResponder((id) => (id.startsWith('t_') ? BATCH_VIEWS : undefined));

/** SC-15 / ADR-0045 D12: the text may keep `key=[redacted]`; the key's VALUE never appears. */
function expectKeyAbsent(text: string | null | undefined): void {
  expect(text ?? '').not.toContain(`key=${API_KEY}`);
  expect(text ?? '').not.toMatch(/[?&]key=(?!\[redacted\])/);
}

type JobLogLine = {
  job?: string;
  msg?: string;
  id?: string;
  meta?: Record<string, unknown>;
};

function jobLines(lines: object[], msg: string): JobLogLine[] {
  return (lines as JobLogLine[]).filter(
    (line) => line.job === 'refreshMentions' && line.msg === msg,
  );
}

beforeAll(async () => {
  await touchSeedSyncRuns();
  snapshot = await snapshotContentTables();

  projectId = await makeProject({ source: 'odsens' });
  const { data, error } = await service
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .single();
  if (error) throw new Error(error.message);
  projectSlug = data.slug;

  onProject = await makeMention({
    project_id: projectId,
    external_id: FIX_1,
    url: `https://www.youtube.com/watch?v=${FIX_1}`,
    view_count: STALE_VIEWS,
  });
  sameVideo = await makeMention({
    external_id: FIX_1,
    url: `https://www.youtube.com/watch?v=${FIX_1}&t=42s`,
    view_count: STALE_VIEWS,
  });
  draftGeneral = await makeMention({
    external_id: FIX_2,
    url: `https://www.youtube.com/watch?v=${FIX_2}`,
    status: 'draft',
    view_count: STALE_VIEWS,
  });
  tiktok = await makeMention({
    project_id: projectId,
    platform: 'tiktok',
    external_id: null,
    url: 'https://www.tiktok.com/@t_refresh/video/7300000000000000001',
    thumbnail_url: null,
    view_count: 7,
  });
  hidden = await makeMention({
    project_id: projectId,
    external_id: FIX_1,
    url: `https://youtu.be/${FIX_1}`,
    status: 'hidden',
    view_count: 11,
  });
  suggested = await makeMention({ status: 'suggested', source: 'auto', view_count: 13 });
  suggestedVideoId = (await mentionRow(suggested)).external_id ?? '';
  noExternalId = await makeMention({
    external_id: null,
    url: 'https://www.youtube.com/@t_refresh_channel',
    thumbnail_url: null,
    view_count: 17,
  });
});

afterAll(async () => {
  await restoreSeedSettings();
  await restoreContentTables(snapshot);
  await cleanupFactories();
  // Failed runs emit `sync.failed` through the runner (04 J-F) — purge them (H-1).
  await purgeNotificationEvents();
});

describe('refreshMentions (04 §3.4)', () => {
  it('T-ACT-54 view_count updated from youtube/videos-mentions.json in ONE part=statistics request; draft + published refreshed; two mentions of one video asked once, written twice; id missing from the response → unchanged; non-YouTube / hidden / suggested / id-less mentions never asked, never written; tags = mentions + the changed project only', async () => {
    const untouchedIds = [SEED_MENTIONS.youtube, SEED_MENTIONS.tiktok, tiktok, hidden, suggested];
    untouchedIds.push(noExternalId);
    const untouchedBefore = await mentionRows(untouchedIds);
    const eligible = await eligibleCount();
    const runsBefore = await syncRunCount();
    const fetchSpy = spyFetch(FIXTURE_OK);
    const tags = spyRevalidateTag();
    const summary = await run();

    expect(summary.ok).toBe(true);
    expect(summary.source).toBe('mentions');
    expect(summary).toMatchObject({
      items: 3,
      updated: 3,
      mentions: eligible,
      unchanged: eligible - 3,
      returned: 2,
      units: 1,
      errors: [],
    });
    expect(summary.skipped).toBeUndefined();
    expect(summary.error).toBeUndefined();

    expect((await mentionRow(onProject)).view_count).toBe(FIX_1_VIEWS);
    expect((await mentionRow(sameVideo)).view_count).toBe(FIX_1_VIEWS);
    expect((await mentionRow(draftGeneral)).view_count).toBe(FIX_2_VIEWS);
    // `view_count` is the only column the job writes — the draft stays a draft, the project stays.
    expect(await mentionRow(draftGeneral)).toMatchObject({ status: 'draft', project_id: null });
    expect(await mentionRow(onProject)).toMatchObject({
      status: 'published',
      project_id: projectId,
      external_id: FIX_1,
      featured: false,
    });

    // Missing from the response (SEED-10 seedvid0001) and every ineligible row: byte-equal.
    expect(await mentionRows(untouchedIds)).toEqual(untouchedBefore);
    expect((await mentionRow(SEED_MENTIONS.youtube)).view_count).toBe(1_200_000);

    // One request, `part=statistics`, each distinct eligible id once — and nothing else.
    expect(fetchSpy.calls).toHaveLength(1);
    const url = fetchSpy.calls[0] ?? '';
    expect(url.startsWith(`${VIDEOS_URL}?part=statistics&id=`)).toBe(true);
    const askedIds = idsOf(url);
    expect(askedIds).toHaveLength(summary.asked as number);
    expect(new Set(askedIds).size).toBe(askedIds.length);
    expect(askedIds).toEqual(expect.arrayContaining([FIX_1, FIX_2, SEED_VIDEO_ID]));
    expect(askedIds).not.toContain(suggestedVideoId);
    expect(askedIds.filter((id) => id === FIX_1)).toHaveLength(1);

    // 04 §3.4 revalidate: `mentions` once + `project:<slug>` of the changed mention's project. The
    // general mentions add no project tag; the unchanged seed mention's project is not tagged.
    expect(tags.calls).toEqual(['mentions', `project:${projectSlug}`]);

    // SC-11: exactly one finalized row, source `mentions`, error NULL on success.
    expect(await syncRunCount()).toBe(runsBefore + 1);
    const row = await runRow(summary.run_id);
    expect(row.source).toBe('mentions');
    expect(row.started_at).not.toBeNull();
    expect(row.finished_at).not.toBeNull();
    expect(row.ok).toBe(true);
    expect(row.items).toBe(3);
    expect(row.error).toBeNull();
  });

  it('T-ACT-54 run twice → the second run asks again but writes NOTHING (every row byte-equal, updated_at included) and revalidates nothing (J-I)', async () => {
    const ids = [onProject, sameVideo, draftGeneral, tiktok, hidden, suggested, noExternalId];
    ids.push(SEED_MENTIONS.youtube, SEED_MENTIONS.tiktok);
    const before = await mentionRows(ids);
    const fetchSpy = spyFetch(FIXTURE_OK);
    const tags = spyRevalidateTag();
    const summary = await run();

    expect(summary.ok).toBe(true);
    expect(summary).toMatchObject({ items: 0, updated: 0, returned: 2, units: 1, errors: [] });
    expect(summary.unchanged).toBe(summary.mentions);
    expect(fetchSpy.calls).toHaveLength(1);
    expect(tags.calls).toEqual([]);
    expect(await mentionRows(ids)).toEqual(before);
    expect((await runRow(summary.run_id)).items).toBe(0);
  });

  it('T-ACT-54 a count the creator hides (no statistics / no viewCount) → the stored number is kept, never overwritten with NULL (ADR-0045)', async () => {
    await perturb();
    const before = await mentionRows([onProject, sameVideo, draftGeneral]);
    // Derived in memory from the fixture (F-6): item 1 loses `statistics`, item 2 its `viewCount`.
    const fixture = await loadFixture<{ items: Record<string, unknown>[] }>(
      'youtube',
      'videos-mentions.json',
    );
    const [first, second] = fixture.items;
    const hiddenCounts = {
      ...fixture,
      items: [
        { ...first, statistics: undefined },
        { ...second, statistics: { likeCount: '12' } },
      ],
    };
    spyFetch({
      [VIDEOS_URL]: () =>
        new Response(JSON.stringify(hiddenCounts), { status: 200, headers: JSON_HEADERS }),
    });
    const tags = spyRevalidateTag();
    const summary = await run();

    expect(summary.ok).toBe(true);
    expect(summary).toMatchObject({ items: 0, updated: 0, returned: 2, errors: [] });
    expect(await mentionRows([onProject, sameVideo, draftGeneral])).toEqual(before);
    expect(tags.calls).toEqual([]);
  });

  it('T-ACT-54 only the mention whose number differs is written; a changed GENERAL mention revalidates mentions alone (no project tag)', async () => {
    // Heal the two `fixmen00001` rows; leave only the general draft stale.
    await setViews([onProject, sameVideo], FIX_1_VIEWS);
    await setViews([draftGeneral], STALE_VIEWS);
    const before = await mentionRows([onProject, sameVideo]);
    spyFetch(FIXTURE_OK);
    const tags = spyRevalidateTag();
    const summary = await run();

    expect(summary.ok).toBe(true);
    expect(summary).toMatchObject({ items: 1, updated: 1 });
    expect((await mentionRow(draftGeneral)).view_count).toBe(FIX_2_VIEWS);
    expect(await mentionRows([onProject, sameVideo])).toEqual(before);
    expect(tags.calls).toEqual(['mentions']);
  });

  it('T-ACT-54 a NULL stored count is filled once the API answers a number', async () => {
    await setViews([draftGeneral], null);
    spyFetch(FIXTURE_OK);
    const summary = await run();
    expect(summary).toMatchObject({ ok: true, items: 1 });
    expect((await mentionRow(draftGeneral)).view_count).toBe(FIX_2_VIEWS);
  });

  describe('T-ACT-54 batches of ≤ 50 ids per request (00 S1.8 AC7; 05 T-ADP-13 "120 ids → 3 videos calls")', () => {
    let batchIds: string[] = [];

    beforeAll(async () => {
      // 120 eligible general mentions with ids of their own; three of them hang on the project.
      const made: string[] = [];
      for (let index = 0; index < BATCH_SIZE; index += 1) {
        made.push(await makeMention(index < 3 ? { project_id: projectId } : {}));
      }
      batchIds = made;
    }, 120_000);

    afterAll(async () => {
      // Test-side arrangement only (the job itself never removes a row — 04 J-D): later runs in this
      // file go back to one request. `cleanupFactories` tolerates the rows being gone already.
      for (let start = 0; start < batchIds.length; start += 50) {
        const { error } = await service
          .from('mentions')
          .delete()
          .in('id', batchIds.slice(start, start + 50));
        if (error) throw new Error(error.message);
      }
    });

    it('T-ACT-45 T-ACT-54 the SECOND batch failing (400) → ok=false, NOTHING written — not even from the first batch that answered — the third batch never asked, 2 units reported, no tags', async () => {
      const before = await mentionRows(batchIds);
      let requests = 0;
      const fetchSpy = spyFetch({
        [VIDEOS_URL]: (request: Request) => {
          requests += 1;
          return requests === 2
            ? new Response('{}', { status: 400, headers: JSON_HEADERS })
            : answerFactoryIds(request);
        },
      });
      const tags = spyRevalidateTag();
      const summary = await run();

      expect(summary.ok).toBe(false);
      expect(summary).toMatchObject({ items: 0, updated: 0, units: 2 });
      expect(fetchSpy.calls).toHaveLength(2); // 400 is not retried (SC-09); batch 3 is never sent
      expect(await mentionRows(batchIds)).toEqual(before);
      expect(tags.calls).toEqual([]);
      expect(await runRow(summary.run_id)).toMatchObject({ ok: false, items: 0 });
    });

    it('T-ACT-54 every one of 120 writes failing → ok=false, summary.errors capped at 20 entries of ≤ 300 chars, sync_runs.error ≤ 2000, no row changed, no tags (04 J-P)', async () => {
      const before = await mentionRows(batchIds);
      spyFetch({ [VIDEOS_URL]: answerFactoryIds });
      const tags = spyRevalidateTag();
      const summary = await withDbFault({ table: 'mentions', op: 'update' }, { nth: 'all' }, () =>
        run(),
      );
      expect(summary.ok).toBe(false);
      expect(summary).toMatchObject({ items: 0, updated: 0, units: 3 });
      expect(summary.error).toMatch(/^120\/120 items failed: /);
      const errors = summary.errors as string[];
      expect(errors).toHaveLength(20);
      for (const entry of errors) expect(entry.length).toBeLessThanOrEqual(300);
      const row = await runRow(summary.run_id);
      expect(row.ok).toBe(false);
      expect((row.error ?? '').length).toBeGreaterThan(0);
      expect((row.error ?? '').length).toBeLessThanOrEqual(2000);
      expect(await mentionRows(batchIds)).toEqual(before);
      expect(tags.calls).toEqual([]);
    });

    it('T-ACT-54 120 more mentions → 3 requests, every one ≤ 50 ids, each id asked exactly once; every batch is written; units 3 in the summary and the done log line; project tag once', async () => {
      const fetchSpy = spyFetch({ [VIDEOS_URL]: answerFactoryIds });
      const tags = spyRevalidateTag();
      const logs = spyLog();
      let summary: JobSummary;
      try {
        summary = await run();
      } finally {
        logs.restore();
      }

      expect(summary.ok).toBe(true);
      expect(summary).toMatchObject({
        items: BATCH_SIZE,
        updated: BATCH_SIZE,
        returned: BATCH_SIZE,
        units: 3,
        errors: [],
      });

      // Proven twice: by the request count, and by the id count inside every request URL.
      const asked = summary.asked as number;
      expect(asked).toBeGreaterThan(100);
      expect(asked).toBeLessThanOrEqual(150);
      expect(fetchSpy.calls).toHaveLength(3);
      expect(fetchSpy.calls).toHaveLength(Math.ceil(asked / 50));
      const perRequest = fetchSpy.calls.map(idsOf);
      for (const ids of perRequest) {
        expect(ids.length).toBeGreaterThan(0);
        expect(ids.length).toBeLessThanOrEqual(50);
      }
      expect(perRequest.map((ids) => ids.length)).toEqual([50, 50, asked - 100]);
      for (const url of fetchSpy.calls) {
        expect(url.startsWith(`${VIDEOS_URL}?part=statistics&id=`)).toBe(true);
      }
      const everyId = perRequest.flat();
      expect(new Set(everyId).size).toBe(everyId.length);
      expect(everyId).toHaveLength(asked);
      const batchVideoIds = (await mentionRows(batchIds)).map((row) => row.external_id);
      expect(everyId).toEqual(expect.arrayContaining(batchVideoIds));
      expect(everyId).not.toContain(suggestedVideoId);

      // Rows from the first AND the last request were written.
      const after = await mentionRows(batchIds);
      expect(after).toHaveLength(BATCH_SIZE);
      expect(after.every((row) => row.view_count === BATCH_VIEWS)).toBe(true);

      // Three changed mentions share one project → its tag once.
      expect(tags.calls).toEqual(['mentions', `project:${projectSlug}`]);

      // Quota accounting reaches the runner's log line (never the key).
      const done = jobLines(logs.lines, 'done');
      expect(done).toHaveLength(1);
      expect(done[0]?.id).toBe(summary.run_id);
      expect(done[0]?.meta).toMatchObject({
        trigger: 'manual',
        items: BATCH_SIZE,
        units: 3,
        asked,
        updated: BATCH_SIZE,
        errors: 0,
      });
      expectKeyAbsent(JSON.stringify(logs.lines));
    });
  });

  it('T-ACT-54 the eligible read is paged: a full 1,000-row page is followed by the next page; 999 ids go out as 20 requests of ≤ 50; a row that came back without an external_id is never asked about', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      project_id: null,
      // The select filters id-less rows out; the last row proves the job does not rely on that alone.
      external_id: index === 999 ? null : `pg${String(index).padStart(9, '0')}`,
      view_count: 1,
    }));
    const fetchSpy = spyFetch({ [VIDEOS_URL]: statsResponder(() => undefined) });
    const tags = spyRevalidateTag();
    // Page 1 is the synthetic full page; page 2 (`range(1000, 1999)`) goes to the real table → [].
    const summary = await withDbFault(
      { table: 'mentions', op: 'select' },
      { result: { data: fullPage, error: null } },
      () => run(),
    );
    expect(summary.ok).toBe(true);
    expect(summary).toMatchObject({
      items: 0,
      mentions: 999,
      asked: 999,
      returned: 0,
      unchanged: 999,
      units: 20,
    });
    expect(fetchSpy.calls).toHaveLength(20);
    expect(fetchSpy.calls.map((url) => idsOf(url).length)).toEqual([
      ...Array.from({ length: 19 }, () => 50),
      49,
    ]);
    expect(tags.calls).toEqual([]);
  });

  describe('T-ACT-45 gather failures change no row (gather, then write)', () => {
    it('T-ACT-45 a forced videos.list failure (400) → ok=false, error set (≤ 2000, key value absent), zero mentions rows changed, no tags, run finalized, the spent unit reported in the summary and the failed log line', async () => {
      await perturb();
      const ids = [onProject, sameVideo, draftGeneral, SEED_MENTIONS.youtube];
      const before = await mentionRows(ids);
      const runsBefore = await syncRunCount();
      const fetchSpy = spyFetch({ [VIDEOS_URL]: 'status:400' });
      const tags = spyRevalidateTag();
      const logs = spyLog();
      let summary: JobSummary;
      try {
        summary = await run();
      } finally {
        logs.restore();
      }

      expect(summary.ok).toBe(false);
      expect(summary).toMatchObject({ items: 0, updated: 0, returned: 0, units: 1 });
      expect(typeof summary.error).toBe('string');
      expect((summary.error ?? '').length).toBeLessThanOrEqual(2000);
      expect(summary.error).toContain('/videos');
      expectKeyAbsent(summary.error);
      expect(summary.errors).toHaveLength(1);
      expectKeyAbsent(JSON.stringify(summary.errors));
      expect(fetchSpy.calls).toHaveLength(1); // 400 is not retried (SC-09)

      expect(await syncRunCount()).toBe(runsBefore + 1);
      const row = await runRow(summary.run_id);
      expect(row.finished_at).not.toBeNull();
      expect(row.ok).toBe(false);
      expect(row.items).toBe(0);
      expect(row.error).not.toBeNull();
      expectKeyAbsent(row.error);

      const failed = jobLines(logs.lines, 'failed');
      expect(failed).toHaveLength(1);
      expect(failed[0]?.meta).toMatchObject({ trigger: 'manual', units: 1, updated: 0 });
      expectKeyAbsent(JSON.stringify(logs.lines));

      expect(await mentionRows(ids)).toEqual(before);
      expect(tags.calls).toEqual([]);
    });

    it('T-ACT-45 a malformed upstream body (parse_error) is a list failure too → ok=false, zero writes', async () => {
      await perturb();
      const before = await mentionRows([onProject, sameVideo, draftGeneral]);
      spyFetch({
        [VIDEOS_URL]: () =>
          new Response(JSON.stringify({ items: 'nope' }), { status: 200, headers: JSON_HEADERS }),
      });
      const summary = await run();
      expect(summary.ok).toBe(false);
      expect(summary.error).toMatch(/parse_error/);
      expectKeyAbsent(summary.error);
      expect(await mentionRows([onProject, sameVideo, draftGeneral])).toEqual(before);
    });

    it('T-ACT-45 a failed mentions read → ok=false, error names the read, no upstream request, no unit', async () => {
      const fetchSpy = spyFetch(FIXTURE_OK);
      const summary = await withDbFault({ table: 'mentions', op: 'select' }, {}, () => run());
      expect(summary.ok).toBe(false);
      expect(summary.error).toMatch(/mentions read failed/);
      expect(summary.units).toBe(0);
      expect(fetchSpy.calls).toEqual([]);
      expect(await runRow(summary.run_id)).toMatchObject({ ok: false });
    });

    it('T-ACT-45 a mentions read that REJECTS with a non-Error value → ok=false with the value as text, run finalized', async () => {
      const fetchSpy = spyFetch(FIXTURE_OK);
      const summary = await withDbFault(
        { table: 'mentions', op: 'select' },
        { throws: 't_ string rejection' },
        () => run(),
      );
      expect(summary.ok).toBe(false);
      expect(summary.error).toBe('t_ string rejection');
      expect(summary.errors).toEqual(['t_ string rejection']);
      expect(fetchSpy.calls).toEqual([]);
      expect(await runRow(summary.run_id)).toMatchObject({
        ok: false,
        error: 't_ string rejection',
      });
    });

    it('T-ACT-45 a failed projects (slug) read → ok=false BEFORE any write: the numbers stay stale, so the next run retries and revalidates', async () => {
      await perturb();
      const before = await mentionRows([onProject, sameVideo, draftGeneral]);
      spyFetch(FIXTURE_OK);
      const tags = spyRevalidateTag();
      const summary = await withDbFault({ table: 'projects', op: 'select' }, {}, () => run());
      expect(summary.ok).toBe(false);
      expect(summary.error).toMatch(/projects read failed/);
      expect(summary).toMatchObject({ items: 0, units: 1 });
      expect(await mentionRows([onProject, sameVideo, draftGeneral])).toEqual(before);
      expect(tags.calls).toEqual([]);

      // The retry: the same stale rows are written and tagged now.
      spyFetch(FIXTURE_OK);
      const retry = await run();
      expect(retry).toMatchObject({ ok: true, items: 3 });
      expect(tags.calls).toEqual(['mentions', `project:${projectSlug}`]);
    });
  });

  describe('T-ACT-54 per-row write errors (04 J-P)', () => {
    it('T-ACT-54 one failed update of three keeps that row’s old number, is counted in summary.errors, and the run stays ok', async () => {
      await perturb();
      spyFetch(FIXTURE_OK);
      const summary = await withDbFault({ table: 'mentions', op: 'update' }, {}, () => run());
      expect(summary.ok).toBe(true); // 1 of 3 attempted rows failed — not more than half
      expect(summary).toMatchObject({ items: 2, updated: 2 });
      expect(summary.errors).toHaveLength(1);
      expect((summary.errors as string[])[0]).toMatch(/^[0-9a-f-]{36}: mentions update failed/);
      const counts = (await mentionRows([onProject, sameVideo, draftGeneral])).map(
        (row) => row.view_count,
      );
      expect(counts.filter((count) => count === STALE_VIEWS)).toHaveLength(1);
      // mentions = updated + unchanged + failed writes.
      expect(summary.mentions).toBe(
        (summary.updated as number) + (summary.unchanged as number) + 1,
      );
    });

    it('T-ACT-54 more than half of the attempted rows failing → ok=false, error counts them, nothing revalidated, numbers kept', async () => {
      await perturb();
      const before = await mentionRows([onProject, sameVideo, draftGeneral]);
      spyFetch(FIXTURE_OK);
      const tags = spyRevalidateTag();
      const summary = await withDbFault({ table: 'mentions', op: 'update' }, { nth: 'all' }, () =>
        run(),
      );
      expect(summary.ok).toBe(false);
      expect(summary.error).toMatch(/^3\/3 items failed: .*mentions update failed/);
      expect((summary.errors as string[]).length).toBeLessThanOrEqual(20);
      expect(summary).toMatchObject({ items: 0, updated: 0 });
      expect(tags.calls).toEqual([]);
      expect(await mentionRows([onProject, sameVideo, draftGeneral])).toEqual(before);
    });

    it('T-ACT-54 a mention re-pointed at another video between the read and the write keeps its number: the write is guarded on external_id as read (ADR-0045)', async () => {
      // Only `onProject` is stale, so its update is the run's first (and only) write.
      await setViews([sameVideo], FIX_1_VIEWS);
      await setViews([draftGeneral], FIX_2_VIEWS);
      await setViews([onProject], STALE_VIEWS);
      spyFetch(FIXTURE_OK);
      const tags = spyRevalidateTag();
      let summary: JobSummary;
      try {
        summary = await withDbHook(
          { table: 'mentions', op: 'update' },
          async () => {
            // What `updateMention({patch:{external_id}})` would do while the API call was in flight.
            const { error } = await service
              .from('mentions')
              .update({ external_id: FIX_2 })
              .eq('id', onProject);
            if (error) throw new Error(error.message);
          },
          () => run(),
        );
        expect(summary.ok).toBe(true);
        expect(summary).toMatchObject({ items: 0, updated: 0, errors: [] });
        expect(summary.unchanged).toBe(summary.mentions);
        // fixmen00001's count did NOT land on a row that now points at fixmen00002.
        expect(await mentionRow(onProject)).toMatchObject({
          external_id: FIX_2,
          view_count: STALE_VIEWS,
        });
        expect(tags.calls).toEqual([]);
      } finally {
        const { error } = await service
          .from('mentions')
          .update({ external_id: FIX_1 })
          .eq('id', onProject);
        if (error) throw new Error(error.message);
      }
    });
  });

  it("T-ACT-71 YOUTUBE_API_KEY unset → {ok:true, items:0, skipped:'not_configured'}, sync_runs ok=true error='not configured', no request, no write, no tags, a 'skipped' log line", async () => {
    await perturb(); // a keyed run WOULD write three rows
    const ids = [onProject, sameVideo, draftGeneral, SEED_MENTIONS.youtube];
    const before = await mentionRows(ids);
    const runsBefore = await syncRunCount();
    const saved = env.YOUTUBE_API_KEY;
    // `/videos` is routed on purpose: an unrouted loopback URL would slip through to the network.
    const fetchSpy = spyFetch(FIXTURE_OK);
    const tags = spyRevalidateTag();
    const logs = spyLog();
    try {
      env.YOUTUBE_API_KEY = undefined;
      const summary = await run();
      expect(summary.ok).toBe(true);
      expect(summary.source).toBe('mentions');
      expect(summary.items).toBe(0);
      expect(summary.skipped).toBe('not_configured');
      expect(summary.error).toBeUndefined();

      // SC-11: the skipped run still wrote its row — ok=true, error='not configured' (04 §3.4).
      expect(await syncRunCount()).toBe(runsBefore + 1);
      const row = await runRow(summary.run_id);
      expect(row).toMatchObject({ source: 'mentions', ok: true, items: 0 });
      expect(row.error).toBe('not configured');
      expect(row.finished_at).not.toBeNull();

      expect(fetchSpy.calls).toEqual([]);
      expect(tags.calls).toEqual([]);
      expect(await mentionRows(ids)).toEqual(before);
      const skipped = jobLines(logs.lines, 'skipped');
      expect(skipped).toHaveLength(1);
      expect(skipped[0]?.meta).toMatchObject({ reason: 'not_configured' });
    } finally {
      logs.restore();
      env.YOUTUBE_API_KEY = saved;
    }
  });

  it("T-ACT-70 an open mentions run 5 min old → {ok:true, skipped:'running'} with that run's id, no second row, no request, no write (04 SC-13)", async () => {
    const before = await mentionRows([onProject, sameVideo, draftGeneral]);
    const lockId = await makeSyncRun({
      source: 'mentions',
      started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      finished_at: null,
    });
    const withLock = await syncRunCount();
    const fetchSpy = spyFetch(FIXTURE_OK);
    try {
      const summary = await run();
      expect(summary).toMatchObject({ ok: true, skipped: 'running', run_id: lockId, items: 0 });
      expect(await syncRunCount()).toBe(withLock);
      expect(fetchSpy.calls).toEqual([]);
      expect(await mentionRows([onProject, sameVideo, draftGeneral])).toEqual(before);
    } finally {
      // Close the arranged row so it cannot hold the lock for the tests below.
      const { error } = await service
        .from('sync_runs')
        .update({ finished_at: new Date().toISOString(), ok: true, items: 0 })
        .eq('id', lockId);
      if (error) throw new Error(error.message);
    }
  });

  describe('T-ACT-74 refreshMentions sync.failed edge + delivery (04 J-F, ADR-0030 D1, 00 S1.8 AC7, ADR-0045)', () => {
    /** 400 is not retried (SC-09) — a fast forced list failure. */
    const LIST_FAILS = { [VIDEOS_URL]: 'status:400' };

    async function failedEvents(): Promise<{ id: string; run_id: string | undefined }[]> {
      const { data, error } = await service
        .from('notification_events')
        .select('id, payload')
        .eq('kind', 'sync.failed')
        .order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      const rows = data as unknown as {
        id: string;
        payload: { source?: string; run_id?: string };
      }[];
      for (const row of rows) trackNotificationEvent(row.id);
      return rows
        .filter((row) => row.payload.source === 'mentions')
        .map((row) => ({ id: row.id, run_id: row.payload.run_id }));
    }

    beforeAll(async () => {
      await purgeNotificationEvents();
      await restoreSeedSettings();
      const { error } = await service
        .from('site_settings')
        .update({ admin_notify_emails: [EMAIL_A] })
        .eq('id', 1);
      if (error) throw new Error(error.message);
      // SEED-12 has no `mentions` run — the "previous run was ok" edge is arranged here.
      await makeSyncRun({
        source: 'mentions',
        ok: true,
        items: 0,
        finished_at: new Date().toISOString(),
      });
    });

    it('T-ACT-74 refreshMentions: a forced list failure after an ok run → exactly one sync.failed for mentions (key value absent from sync_runs.error and the payload), and the S1.5 pipeline delivers it (AC7)', async () => {
      spyFetch(LIST_FAILS);
      const summary = await run();
      expect(summary.ok).toBe(false);
      const events = await failedEvents();
      expect(events).toHaveLength(1);
      expect(events[0]?.run_id).toBe(summary.run_id);

      const { data: event, error: eventError } = await service
        .from('notification_events')
        .select('subject_type, subject_id, payload')
        .eq('id', events[0]?.id ?? '')
        .single();
      expect(eventError).toBeNull();
      expect(event?.subject_type).toBe('sync_run');
      expect(event?.subject_id).toBe(summary.run_id);
      const payload = event?.payload as {
        source: string;
        run_id: string;
        error: string;
        started_at: string;
      };
      expect(payload.source).toBe('mentions');
      expect(payload.run_id).toBe(summary.run_id);
      expect(payload.error.length).toBeGreaterThan(0);
      expect(payload.error.length).toBeLessThanOrEqual(300);
      expect(Number.isNaN(Date.parse(payload.started_at))).toBe(false);

      // SC-15 / D12: the text may read `key=[redacted]`; the key's value is nowhere.
      expectKeyAbsent(JSON.stringify(event?.payload));
      const row = await runRow(summary.run_id);
      expect(row.ok).toBe(false);
      expect(row.error).not.toBeNull();
      expectKeyAbsent(row.error);

      // Delivery leg: one notify tick fans the event out to the admin address and sends it.
      const resend = spyFetch({ [RESEND_URL]: 'resend/send-ok.json' });
      const tick = await runNotify({ trigger: 'cron' });
      expect(tick.ok).toBe(true);
      const { data: recipients, error: recipientsError } = await service
        .from('notification_recipients')
        .select('channel, address, status')
        .eq('event_id', events[0]?.id ?? '')
        .eq('channel', 'email');
      expect(recipientsError).toBeNull();
      expect(recipients).toEqual([{ channel: 'email', address: EMAIL_A, status: 'sent' }]);
      expect(resend.calls.filter((url) => url === RESEND_URL).length).toBeGreaterThanOrEqual(1);
    });

    it('T-ACT-74 refreshMentions: a second consecutive failing run → no new event (edge-triggered)', async () => {
      spyFetch(LIST_FAILS);
      expect((await run()).ok).toBe(false);
      expect(await failedEvents()).toHaveLength(1);
    });

    it('T-ACT-74 refreshMentions: failed → ok → failed → emits again', async () => {
      spyFetch(FIXTURE_OK);
      expect((await run()).ok).toBe(true);
      expect(await failedEvents()).toHaveLength(1);
      spyFetch(LIST_FAILS);
      const failedRun = await run();
      expect(failedRun.ok).toBe(false);
      const events = await failedEvents();
      expect(events).toHaveLength(2);
      expect(events[1]?.run_id).toBe(failedRun.run_id);
    });

    it("T-ACT-74 refreshMentions: the not_configured run never emits (it is ok:true, error 'not configured')", async () => {
      const saved = env.YOUTUBE_API_KEY;
      const before = (await failedEvents()).length;
      const fetchSpy = spyFetch(FIXTURE_OK);
      try {
        env.YOUTUBE_API_KEY = undefined;
        const summary = await run();
        expect(summary.skipped).toBe('not_configured');
      } finally {
        env.YOUTUBE_API_KEY = saved;
      }
      expect(fetchSpy.calls).toEqual([]);
      expect(await failedEvents()).toHaveLength(before);
    });
  });
});
