/**
 * tests/unit/seen-on-fixtures.test.ts — the S1.8 Seen on gallery fixtures
 * (`tests/fixtures/ui/seenOn.ts`, `platformMark.ts`) held to the rules `/dev/components` lives by
 * (03 §7; ADR-0004; ADR-0045). Supporting checks for T-E2E-48 (the gallery's axe pass) and the
 * T-E2E-10 empty-filter leg — no catalogue id of their own (05 ADR-R9; the `videos.test.ts`
 * precedent): titles carry the id they back.
 *
 * Why a unit test: two of these rules fail silently everywhere but `pnpm dev` —
 *   - `PixelLabel` throws on more than five words ONLY under `isDev`, so a too-long specimen
 *     label, chip or reach segment would pass CI and crash the gallery locally;
 *   - a remote thumbnail in a fixture would make the gallery (and the e2e run that loads it) ask
 *     a third-party host for an image — the gallery is "no DB, no network", and a non-YouTube
 *     thumbnail is never rendered at all (ADR-0002 #33).
 * Pure — the fixture module imports component TYPES only, so nothing here touches the DOM.
 */
import { describe, expect, it } from 'vitest';
import { formatReachLine } from '@/lib/format/reach';
import {
  MENTION_PLATFORMS,
  applyMentionFilters,
  isPlayableInline,
  linkOutChipLabel,
  platformCounts,
  projectOptions,
  type MentionCardData,
} from '@/lib/mentions';
import { platformMarkFixtures } from '@/tests/fixtures/ui/platformMark';
import {
  inTheWildStripFixtures,
  mentionCardFixtures,
  reachLineFixtures,
  seenOnDescribedStates,
  seenOnGridFixtures,
  seenOnRowFixtures,
} from '@/tests/fixtures/ui/seenOn';

/** `PixelLabel`'s own count: whitespace-separated tokens (`components/primitives/PixelLabel.tsx`). */
function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const PIXEL_LABEL_MAX_WORDS = 5;

/** Every mention any Seen on specimen renders. */
function allMentions(): MentionCardData[] {
  return [
    ...mentionCardFixtures.map(({ props }) => props.mention),
    ...seenOnRowFixtures.flatMap(({ props }) => props.mentions),
    ...inTheWildStripFixtures.flatMap(({ props }) => props.featured),
    ...seenOnGridFixtures.flatMap(({ props }) => props.mentions),
  ];
}

describe('Seen on gallery fixtures — labels', () => {
  const groups: [string, { label: string }[]][] = [
    ['MentionCard', mentionCardFixtures],
    ['ReachLine', reachLineFixtures],
    ['SeenOnRow', seenOnRowFixtures],
    ['InTheWildStrip', inTheWildStripFixtures],
    ['SeenOnGrid', seenOnGridFixtures],
    ['PlatformMark', platformMarkFixtures],
  ];

  it.each(groups)(
    'T-E2E-48 %s specimen labels read "<Name> · <state>" in at most five words',
    (name, fixtures) => {
      expect(fixtures.length).toBeGreaterThan(0);
      for (const { label } of fixtures) {
        expect(label.startsWith(`${name} · `), label).toBe(true);
        expect(words(label), label).toBeLessThanOrEqual(PIXEL_LABEL_MAX_WORDS);
      }
    },
  );

  it('T-E2E-48 described states name a Seen on component and stay within five words', () => {
    const names = new Set(['MentionCard', 'ReachLine', 'SeenOnRow', 'InTheWildStrip']);
    for (const { name, label, note } of seenOnDescribedStates) {
      expect(names.has(name), name).toBe(true);
      expect(label.startsWith(`${name} · `), label).toBe(true);
      expect(words(label), label).toBeLessThanOrEqual(PIXEL_LABEL_MAX_WORDS);
      expect(note.length).toBeGreaterThan(0);
    }
    // 03 §3: `MentionCard` `idle | playing` — `playing` is the described one.
    expect(seenOnDescribedStates.map(({ label }) => label)).toContain('MentionCard · playing');
  });

  it('T-E2E-48 labels are unique (they are the React keys and the specimen names)', () => {
    const labels = [
      ...mentionCardFixtures,
      ...reachLineFixtures,
      ...seenOnRowFixtures,
      ...inTheWildStripFixtures,
      ...seenOnGridFixtures,
      ...seenOnDescribedStates,
      ...platformMarkFixtures,
    ].map(({ label }) => label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('Seen on gallery fixtures — no network, no real video', () => {
  it('T-E2E-48 a playable card carries a LOCAL thumbnail and a stand-in id; nothing else has one', () => {
    for (const mention of allMentions()) {
      if (isPlayableInline(mention)) {
        expect(mention.thumbnailUrl, mention.id).toMatch(/^\/(?!\/)/);
        expect(mention.externalId, mention.id).toMatch(/^gallery\d{4}$/);
      } else {
        // ADR-0002 #33: what the data layer hands over for every link-out card.
        expect(mention.thumbnailUrl, mention.id).toBeNull();
      }
    }
  });

  it('T-E2E-48 every link is https and every date is fixed, parseable and older than a week', () => {
    const newestAllowed = Date.parse('2026-09-01T00:00:00.000Z');
    for (const mention of allMentions()) {
      expect(mention.url, mention.id).toMatch(/^https:\/\//);
      if (mention.creatorUrl !== null) expect(mention.creatorUrl).toMatch(/^https:\/\//);
      if (mention.publishedAt !== null) {
        const ms = Date.parse(mention.publishedAt);
        expect(Number.isNaN(ms), mention.publishedAt).toBe(false);
        expect(ms).toBeLessThan(newestAllowed);
      }
    }
  });

  it('T-E2E-48 one id is one mention (the grids key on it)', () => {
    const byId = new Map<string, MentionCardData>();
    for (const mention of allMentions()) {
      const seen = byId.get(mention.id);
      if (seen !== undefined) expect(seen).toBe(mention);
      byId.set(mention.id, mention);
    }
    for (const { props } of [...seenOnRowFixtures, ...seenOnGridFixtures]) {
      const ids = props.mentions.map(({ id }) => id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    for (const { props } of inTheWildStripFixtures) {
      const ids = props.featured.map(({ id }) => id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('Seen on gallery fixtures — every state is on show', () => {
  it('T-E2E-48 MentionCard specimens cover every 03 V-04 chip wording, within the PixelLabel guard', () => {
    const chips = mentionCardFixtures
      .map(({ props }) => props.mention)
      .filter((mention) => !isPlayableInline(mention))
      .map((mention) => linkOutChipLabel(mention.platform, mention.url));
    for (const chip of chips) expect(words(chip), chip).toBeLessThanOrEqual(PIXEL_LABEL_MAX_WORDS);
    expect(new Set(chips)).toEqual(
      new Set([
        'WATCH ON TIKTOK',
        'WATCH ON TWITCH',
        'SEE ON REDDIT',
        'READ ON MODNEWS.EXAMPLE',
        'READ ON THE SITE',
        'OPEN ↗',
        'WATCH ON YOUTUBE',
      ]),
    );
  });

  it('T-E2E-48 MentionCard specimens cover inline + link-out, both footers, and the bare card', () => {
    const cards = mentionCardFixtures.map(({ props }) => props);
    expect(cards.some(({ mention }) => isPlayableInline(mention))).toBe(true);
    expect(cards.some(({ mention }) => !isPlayableInline(mention))).toBe(true);
    // Footer strip: a project (TypeBadge + link) and a general mention (the ODSENS chip).
    expect(cards.some((c) => c.withProjectFooter === true && c.mention.project !== null)).toBe(
      true,
    );
    expect(cards.some((c) => c.withProjectFooter === true && c.mention.project === null)).toBe(
      true,
    );
    // No creator link, no views, no date — the meta line is not rendered.
    expect(
      cards.some(
        ({ mention }) =>
          mention.creatorUrl === null && mention.viewCount === null && mention.publishedAt === null,
      ),
    ).toBe(true);
    // Every platform of the enum appears at least once.
    expect(new Set(cards.map(({ mention }) => mention.platform))).toEqual(
      new Set(MENTION_PLATFORMS),
    );
  });

  it('T-UNIT-9 ReachLine specimens render one PixelLabel per segment, two words each at most', () => {
    const lines = reachLineFixtures.map(({ props }) => formatReachLine(props));
    for (const line of lines) {
      expect(line.segments.length).toBeGreaterThan(0);
      for (const segment of line.segments) expect(words(segment), segment).toBeLessThanOrEqual(2);
    }
    expect(lines.map(({ text }) => text)).toEqual([
      '1.2M VIEWS · 6 VIDEOS · 4 CREATORS',
      '999 VIEWS · 1 VIDEO · 1 CREATOR',
      '3 VIDEOS · 2 CREATORS',
      '1.5B VIEWS · 120 VIDEOS · 45 CREATORS',
    ]);
  });

  it('T-E2E-48 SeenOnRow shows the plural and the singular count; the strip shows 3-up and 4-up', () => {
    expect(seenOnRowFixtures.map(({ props }) => props.mentions.length).sort()).toEqual([1, 2]);
    expect(inTheWildStripFixtures.map(({ props }) => props.featured.length).sort()).toEqual([3, 4]);
    for (const { props } of inTheWildStripFixtures) {
      const line = formatReachLine(props.reach);
      for (const segment of line.segments) expect(words(segment)).toBeLessThanOrEqual(2);
    }
  });

  it('T-E2E-10 the SeenOnGrid specimen can reach "NOTHING HERE" through its own bar', () => {
    const [grid] = seenOnGridFixtures;
    expect(grid).toBeDefined();
    const mentions = grid?.props.mentions ?? [];

    // The bar: only platforms that have a mention, counts that add up to ALL.
    const platforms = platformCounts(mentions);
    expect(platforms.map(({ label, count }) => `${label} ${count}`)).toEqual([
      'YOUTUBE 2',
      'TIKTOK 1',
      'TWITCH 1',
    ]);
    expect(platforms.reduce((sum, { count }) => sum + count, 0)).toBe(mentions.length);

    // The select: projects with a mention A→Z, "About OddSense" last.
    expect(projectOptions(mentions)).toEqual([
      { value: 'metal-pipe-mace', label: 'Metal Pipe Mace' },
      { value: 'sprout-pack', label: 'Sprout Pack' },
      { value: 'odsens', label: 'About OddSense' },
    ]);

    // TIKTOK × Metal Pipe Mace — both offered by the bar, nothing matches (05 T-E2E-10's leg).
    expect(
      applyMentionFilters(mentions, { platform: 'tiktok', project: 'metal-pipe-mace' }),
    ).toEqual([]);
    // …while each filter alone still shows cards.
    expect(applyMentionFilters(mentions, { platform: 'tiktok', project: null })).toHaveLength(1);
    expect(
      applyMentionFilters(mentions, { platform: null, project: 'metal-pipe-mace' }),
    ).toHaveLength(2);
    expect(applyMentionFilters(mentions, { platform: null, project: 'odsens' })).toHaveLength(1);
  });

  it('T-E2E-48 PlatformMark specimens cover every mention platform and the odsens chip', () => {
    const shown = new Set<string>(platformMarkFixtures.map(({ props }) => props.platform));
    for (const platform of [...MENTION_PLATFORMS, 'odsens']) {
      expect(shown.has(platform), platform).toBe(true);
    }
    // The wordmark chip at both slab sizes.
    const chipSizes = platformMarkFixtures
      .filter(({ props }) => props.platform === 'odsens')
      .map(({ props }) => props.size ?? 26);
    expect(chipSizes.sort()).toEqual([24, 26]);
  });
});
