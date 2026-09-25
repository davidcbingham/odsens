/**
 * tests/unit/mentions.test.ts — `lib/mentions.ts`, the pure client-safe half of the mentions data
 * layer (S1.8; 03 §2.8 + V-04; 02 §2.1 item 3, §2.3 item 5, §2.6; ADR-0045), plus the pure
 * `adminMentionStatus` of `lib/data/admin.ts`. The S1.8 §8 row gives these helpers no id of their
 * own — each title carries the id of the test the helper backs: T-UNIT-9 (the totals the Reach
 * line prints), T-E2E-10 (`/seen-on`: chip wording, filter bar, project select, newest first,
 * filters), T-E2E-1 (Home IN THE WILD order), T-E2E-5 (the SEEN ON row), T-E2E-39 (the admin
 * table's worded status). Pure — no DB, no network, no clock (05 §1.1); `server-only` is mocked by
 * the unit setup file.
 */
import { describe, expect, it } from 'vitest';
import { adminMentionStatus } from '@/lib/data/admin';
import {
  GENERAL_PROJECT_VALUE,
  MENTION_PLATFORMS,
  applyMentionFilters,
  featuredMentions,
  isPlayableInline,
  linkOutChipLabel,
  mentionThumbnail,
  newestFirst,
  parseMentionFilters,
  platformCounts,
  platformLabel,
  projectMentions,
  projectOptions,
  reachTotals,
  type PublishedMention,
} from '@/lib/mentions';

const MACE = { slug: 'metal-pipe-mace', title: 'Metal Pipe Mace', type: 'mod' } as const;
const CHAMELEON = {
  slug: 'pixel-chameleon',
  title: 'pixel chameleon',
  type: 'resourcepack',
} as const;

let serial = 0;
function mention(overrides: Partial<PublishedMention> = {}): PublishedMention {
  serial += 1;
  return {
    id: `m${String(serial).padStart(4, '0')}`,
    platform: 'youtube',
    url: `https://www.youtube.com/watch?v=vid${String(serial).padStart(8, '0')}`,
    externalId: `vid${String(serial).padStart(8, '0')}`,
    title: `Mention ${serial}`,
    creatorName: `Creator ${serial}`,
    creatorUrl: null,
    thumbnailUrl: null,
    publishedAt: '2026-06-14T16:00:00.000Z',
    viewCount: null,
    project: null,
    featured: false,
    sortOrder: 0,
    createdAt: '2026-06-15T09:00:00.000Z',
    ...overrides,
  };
}

const ids = (list: readonly { id: string }[]): string[] => list.map((item) => item.id);

describe('T-E2E-10 platform words and the 03 V-04 link-out chip', () => {
  it('T-E2E-10 MENTION_PLATFORMS is the mention_platform enum in display order', () => {
    expect(MENTION_PLATFORMS).toEqual([
      'youtube',
      'tiktok',
      'twitch',
      'reddit',
      'article',
      'other',
    ]);
  });

  it.each([
    ['youtube', 'YouTube'],
    ['tiktok', 'TikTok'],
    ['twitch', 'Twitch'],
    ['reddit', 'Reddit'],
    ['article', 'Article'],
    ['other', 'Other'],
  ] as const)('T-E2E-10 platformLabel(%s) → %s', (platform, label) => {
    expect(platformLabel(platform)).toBe(label);
  });

  it.each([
    ['tiktok', 'https://www.tiktok.com/@seedtok/video/1', 'WATCH ON TIKTOK'],
    ['twitch', 'https://www.twitch.tv/videos/1', 'WATCH ON TWITCH'],
    ['reddit', 'https://www.reddit.com/r/feedthebeast/comments/1', 'SEE ON REDDIT'],
    ['other', 'https://example.test/thing', 'OPEN ↗'],
    ['youtube', 'https://www.youtube.com/@seedcreator', 'WATCH ON YOUTUBE'],
  ] as const)('T-E2E-10 linkOutChipLabel(%s) → %s (V-04)', (platform, url, label) => {
    expect(linkOutChipLabel(platform, url)).toBe(label);
  });

  it.each([
    ['https://www.pcgamer.com/a-story', 'READ ON PCGAMER.COM'],
    ['https://WWW.PCGamer.com/a-story', 'READ ON PCGAMER.COM'],
    ['https://sixteen-chars.io/x', 'READ ON SIXTEEN-CHARS.IO'],
    ['https://seventeenchars.io/x', 'READ ON THE SITE'],
    ['https://blog.example.test/post', 'READ ON THE SITE'],
    ['https://www.rockpapershotgun.com/x', 'READ ON THE SITE'],
    ['https://wwwexample.test/x', 'READ ON WWWEXAMPLE.TEST'],
    ['https://news.www.io/x', 'READ ON NEWS.WWW.IO'],
    ['https://example.test:8443/x?y=1#z', 'READ ON EXAMPLE.TEST'],
    ['not a url', 'READ ON THE SITE'],
    ['', 'READ ON THE SITE'],
    ['mailto:someone', 'READ ON THE SITE'],
  ])('T-E2E-10 linkOutChipLabel(article, %j) → %s (hostname − www., upper, ≤ 16)', (url, label) => {
    expect(linkOutChipLabel('article', url)).toBe(label);
  });

  it('T-E2E-10 every chip wording is at most four words (the PixelLabel 5-word guard)', () => {
    for (const platform of MENTION_PLATFORMS) {
      const words = linkOutChipLabel(platform, 'https://www.example.test/a b c').split(/\s+/);
      expect(words.length, platform).toBeLessThanOrEqual(4);
    }
  });
});

describe('T-E2E-5 inline play and the one thumbnail the UI may render', () => {
  it('T-E2E-5 a YouTube mention with an 11-char id plays inline; its thumbnail is the i.ytimg hqdefault literal', () => {
    const playable = { platform: 'youtube', externalId: 'seedvid0001' } as const;
    expect(isPlayableInline(playable)).toBe(true);
    expect(mentionThumbnail(playable)).toBe('https://i.ytimg.com/vi/seedvid0001/hqdefault.jpg');
  });

  it.each([
    ['youtube without an id', { platform: 'youtube', externalId: null }],
    ['youtube with a malformed id', { platform: 'youtube', externalId: '../../evil' }],
    ['youtube with an empty id', { platform: 'youtube', externalId: '' }],
    ['tiktok (even with an id)', { platform: 'tiktok', externalId: 'seedvid0001' }],
    ['article', { platform: 'article', externalId: null }],
  ] as const)('T-E2E-10 %s links out: not playable, no thumbnail (ADR-0002 #33)', (_label, m) => {
    expect(isPlayableInline(m)).toBe(false);
    expect(mentionThumbnail(m)).toBeNull();
  });
});

describe('T-UNIT-9 reachTotals (the numbers the Reach line and the /seen-on tiles print)', () => {
  it('T-UNIT-9 SEED-10: Σ views (null = 0), every mention counts as a video, distinct creators', () => {
    const list = [
      mention({ platform: 'youtube', creatorName: 'Seed Creator', viewCount: 1_200_000 }),
      mention({ platform: 'tiktok', creatorName: 'Seed Tok', viewCount: null }),
    ];
    expect(reachTotals(list)).toEqual({ views: 1_200_000, videos: 2, creators: 2 });
  });

  it('T-UNIT-9 creators are distinct by trimmed, case-insensitive name', () => {
    const list = [
      mention({ creatorName: 'BlockBuddy', viewCount: 10 }),
      mention({ creatorName: ' blockbuddy ', viewCount: 5 }),
      mention({ creatorName: 'BLOCKBUDDY', platform: 'article', viewCount: null }),
      mention({ creatorName: 'Someone Else', viewCount: 1 }),
    ];
    expect(reachTotals(list)).toEqual({ views: 16, videos: 4, creators: 2 });
  });

  it('T-UNIT-9 an empty list totals to zeros', () => {
    expect(reachTotals([])).toEqual({ views: 0, videos: 0, creators: 0 });
  });
});

describe('T-E2E-10 newestFirst', () => {
  it('T-E2E-10 publishedAt desc; undated mentions last, newest-added first among them; id breaks a tie', () => {
    const old = mention({ id: 'old', publishedAt: '2026-05-02T12:00:00.000Z' });
    const newer = mention({ id: 'newer', publishedAt: '2026-06-14T16:00:00.000Z' });
    const undatedEarly = mention({
      id: 'undated-early',
      publishedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const undatedLate = mention({
      id: 'undated-late',
      publishedAt: null,
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const twinB = mention({ id: 'twin-b', publishedAt: '2026-06-01T00:00:00.000Z' });
    const twinA = mention({ id: 'twin-a', publishedAt: '2026-06-01T00:00:00.000Z' });
    const garbled = mention({ id: 'garbled', publishedAt: 'not a date', createdAt: 'nor this' });

    const input = [undatedEarly, twinB, old, garbled, undatedLate, newer, twinA];
    const expected = [
      'newer',
      'twin-a',
      'twin-b',
      'old',
      'undated-late',
      'undated-early',
      'garbled',
    ];
    expect(ids(newestFirst(input))).toEqual(expected);
    // Deterministic: the answer never depends on the order it was handed.
    expect(ids(newestFirst([...input].reverse()))).toEqual(expected);
  });

  it('T-E2E-10 a tie on publishedAt falls to createdAt desc before id', () => {
    const first = mention({ id: 'z', createdAt: '2026-09-02T00:00:00.000Z' });
    const second = mention({ id: 'a', createdAt: '2026-09-01T00:00:00.000Z' });
    expect(ids(newestFirst([second, first]))).toEqual(['z', 'a']);
  });

  it('T-E2E-10 returns a copy — the input is never mutated', () => {
    const input = [
      mention({ id: 'b', publishedAt: '2026-01-01T00:00:00.000Z' }),
      mention({ id: 'a', publishedAt: '2026-02-01T00:00:00.000Z' }),
    ];
    const frozen = Object.freeze([...input]);
    expect(ids(newestFirst(frozen))).toEqual(['a', 'b']);
    expect(ids(frozen)).toEqual(['b', 'a']);
  });
});

describe('T-E2E-1 featuredMentions (Home IN THE WILD)', () => {
  it('T-E2E-1 featured only, by sortOrder ascending, at most four', () => {
    const list = [
      mention({ id: 'plain' }),
      mention({ id: 'f3', featured: true, sortOrder: 3 }),
      mention({ id: 'f1', featured: true, sortOrder: 1 }),
      mention({ id: 'f5', featured: true, sortOrder: 5 }),
      mention({ id: 'f2', featured: true, sortOrder: 2 }),
      mention({ id: 'f4', featured: true, sortOrder: 4 }),
    ];
    expect(ids(featuredMentions(list))).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(ids(featuredMentions(list, 2))).toEqual(['f1', 'f2']);
    expect(ids(featuredMentions(list, 99))).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
  });

  it('T-E2E-1 equal sortOrder falls to newest first', () => {
    const list = [
      mention({ id: 'older', featured: true, publishedAt: '2026-01-01T00:00:00.000Z' }),
      mention({ id: 'newer', featured: true, publishedAt: '2026-02-01T00:00:00.000Z' }),
    ];
    expect(ids(featuredMentions(list))).toEqual(['newer', 'older']);
  });

  it('T-E2E-1 nothing featured → [] (the strip is not rendered); a silly max floors to none', () => {
    const list = [mention(), mention()];
    expect(featuredMentions(list)).toEqual([]);
    const featured = [mention({ featured: true })];
    expect(featuredMentions(featured, 0)).toEqual([]);
    expect(featuredMentions(featured, -3)).toEqual([]);
    expect(featuredMentions(featured, Number.NaN)).toEqual([]);
    expect(featuredMentions(featured, 1.9)).toHaveLength(1);
  });
});

describe('T-E2E-5 projectMentions (the SEEN ON row)', () => {
  it('T-E2E-5 only that slug, featured first, then newest; general mentions never match', () => {
    const list = [
      mention({ id: 'mace-old', project: MACE, publishedAt: '2026-01-01T00:00:00.000Z' }),
      mention({ id: 'mace-new', project: MACE, publishedAt: '2026-08-01T00:00:00.000Z' }),
      mention({
        id: 'mace-featured',
        project: MACE,
        featured: true,
        publishedAt: '2025-01-01T00:00:00.000Z',
      }),
      mention({ id: 'chameleon', project: CHAMELEON }),
      mention({ id: 'general', project: null }),
    ];
    expect(ids(projectMentions(list, 'metal-pipe-mace'))).toEqual([
      'mace-featured',
      'mace-new',
      'mace-old',
    ]);
    expect(ids(projectMentions(list, 'pixel-chameleon'))).toEqual(['chameleon']);
  });

  it('T-E2E-3 a project with no mentions → [] (the row is not rendered); "odsens" is not a slug', () => {
    const list = [mention({ project: MACE }), mention({ project: null })];
    expect(projectMentions(list, 'seed-exclusive-pack')).toEqual([]);
    expect(projectMentions(list, GENERAL_PROJECT_VALUE)).toEqual([]);
  });
});

describe('T-E2E-10 platformCounts (the FilterBar platform group)', () => {
  it('T-E2E-10 SEED-10 → YOUTUBE 1 · TIKTOK 1: only platforms present, uppercase in source', () => {
    const list = [mention({ platform: 'tiktok' }), mention({ platform: 'youtube' })];
    expect(platformCounts(list)).toEqual([
      { value: 'youtube', label: 'YOUTUBE', count: 1 },
      { value: 'tiktok', label: 'TIKTOK', count: 1 },
    ]);
  });

  it('T-E2E-10 MENTION_PLATFORMS order whatever the list order; counts add up to the list (ALL)', () => {
    const list = [
      mention({ platform: 'other' }),
      mention({ platform: 'article' }),
      mention({ platform: 'reddit' }),
      mention({ platform: 'article' }),
      mention({ platform: 'twitch' }),
      mention({ platform: 'youtube' }),
      mention({ platform: 'article' }),
    ];
    const counts = platformCounts(list);
    expect(counts.map((option) => `${option.label} ${option.count}`)).toEqual([
      'YOUTUBE 1',
      'TWITCH 1',
      'REDDIT 1',
      'ARTICLE 3',
      'OTHER 1',
    ]);
    expect(counts.reduce((sum, option) => sum + option.count, 0)).toBe(list.length);
    expect(platformCounts([])).toEqual([]);
  });
});

describe('T-E2E-10 projectOptions (the project Select)', () => {
  it('T-E2E-10 projects with ≥ 1 mention by title A→Z (case-insensitive), then About OddSense last', () => {
    const list = [
      mention({ project: CHAMELEON }),
      mention({ project: null }),
      mention({ project: MACE }),
      mention({ project: MACE }),
    ];
    expect(projectOptions(list)).toEqual([
      { value: 'metal-pipe-mace', label: 'Metal Pipe Mace' },
      { value: 'pixel-chameleon', label: 'pixel chameleon' },
      { value: 'odsens', label: 'About OddSense' },
    ]);
  });

  it('T-E2E-10 no general mention → no About OddSense option; equal titles order by slug', () => {
    const list = [
      mention({ project: { slug: 'twin-b', title: 'Twin', type: 'mod' } }),
      mention({ project: { slug: 'twin-a', title: 'twin', type: 'plugin' } }),
    ];
    expect(projectOptions(list)).toEqual([
      { value: 'twin-a', label: 'twin' },
      { value: 'twin-b', label: 'Twin' },
    ]);
  });

  it('T-E2E-10 only general mentions → just About OddSense; nothing → []', () => {
    expect(projectOptions([mention({ project: null })])).toEqual([
      { value: GENERAL_PROJECT_VALUE, label: 'About OddSense' },
    ]);
    expect(projectOptions([])).toEqual([]);
  });
});

describe('T-E2E-10 parseMentionFilters', () => {
  const parse = (query: string, known?: readonly string[]) =>
    parseMentionFilters(new URLSearchParams(query), known);

  it('T-E2E-10 no params → no filters', () => {
    expect(parse('')).toEqual({ platform: null, project: null });
  });

  it.each(MENTION_PLATFORMS.map((platform) => [platform]))(
    'T-E2E-10 ?platform=%s is kept',
    (platform) => {
      expect(parse(`platform=${platform}`)).toEqual({ platform, project: null });
    },
  );

  it.each(['YouTube', 'vimeo', '', ' youtube', 'youtube,tiktok', 'odsens'])(
    'T-E2E-10 unknown ?platform=%j falls away silently',
    (value) => {
      expect(parse(`platform=${encodeURIComponent(value)}`).platform).toBeNull();
    },
  );

  it('T-E2E-10 ?project= is a slug or the literal odsens; trimmed; empty / over-long → null', () => {
    expect(parse('project=metal-pipe-mace').project).toBe('metal-pipe-mace');
    expect(parse('project=odsens').project).toBe(GENERAL_PROJECT_VALUE);
    expect(parse('project=%20metal-pipe-mace%20').project).toBe('metal-pipe-mace');
    expect(parse('project=').project).toBeNull();
    expect(parse('project=%20%20').project).toBeNull();
    expect(parse(`project=${'x'.repeat(65)}`).project).toBeNull();
    expect(parse(`project=${'x'.repeat(64)}`).project).toBe('x'.repeat(64));
  });

  it('T-E2E-10 with the select values in hand, a project the select does not offer falls away', () => {
    const known = ['metal-pipe-mace', 'odsens'];
    expect(parse('project=metal-pipe-mace', known).project).toBe('metal-pipe-mace');
    expect(parse('project=odsens', known).project).toBe('odsens');
    expect(parse('project=pixel-chameleon', known).project).toBeNull();
    expect(parse('project=pixel-chameleon').project).toBe('pixel-chameleon');
  });

  it('T-E2E-10 both keys together; the first of a repeated key wins; other keys are ignored', () => {
    expect(parse('platform=tiktok&project=metal-pipe-mace&page=2&platform=youtube')).toEqual({
      platform: 'tiktok',
      project: 'metal-pipe-mace',
    });
  });
});

describe('T-E2E-10 applyMentionFilters', () => {
  const youtubeMace = mention({ id: 'yt-mace', platform: 'youtube', project: MACE });
  const tiktokGeneral = mention({ id: 'tt-general', platform: 'tiktok', project: null });
  const articleChameleon = mention({ id: 'ar-chameleon', platform: 'article', project: CHAMELEON });
  const youtubeGeneral = mention({ id: 'yt-general', platform: 'youtube', project: null });
  const list = [youtubeMace, tiktokGeneral, articleChameleon, youtubeGeneral];

  it('T-E2E-10 no filters → everything, order kept', () => {
    expect(ids(applyMentionFilters(list, { platform: null, project: null }))).toEqual(ids(list));
  });

  it('T-E2E-10 platform alone', () => {
    expect(ids(applyMentionFilters(list, { platform: 'youtube', project: null }))).toEqual([
      'yt-mace',
      'yt-general',
    ]);
  });

  it('T-E2E-10 project slug alone; odsens = the general mentions', () => {
    expect(ids(applyMentionFilters(list, { platform: null, project: 'metal-pipe-mace' }))).toEqual([
      'yt-mace',
    ]);
    expect(ids(applyMentionFilters(list, { platform: null, project: 'odsens' }))).toEqual([
      'tt-general',
      'yt-general',
    ]);
  });

  it('T-E2E-10 both keys AND together; TIKTOK × Metal Pipe Mace is the empty arm (NOTHING HERE)', () => {
    expect(ids(applyMentionFilters(list, { platform: 'youtube', project: 'odsens' }))).toEqual([
      'yt-general',
    ]);
    expect(applyMentionFilters(list, { platform: 'tiktok', project: 'metal-pipe-mace' })).toEqual(
      [],
    );
    expect(applyMentionFilters(list, { platform: null, project: 'no-such-project' })).toEqual([]);
  });

  it('T-E2E-10 keeps the row type and never mutates the input', () => {
    const frozen = Object.freeze([...list]);
    const shown: PublishedMention[] = applyMentionFilters(frozen, {
      platform: 'article',
      project: null,
    });
    expect(shown).toEqual([articleChameleon]);
    expect(ids(frozen)).toEqual(ids(list));
  });
});

describe('T-E2E-39 adminMentionStatus (the /admin/mentions worded pill)', () => {
  it.each([
    ['published', true, 'featured'],
    ['published', false, 'live'],
    ['hidden', false, 'hidden'],
    ['hidden', true, 'hidden'],
    ['draft', false, 'draft'],
    ['draft', true, 'draft'],
    ['suggested', false, 'suggested'],
  ] as const)('T-E2E-39 status %s, featured %s → %s', (status, featured, pill) => {
    expect(adminMentionStatus(status, featured)).toBe(pill);
  });
});
