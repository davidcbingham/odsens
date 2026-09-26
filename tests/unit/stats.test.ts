/**
 * tests/unit/stats.test.ts — `lib/stats.ts` (05 T-UNIT-42: 30 daily rows → 30 columns, `compact` →
 * 15 columns of 2-day sums, missing days → 0, totals preserved) plus the rules around it: the UTC
 * day helpers across month / year / leap ends with no local getters (01 INV-68), the ADR-0049 D10 delta
 * rule (gap attribution, clamp, first snapshot 0, keyed by snapshot day), the `chartDays` window and
 * the ADR-0049 D11 tiles with their §5 copy — on the SEED-12 shape (45 / 4226 / "No data yet." ×2), on a
 * full snapshot (comments 2 "1 held", tips "Ko-fi isn't counted yet."), on no rows, on older-only
 * rows, and the `up` tone. The last describe pins the `FlatBarChart` markup 05 T-E2E-40 / T-E2E-48
 * read in a browser (`renderToStaticMarkup` — the `mention-preview-render` precedent, no DOM library,
 * 01 INV-78): both variants in one root, 30 + 15 `g[data-day]`, `role="img"` labelled by the parent's
 * heading and described by its own figcaption, the visually-hidden table, the legend words, no
 * strokes / radii / gradients / `<text>`. Pure: no wall clock, no DB, no network.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FlatBarChart, type FlatBarChartProps } from '@/components/primitives/FlatBarChart';
import { formatCount } from '@/lib/format/number';
import {
  AXIS_END,
  AXIS_START,
  CHART_DAYS,
  CHART_TITLE,
  COMPACT_BARS,
  COMPACT_NOTE,
  NO_DATA_YET,
  READ_WINDOW_DAYS,
  SITE_ENTITY_ID,
  STATS_ENTITY_TYPES,
  STATS_METRICS,
  STATS_SOURCES,
  TILE_LABELS,
  TILE_WEEK_DAYS,
  TIPS_WINDOW_DAYS,
  addDays,
  bucketDays,
  buildStatsTiles,
  chartDays,
  dailyDeltas,
  dayRange,
  stackedMax,
  utcDay,
  type DailyDownloads,
  type SiteSnapshotRow,
} from '@/lib/stats';
import { flatBarChartFixtures } from '@/tests/fixtures/ui';

const TODAY = '2026-09-26';
const YESTERDAY = '2026-09-25';

function row(day: string, metric: string, source: string, value: number): SiteSnapshotRow {
  return { day, metric, source, value };
}

/** SEED-12 as pinned (ADR-0049 D4): today 4099 / 120 / 7, yesterday 4059 / 117 / 5. */
function seedRows(today = TODAY): SiteSnapshotRow[] {
  const yesterday = addDays(today, -1);
  return [
    row(today, 'downloads', 'modrinth', 4099),
    row(today, 'downloads', 'curseforge', 120),
    row(today, 'downloads', 'direct', 7),
    row(yesterday, 'downloads', 'modrinth', 4059),
    row(yesterday, 'downloads', 'curseforge', 117),
    row(yesterday, 'downloads', 'direct', 5),
  ];
}

/** 30 seeded-looking days ending TODAY: modrinth 40 + i, curseforge i % 5, direct i % 3. */
function thirtyDays(): DailyDownloads[] {
  return dayRange(TODAY, CHART_DAYS).map((date, i) => ({
    date,
    modrinth: 40 + i,
    curseforge: i % 5,
    direct: i % 3,
  }));
}

function totals(days: readonly DailyDownloads[]) {
  return days.reduce(
    (acc, d) => ({
      modrinth: acc.modrinth + d.modrinth,
      curseforge: acc.curseforge + d.curseforge,
      direct: acc.direct + d.direct,
    }),
    { modrinth: 0, curseforge: 0, direct: 0 },
  );
}

function count(haystack: string, needle: RegExp): number {
  return (haystack.match(needle) ?? []).length;
}

function render(props: FlatBarChartProps): string {
  return renderToStaticMarkup(createElement(FlatBarChart, props));
}

describe('registry vocabulary + windows (ADR-0049 D1 lists; ADR-0049 D10 / ADR-0049 D11 numbers)', () => {
  it('exports the 11 metrics, 6 sources, 4 entity types and the site sentinel', () => {
    expect(STATS_METRICS).toHaveLength(11);
    expect(STATS_METRICS).toContain('direct_downloads_day');
    expect(STATS_SOURCES).toEqual([
      'modrinth',
      'curseforge',
      'direct',
      'odsens',
      'youtube',
      'kofi',
    ]);
    expect(STATS_ENTITY_TYPES).toEqual(['site', 'project', 'video', 'channel']);
    expect(SITE_ENTITY_ID).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('READ_WINDOW_DAYS = CHART_DAYS + TILE_WEEK_DAYS + 1 = 38; 15 compact bars cover 30 days', () => {
    expect(CHART_DAYS).toBe(30);
    expect(COMPACT_BARS).toBe(15);
    expect(TILE_WEEK_DAYS).toBe(7);
    expect(TIPS_WINDOW_DAYS).toBe(30);
    expect(READ_WINDOW_DAYS).toBe(CHART_DAYS + TILE_WEEK_DAYS + 1);
  });
});

describe('utcDay (01 INV-68 — the UTC calendar date, never the local one)', () => {
  it.each([
    ['2026-09-26T00:00:00Z', '2026-09-26'],
    ['2026-09-26T23:59:59.999Z', '2026-09-26'],
    ['2026-12-31T23:30:00-05:00', '2027-01-01'], // the offset's evening is UTC's new year
    ['2026-01-01T01:30:00+05:00', '2025-12-31'],
    ['2026-03-01T00:00:00Z', '2026-03-01'], // zero-padded month + day
    ['2024-02-29T12:00:00Z', '2024-02-29'],
  ])('utcDay(%s) → %s', (input, expected) => {
    expect(utcDay(new Date(input))).toBe(expected);
  });

  it('throws on an invalid date instead of printing NaN', () => {
    expect(() => utcDay(new Date(Number.NaN))).toThrow(/invalid date/);
  });
});

describe('addDays / dayRange (calendar arithmetic in UTC — month, year, leap, DST-free)', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2024-03-01', -1, '2024-02-29'], // leap day
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2026-03-29', -1, '2026-03-28'], // a DST-change date in Europe: still one calendar day
    ['2026-10-25', 1, '2026-10-26'],
    ['2026-03-28', 2, '2026-03-30'],
    ['2026-09-26', 0, '2026-09-26'],
    ['2026-09-26', -(READ_WINDOW_DAYS - 1), '2026-08-20'], // the reader's window start
    ['2026-09-26', -(CHART_DAYS - 1), '2026-08-28'], // the chart's first day
  ])('addDays(%s, %i) → %s', (day, n, expected) => {
    expect(addDays(day, n)).toBe(expected);
  });

  it('round-trips through the year end in both directions', () => {
    expect(addDays(addDays('2026-12-30', 5), -5)).toBe('2026-12-30');
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    expect(() => addDays('26/09/2026', 1)).toThrow(/YYYY-MM-DD/);
    expect(() => addDays('2026-09-26T00:00:00Z', 1)).toThrow(/YYYY-MM-DD/);
  });

  it('dayRange is ascending, `days` long and ends at endDay', () => {
    expect(dayRange('2026-09-26', 3)).toEqual(['2026-09-24', '2026-09-25', '2026-09-26']);
    expect(dayRange('2026-03-02', 4)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(dayRange('2026-09-26', 0)).toEqual([]);
    const window = dayRange(TODAY, CHART_DAYS);
    expect(window).toHaveLength(30);
    expect(window[0]).toBe('2026-08-28');
    expect(window[29]).toBe(TODAY);
  });
});

describe('dailyDeltas (ADR-0049 D10)', () => {
  it('first snapshot 0, a gap attributes the whole gain to the later day, a drop clamps to 0', () => {
    const rows = [
      row('2026-09-26', 'downloads', 'modrinth', 140), // unsorted on purpose
      row('2026-09-21', 'downloads', 'modrinth', 100),
      row('2026-09-23', 'downloads', 'modrinth', 130),
      row('2026-09-25', 'downloads', 'modrinth', 125),
    ];
    const deltas = dailyDeltas(rows, 'downloads', 'modrinth');
    expect([...deltas.entries()]).toEqual([
      ['2026-09-21', 0], // first snapshot has no delta
      ['2026-09-23', 30], // two-day gap → the later day gets it all
      ['2026-09-25', 0], // 125 < 130 → clamped
      ['2026-09-26', 15],
    ]);
    expect(deltas.has('2026-09-22')).toBe(false); // keyed by snapshot day only
  });

  it('looks only at its own (metric, source)', () => {
    const rows = [
      row('2026-09-25', 'downloads', 'modrinth', 100),
      row('2026-09-26', 'downloads', 'modrinth', 110),
      row('2026-09-25', 'downloads', 'curseforge', 5),
      row('2026-09-26', 'downloads', 'curseforge', 900),
      row('2026-09-26', 'comments', 'odsens', 2),
    ];
    expect([...dailyDeltas(rows, 'downloads', 'modrinth').entries()]).toEqual([
      ['2026-09-25', 0],
      ['2026-09-26', 10],
    ]);
    expect(dailyDeltas(rows, 'tips', 'kofi').size).toBe(0);
    expect(dailyDeltas([], 'downloads', 'direct').size).toBe(0);
  });
});

describe('chartDays (ADR-0049 D10 window: today−29 … today)', () => {
  it('30 ascending entries ending today; a pre-window snapshot feeds the first day; gaps are 0', () => {
    const rows = [
      row('2026-08-27', 'downloads', 'modrinth', 1000), // today−30: outside, but the baseline
      row('2026-08-28', 'downloads', 'modrinth', 1010), // today−29: the first column
      row(TODAY, 'downloads', 'modrinth', 1050),
      row(YESTERDAY, 'downloads', 'curseforge', 10),
      row(TODAY, 'downloads', 'curseforge', 13),
    ];
    const days = chartDays(rows, TODAY);
    expect(days).toHaveLength(CHART_DAYS);
    expect(days.map((d) => d.date)).toEqual(dayRange(TODAY, CHART_DAYS));
    expect(days[0]).toEqual({ date: '2026-08-28', modrinth: 10, curseforge: 0, direct: 0 });
    expect(days[28]).toEqual({ date: YESTERDAY, modrinth: 0, curseforge: 0, direct: 0 });
    expect(days[29]).toEqual({ date: TODAY, modrinth: 40, curseforge: 3, direct: 0 });
    expect(days[10]).toEqual({ date: '2026-09-07', modrinth: 0, curseforge: 0, direct: 0 });
  });

  it('no rows → 30 zero days (the empty chart still has 30 columns)', () => {
    const days = chartDays([], TODAY);
    expect(days).toHaveLength(30);
    expect(days.every((d) => d.modrinth === 0 && d.curseforge === 0 && d.direct === 0)).toBe(true);
  });
});

describe('T-UNIT-42 bucketDays (30 → 30 | 15)', () => {
  it('T-UNIT-42 30 daily rows → 30 columns, unchanged and copied', () => {
    const days = thirtyDays();
    const out = bucketDays(days, false);
    expect(out).toHaveLength(30);
    expect(out).toEqual(days);
    expect(out).not.toBe(days);
    expect(out[0]).not.toBe(days[0]);
  });

  it('T-UNIT-42 compact → 15 columns of 2-day sums, dated by the first day of each pair', () => {
    const days = thirtyDays();
    const out = bucketDays(days, true);
    expect(out).toHaveLength(COMPACT_BARS);
    out.forEach((bucket, b) => {
      const a = days[2 * b];
      const z = days[2 * b + 1];
      if (!a || !z) throw new Error('pair missing');
      expect(bucket).toEqual({
        date: a.date,
        modrinth: a.modrinth + z.modrinth,
        curseforge: a.curseforge + z.curseforge,
        direct: a.direct + z.direct,
      });
    });
    expect(out[0]?.date).toBe('2026-08-28');
    expect(out[14]?.date).toBe(YESTERDAY); // (today−1, today) is the last pair
  });

  it('T-UNIT-42 totals are preserved in both variants', () => {
    const days = thirtyDays();
    expect(totals(bucketDays(days, false))).toEqual(totals(days));
    expect(totals(bucketDays(days, true))).toEqual(totals(days));
    expect(totals(days)).toEqual({ modrinth: 1635, curseforge: 60, direct: 30 });
  });

  it('T-UNIT-42 missing days → 0 in both variants', () => {
    const days = chartDays(seedRows(), TODAY); // only today carries deltas (40 / 3 / 2)
    const full = bucketDays(days, false);
    const compact = bucketDays(days, true);
    expect(full.slice(0, 29).every((d) => d.modrinth + d.curseforge + d.direct === 0)).toBe(true);
    expect(full[29]).toEqual({ date: TODAY, modrinth: 40, curseforge: 3, direct: 2 });
    expect(compact.slice(0, 14).every((d) => d.modrinth + d.curseforge + d.direct === 0)).toBe(
      true,
    );
    expect(compact[14]).toEqual({ date: YESTERDAY, modrinth: 40, curseforge: 3, direct: 2 });
    expect(totals(compact)).toEqual(totals(days));
  });

  it('odd tails: the last bucket holds the remainder; 1 → 1; 0 → []', () => {
    const thirtyOne = dayRange(TODAY, 31).map((date, i) => ({
      date,
      modrinth: i,
      curseforge: 1,
      direct: 0,
    }));
    const out31 = bucketDays(thirtyOne, true);
    expect(out31).toHaveLength(15);
    expect(out31[14]).toEqual({
      date: thirtyOne[28]?.date,
      modrinth: 28 + 29 + 30,
      curseforge: 3,
      direct: 0,
    });
    expect(totals(out31)).toEqual(totals(thirtyOne));

    const twentyNine = thirtyOne.slice(0, 29);
    const out29 = bucketDays(twentyNine, true);
    expect(out29).toHaveLength(14);
    expect(out29[13]?.curseforge).toBe(3);
    expect(totals(out29)).toEqual(totals(twentyNine));

    expect(bucketDays(thirtyOne.slice(0, 1), true)).toEqual([thirtyOne[0]]);
    expect(bucketDays([], true)).toEqual([]);
    expect(bucketDays([], false)).toEqual([]);
  });

  it('stackedMax is the tallest stacked column, 0 for none', () => {
    expect(stackedMax([])).toBe(0);
    expect(stackedMax(thirtyDays())).toBe(40 + 29 + (29 % 5) + (29 % 3));
    expect(stackedMax(chartDays([], TODAY))).toBe(0);
  });
});

describe('buildStatsTiles (ADR-0049 D11 + §5 copy)', () => {
  it('SEED-12 shape: 45 this week, "First week counted.", 4226 all time, comments + tips empty', () => {
    const tiles = buildStatsTiles(seedRows(), TODAY);
    expect(tiles.downloads7).toEqual({
      label: TILE_LABELS.downloads7,
      value: 45,
      context: { text: 'First week counted.', tone: 'neutral' },
    });
    expect(tiles.downloadsAll).toEqual({
      label: TILE_LABELS.downloadsAll,
      value: 4226,
      context: { text: 'Modrinth 4.1K · CurseForge 120 · direct 7', tone: 'neutral' },
    });
    expect(formatCount(tiles.downloadsAll.value)).toBe('4.2K'); // what T-E2E-40 reads on the tile
    expect(tiles.comments).toEqual({
      label: TILE_LABELS.comments,
      value: 0,
      context: { text: NO_DATA_YET, tone: 'neutral' },
    });
    expect(tiles.tips).toEqual({
      label: TILE_LABELS.tips,
      value: 0,
      context: { text: NO_DATA_YET, tone: 'neutral' },
    });
  });

  it('the labels are the four §5 strings, in page order', () => {
    expect(Object.keys(buildStatsTiles([], TODAY))).toEqual([
      'downloads7',
      'downloadsAll',
      'comments',
      'tips',
    ]);
    expect(TILE_LABELS).toEqual({
      downloads7: 'Downloads · 7 days',
      downloadsAll: 'Downloads · all time',
      comments: 'Comments',
      tips: 'Tips · 30 days',
    });
  });

  it('full snapshot: comments 2 with "1 held" (attention), tips 0 "Ko-fi isn\'t counted yet."', () => {
    const rows = [
      ...seedRows(),
      row(TODAY, 'comments', 'odsens', 2),
      row(TODAY, 'comments_held', 'odsens', 1),
      row(TODAY, 'tips', 'kofi', 0),
      row(TODAY, 'likes', 'odsens', 1),
      row(TODAY, 'users', 'odsens', 5),
      row(TODAY, 'reach', 'youtube', 1_200_000),
      row(TODAY, 'mentions', 'odsens', 2),
    ];
    const tiles = buildStatsTiles(rows, TODAY);
    expect(tiles.comments).toEqual({
      label: TILE_LABELS.comments,
      value: 2,
      context: { text: '1 held', tone: 'attention' },
    });
    expect(tiles.tips).toEqual({
      label: TILE_LABELS.tips,
      value: 0,
      context: { text: "Ko-fi isn't counted yet.", tone: 'neutral' },
    });
    expect(tiles.downloads7.value).toBe(45); // the other metrics never leak into downloads
  });

  it('no rows: every tile 0 + "No data yet." (neutral)', () => {
    const tiles = buildStatsTiles([], TODAY);
    for (const tile of Object.values(tiles)) {
      expect(tile.value).toBe(0);
      expect(tile.context).toEqual({ text: NO_DATA_YET, tone: 'neutral' });
    }
  });

  it('"<prev7> the week before" — `up` only when this week beat the week before', () => {
    const base = (m14: number, m7: number, m0: number) => [
      row(addDays(TODAY, -14), 'downloads', 'modrinth', m14),
      row(addDays(TODAY, -7), 'downloads', 'modrinth', m7),
      row(TODAY, 'downloads', 'modrinth', m0),
    ];
    const up = buildStatsTiles(base(100, 110, 130), TODAY).downloads7;
    expect(up).toEqual({
      label: TILE_LABELS.downloads7,
      value: 20,
      context: { text: '10 the week before', tone: 'up' },
    });
    const down = buildStatsTiles(base(100, 130, 140), TODAY).downloads7;
    expect(down.value).toBe(10);
    expect(down.context).toEqual({ text: '30 the week before', tone: 'neutral' });
    const flat = buildStatsTiles(base(100, 110, 120), TODAY).downloads7;
    expect(flat.context).toEqual({ text: '10 the week before', tone: 'neutral' });
  });

  it('the week before is today−13 … today−7; a snapshot on today−14 alone does not count as one', () => {
    const rows = [
      row(addDays(TODAY, -14), 'downloads', 'modrinth', 100),
      row(TODAY, 'downloads', 'modrinth', 130),
    ];
    const tile = buildStatsTiles(rows, TODAY).downloads7;
    expect(tile.value).toBe(30); // the 14-day gap lands on today
    expect(tile.context).toEqual({ text: 'First week counted.', tone: 'neutral' });
  });

  it('a first snapshot inside the week reads 0 + "First week counted.", not "No data yet."', () => {
    const tile = buildStatsTiles([row(TODAY, 'downloads', 'modrinth', 4099)], TODAY).downloads7;
    expect(tile).toEqual({
      label: TILE_LABELS.downloads7,
      value: 0,
      context: { text: 'First week counted.', tone: 'neutral' },
    });
  });

  it('a snapshot older than the 7 days but inside the read window: 7-day empty, all-time shown', () => {
    const tenDaysAgo = addDays(TODAY, -10);
    const tiles = buildStatsTiles(
      [
        row(tenDaysAgo, 'downloads', 'modrinth', 4000),
        row(tenDaysAgo, 'downloads', 'curseforge', 100),
        row(tenDaysAgo, 'downloads', 'direct', 6),
      ],
      TODAY,
    );
    expect(tiles.downloads7.context.text).toBe(NO_DATA_YET);
    expect(tiles.downloadsAll.value).toBe(4106);
    expect(tiles.downloadsAll.context.text).toBe('Modrinth 4K · CurseForge 100 · direct 6');
  });

  it('older-only rows (before today−37) read as "No data yet." everywhere; today−37 still counts', () => {
    const tooOld = buildStatsTiles(
      [
        row(addDays(TODAY, -38), 'downloads', 'modrinth', 4000),
        row(addDays(TODAY, -40), 'comments', 'odsens', 9),
        row(addDays(TODAY, -38), 'tips', 'kofi', 0),
      ],
      TODAY,
    );
    for (const tile of Object.values(tooOld)) expect(tile.context.text).toBe(NO_DATA_YET);

    const edge = buildStatsTiles(
      [
        row(addDays(TODAY, -37), 'downloads', 'modrinth', 4000),
        row(addDays(TODAY, -37), 'comments', 'odsens', 9),
      ],
      TODAY,
    );
    expect(edge.downloadsAll.value).toBe(4000);
    expect(edge.comments.value).toBe(9);
    expect(edge.comments.context).toEqual({ text: '0 held', tone: 'neutral' });
  });

  it('tips: a tips snapshot inside 30 days flips the context; one on today−30 does not', () => {
    const inside = buildStatsTiles([row(addDays(TODAY, -29), 'tips', 'kofi', 0)], TODAY).tips;
    expect(inside.context.text).toBe("Ko-fi isn't counted yet.");
    const outside = buildStatsTiles([row(addDays(TODAY, -30), 'tips', 'kofi', 0)], TODAY).tips;
    expect(outside.context.text).toBe(NO_DATA_YET);
    const summed = buildStatsTiles(
      [
        row(addDays(TODAY, -3), 'tips', 'kofi', 10),
        row(addDays(TODAY, -1), 'tips', 'kofi', 25),
        row(TODAY, 'tips', 'kofi', 25),
      ],
      TODAY,
    ).tips;
    expect(summed.value).toBe(15);
  });

  it('held: the same day as the latest comments row wins, else the latest held row, else 0', () => {
    const sameDay = buildStatsTiles(
      [
        row(YESTERDAY, 'comments', 'odsens', 1),
        row(YESTERDAY, 'comments_held', 'odsens', 5),
        row(TODAY, 'comments', 'odsens', 2),
        row(TODAY, 'comments_held', 'odsens', 0),
      ],
      TODAY,
    ).comments;
    expect(sameDay).toEqual({
      label: TILE_LABELS.comments,
      value: 2,
      context: { text: '0 held', tone: 'neutral' },
    });
    const fallback = buildStatsTiles(
      [row(YESTERDAY, 'comments_held', 'odsens', 3), row(TODAY, 'comments', 'odsens', 2)],
      TODAY,
    ).comments;
    expect(fallback.context).toEqual({ text: '3 held', tone: 'attention' });
    const none = buildStatsTiles([row(TODAY, 'comments', 'odsens', 2)], TODAY).comments;
    expect(none.context).toEqual({ text: '0 held', tone: 'neutral' });
  });

  it('all time: the latest downloads day; a source missing on that day counts 0', () => {
    const rows = [
      row(YESTERDAY, 'downloads', 'modrinth', 4059),
      row(YESTERDAY, 'downloads', 'curseforge', 117),
      row(YESTERDAY, 'downloads', 'direct', 5),
      row(TODAY, 'downloads', 'modrinth', 4099),
    ];
    const tile = buildStatsTiles(rows, TODAY).downloadsAll;
    expect(tile.value).toBe(4099);
    expect(tile.context).toEqual({
      text: 'Modrinth 4.1K · CurseForge 0 · direct 0',
      tone: 'neutral',
    });
  });

  it('anchors on the caller\'s `today`, not the rows: the seed a week later reads "No data yet."', () => {
    const later = buildStatsTiles(seedRows(), addDays(TODAY, 7));
    expect(later.downloads7.context.text).toBe(NO_DATA_YET);
    expect(later.downloadsAll.value).toBe(4226); // still inside the 38-day read window
  });
});

describe('FlatBarChart markup (backs T-E2E-40 / T-E2E-48 — ADR-0049 D12)', () => {
  const days = thirtyDays();
  const titleId = 'chart-heading';

  it('renders both variants in one root when `compact` is undefined: 30 + 15 columns', () => {
    const html = render({ days, title: CHART_TITLE, titleId });
    expect(html).toContain('data-variant="both"');
    expect(count(html, /<figure[^>]*data-full=""/g)).toBe(1);
    expect(count(html, /<figure[^>]*data-compact=""/g)).toBe(1);
    expect(count(html, /<g data-day="/g)).toBe(CHART_DAYS + COMPACT_BARS);
    expect(count(html, /<svg[^>]*role="img"/g)).toBe(2);
    expect(count(html, /viewBox="0 0 300 100"/g)).toBe(1);
    expect(count(html, /viewBox="0 0 150 100"/g)).toBe(1);
    expect(count(html, /preserveAspectRatio="none"/g)).toBe(2);
  });

  it('`compact: true` / `false` force one variant', () => {
    const compact = render({ days, title: CHART_TITLE, titleId, compact: true });
    expect(compact).toContain('data-variant="compact"');
    expect(count(compact, /<figure/g)).toBe(1);
    expect(compact).toContain('data-compact=""');
    expect(compact).not.toContain('data-full=""');
    expect(count(compact, /<g data-day="/g)).toBe(COMPACT_BARS);
    expect(compact).toContain(`>${COMPACT_NOTE}<`);

    const full = render({ days, title: CHART_TITLE, titleId, compact: false });
    expect(full).toContain('data-variant="full"');
    expect(count(full, /<figure/g)).toBe(1);
    expect(full).toContain('data-full=""');
    expect(full).not.toContain('data-compact=""');
    expect(count(full, /<g data-day="/g)).toBe(CHART_DAYS);
    expect(full).not.toContain(COMPACT_NOTE);
    expect(full).toContain('class="visually-hidden">Daily</figcaption>');
  });

  it('each SVG is labelled by the parent heading and described by its own figcaption', () => {
    const html = render({ days, title: CHART_TITLE, titleId });
    expect(count(html, new RegExp(`aria-labelledby="${titleId}"`, 'g'))).toBe(2);
    expect(html).toContain(`aria-describedby="${titleId}-full-note"`);
    expect(html).toContain(`aria-describedby="${titleId}-compact-note"`);
    expect(html).toMatch(
      new RegExp(`<figcaption id="${titleId}-full-note"[^>]*>Daily</figcaption>`),
    );
    expect(html).toMatch(
      new RegExp(`<figcaption id="${titleId}-compact-note"[^>]*>${COMPACT_NOTE}</figcaption>`),
    );
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('<h2');
    expect(html).not.toContain('<h3');
  });

  it('without a titleId the SVGs are labelled by the hidden table caption, which carries `title`', () => {
    const html = render({ days, title: CHART_TITLE, compact: false });
    const captionId = 'section-title-downloads-last-30-days-table-caption';
    expect(html).toContain(`aria-labelledby="${captionId}"`);
    expect(html).toContain(`<caption id="${captionId}">${CHART_TITLE}</caption>`);
  });

  it('ONE visually-hidden table: caption = title, 5 headers, one row per day with the total', () => {
    const html = render({ days, title: CHART_TITLE, titleId });
    expect(count(html, /<table/g)).toBe(1);
    expect(html).toMatch(/<div class="visually-hidden"><table data-testid="flat-bar-chart-table">/);
    expect(html).toContain(`>${CHART_TITLE}</caption>`);
    for (const header of ['Day', 'Modrinth', 'CurseForge', 'Direct', 'Total']) {
      expect(html).toContain(`<th scope="col">${header}</th>`);
    }
    expect(count(html, /<th scope="row">/g)).toBe(CHART_DAYS);
    // day 29: modrinth 69, curseforge 4, direct 2 → total 75
    expect(html).toContain(
      `<tr><th scope="row">${TODAY}</th><td>69</td><td>4</td><td>2</td><td>75</td></tr>`,
    );
    expect(html).toContain(
      `<th scope="row">2026-08-28</th><td>40</td><td>0</td><td>0</td><td>40</td>`,
    );
  });

  it('legend = the three swatch words, once per variant (plus the table headers)', () => {
    const both = render({ days, title: CHART_TITLE, titleId });
    for (const word of ['Modrinth', 'CurseForge', 'Direct']) {
      expect(count(both, new RegExp(`>${word}<`, 'g'))).toBe(3); // 2 legends + 1 <th>
    }
    const one = render({ days, title: CHART_TITLE, titleId, compact: true });
    expect(count(one, />Modrinth</g)).toBe(2);
    expect(count(one, /<span[^>]*data-source="modrinth"/g)).toBe(1);
  });

  it('columns: up to three rects per day, stacked modrinth → curseforge → direct, zero values draw none', () => {
    const three: DailyDownloads[] = [
      { date: '2026-09-24', modrinth: 50, curseforge: 0, direct: 50 },
      { date: '2026-09-25', modrinth: 25, curseforge: 25, direct: 0 },
      { date: '2026-09-26', modrinth: 0, curseforge: 0, direct: 0 },
    ];
    const html = render({ days: three, title: CHART_TITLE, titleId, compact: false });
    expect(html).toContain('viewBox="0 0 30 100"');
    expect(html).toContain(
      '<g data-day="2026-09-24"><rect data-source="modrinth" x="0.5" y="50" width="9" height="50"></rect><rect data-source="direct" x="0.5" y="0" width="9" height="50"></rect></g>',
    );
    expect(html).toContain(
      '<g data-day="2026-09-25"><rect data-source="modrinth" x="10.5" y="75" width="9" height="25"></rect><rect data-source="curseforge" x="10.5" y="50" width="9" height="25"></rect></g>',
    );
    expect(html).toContain('<g data-day="2026-09-26"></g>');
    expect(count(html, /<rect/g)).toBe(4);
  });

  it('empty chart: 30 columns, no rects, the Y column says only 0', () => {
    const empty = flatBarChartFixtures.find((f) => f.label === 'FlatBarChart · empty');
    if (!empty) throw new Error('empty fixture missing');
    const html = render(empty.props);
    expect(count(html, /<g data-day="/g)).toBe(CHART_DAYS);
    expect(html).not.toContain('<rect');
    const beforeSvg = html.slice(0, html.indexOf('<svg'));
    expect(count(beforeSvg, /<span/g)).toBe(1);
    expect(beforeSvg).toMatch(/>0<\/span>/);
  });

  it('axis labels are HTML spans (never SVG <text>): max · half · 0 beside, the two end words under', () => {
    const html = render({ days, title: CHART_TITLE, titleId, compact: false });
    const max = stackedMax(days);
    const beforeSvg = html.slice(0, html.indexOf('<svg'));
    expect(count(beforeSvg, /<span/g)).toBe(3);
    expect(beforeSvg).toContain(`>${formatCount(max)}</span>`);
    expect(beforeSvg).toContain(`>${formatCount(max / 2)}</span>`);
    expect(beforeSvg).toContain('>0</span>');
    expect(html).toContain(`>${AXIS_START}</span>`);
    expect(html).toContain(`>${AXIS_END}</span>`);
    expect(html).not.toContain('<text');
    expect(count(html, /aria-hidden="true"/g)).toBeGreaterThanOrEqual(2);
  });

  it('flat: no stroke, no radius, no gradient, nothing interactive', () => {
    const html = render({ days, title: CHART_TITLE, titleId });
    expect(html).not.toMatch(/stroke/);
    expect(html).not.toMatch(/\brx=|\bry=/);
    expect(html).not.toMatch(/gradient/i);
    expect(html).not.toMatch(/<button|tabindex|onclick/i);
  });

  it('every svg carries a <title> first child — the T-E2E-48 inline-SVG rule (ADR-0049 D28 d)', () => {
    const html = render({ days, title: CHART_TITLE, titleId });
    // Both variants: the full chart's title is the `title` prop, the compact one adds the note.
    expect(html).toMatch(/<svg[^>]*><title>Downloads · last 30 days<\/title>/);
    expect(html).toMatch(
      /<svg[^>]*><title>Downloads · last 30 days — 15 bars, two days each<\/title>/,
    );
    expect(count(html, /<title>/g)).toBe(2);
  });

  it('passes className through to the root', () => {
    const html = render({ days, title: CHART_TITLE, titleId, className: 'extra-hook' });
    expect(html).toMatch(/^<div class="[^"]*extra-hook" data-variant="both">/);
  });

  it('the gallery fixtures: three labelled states, 30 days each, forced variants (ADR-0049 D24)', () => {
    expect(flatBarChartFixtures.map((f) => f.label)).toEqual([
      'FlatBarChart · 30 days',
      'FlatBarChart · compact',
      'FlatBarChart · empty',
    ]);
    expect(flatBarChartFixtures.map((f) => f.props.compact)).toEqual([false, true, false]);
    for (const { props } of flatBarChartFixtures) {
      expect(props.days).toHaveLength(CHART_DAYS);
      expect(props.title).toBe(CHART_TITLE);
      expect(() => render({ ...props, titleId })).not.toThrow();
    }
    const seeded = flatBarChartFixtures[0];
    if (!seeded) throw new Error('fixture missing');
    expect(stackedMax(seeded.props.days)).toBeGreaterThan(0);
    expect(totals(bucketDays(seeded.props.days, true))).toEqual(totals(seeded.props.days));
  });
});
