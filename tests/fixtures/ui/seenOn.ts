/**
 * tests/fixtures/ui/seenOn.ts — S1.8 Seen on components for `/dev/components` (03 §2.8
 * `MentionCard` / `ReachLine` / `SeenOnRow` / `InTheWildStrip` + the `SeenOnGrid` island,
 * ADR-0045; 03 §3 `MentionCard` `idle | playing`; 03 V-04 chip wording; T-E2E-48).
 *
 * The gallery never frames YouTube (01 INV-57 — the `videos.ts` convention, ADR-0014 live-state
 * exception): every playable card here is `idle`, and `playing` is a labelled static description
 * (`seenOnDescribedStates`), as are the three "renders nothing" states — a specimen cannot show
 * an absence. Playable cards carry the local brand image as their thumbnail (no network) and
 * 11-char stand-in ids that exist nowhere; every other card has `thumbnailUrl: null`, exactly as
 * the data layer hands it over (ADR-0002 #33 — a non-YouTube thumbnail is never rendered). Links
 * point at `.example` hosts and the platforms' own domains with made-up handles. Dates are fixed
 * and older than a week, so `relativeTime` prints the absolute form and no screenshot depends on
 * the clock. No real creator is named (no PII — handles are invented).
 *
 * `tests/unit/seen-on-fixtures.test.ts` holds these to the rules above, and to the `PixelLabel`
 * five-word guard, which only throws under `pnpm dev`.
 * Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard).
 */
import type { InTheWildStripProps } from '@/components/seen-on/InTheWildStrip';
import type { MentionCardProps } from '@/components/seen-on/MentionCard';
import type { ReachLineProps } from '@/components/seen-on/ReachLine';
import type { SeenOnGridProps } from '@/components/seen-on/SeenOnGrid';
import type { SeenOnRowProps } from '@/components/seen-on/SeenOnRow';
import type { MentionCardData } from '@/lib/mentions';

export type MentionCardFixture = { label: string; props: MentionCardProps };
export type ReachLineFixture = { label: string; props: ReachLineProps };
export type SeenOnRowFixture = { label: string; props: SeenOnRowProps };
export type InTheWildStripFixture = { label: string; props: InTheWildStripProps };
export type SeenOnGridFixture = { label: string; props: SeenOnGridProps };
/** A state the gallery describes instead of rendering (`name` = the specimen's component). */
export type SeenOnDescribedState = { name: string; label: string; note: string };

const THUMB = '/brand/og-default.png';

const MACE = { slug: 'metal-pipe-mace', title: 'Metal Pipe Mace', type: 'mod' } as const;
const SPROUTS = { slug: 'sprout-pack', title: 'Sprout Pack', type: 'resourcepack' } as const;

function mention(n: number, overrides: Partial<MentionCardData> = {}): MentionCardData {
  return {
    id: `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`,
    platform: 'youtube',
    url: `https://www.youtube.com/watch?v=gallery${String(n).padStart(4, '0')}`,
    externalId: `gallery${String(n).padStart(4, '0')}`,
    title: `Gallery mention ${n}`,
    creatorName: `GalleryCreator${n}`,
    creatorUrl: `https://www.youtube.com/@gallerycreator${n}`,
    thumbnailUrl: THUMB,
    publishedAt: `2026-08-${String(n).padStart(2, '0')}T12:00:00.000Z`,
    viewCount: 212000,
    project: MACE,
    ...overrides,
  };
}

/** Everything that is not a playable YouTube mention links out and has no thumbnail. */
function linkOut(n: number, overrides: Partial<MentionCardData>): MentionCardData {
  return mention(n, { externalId: null, thumbnailUrl: null, ...overrides });
}

const YOUTUBE = mention(20, {
  title: 'Metal Pipe Mace is the loudest mod I have ever installed',
  creatorName: 'GalleryPatch',
  viewCount: 1200000,
});

const YOUTUBE_PACK = mention(18, {
  title: 'Every texture in Sprout Pack, ranked by how round it is',
  creatorName: 'galleryround',
  viewCount: 44000,
  project: SPROUTS,
});

const TIKTOK_GENERAL = linkOut(16, {
  platform: 'tiktok',
  url: 'https://www.tiktok.com/@gallerytok/video/1',
  title: 'this mod makes no sense and I love it',
  creatorName: 'gallerytok',
  creatorUrl: 'https://www.tiktok.com/@gallerytok',
  viewCount: null,
  project: null,
});

const TWITCH = linkOut(14, {
  platform: 'twitch',
  url: 'https://www.twitch.tv/videos/1000000001',
  title: 'Modded Monday: the pipe goes bonk for three hours',
  creatorName: 'gallerystream',
  creatorUrl: 'https://www.twitch.tv/gallerystream',
  viewCount: 2000,
});

const REDDIT = linkOut(12, {
  platform: 'reddit',
  url: 'https://www.reddit.com/r/gallerymods/comments/abc123/found_this/',
  title: 'Found this while looking for something sensible',
  creatorName: 'r/gallerymods',
  creatorUrl: 'https://www.reddit.com/r/gallerymods/',
  viewCount: null,
});

const ARTICLE = linkOut(10, {
  platform: 'article',
  url: 'https://www.modnews.example/2026/08/ten-odd-mods',
  title: 'Ten odd mods that should not work and do',
  creatorName: 'Mod News',
  creatorUrl: 'https://www.modnews.example/',
  viewCount: null,
  project: null,
});

/** A host past 16 characters → `READ ON THE SITE` (03 V-04). */
const ARTICLE_LONG_HOST = linkOut(8, {
  platform: 'article',
  url: 'https://the-very-long-minecraft-gazette.example/odd-mods',
  title: 'The Gazette reviews the pipe',
  creatorName: 'The Very Long Minecraft Gazette',
  creatorUrl: null,
  viewCount: null,
});

const OTHER = linkOut(6, {
  platform: 'other',
  url: 'https://forum.example/t/odd-mods/42',
  title: 'A forum thread about the mace',
  creatorName: 'forum.example',
  creatorUrl: null,
  viewCount: 312,
});

/** A YouTube mention saved without a video id degrades to a link-out card (ADR-0045 D16). */
const YOUTUBE_NO_ID = linkOut(4, {
  platform: 'youtube',
  url: 'https://www.youtube.com/playlist?list=PLgallery',
  title: 'A playlist, so there is nothing to play in place',
  creatorName: 'GalleryPatch',
});

/** Name only: no creator link, no view count, no date — the meta line is not rendered at all. */
const NAME_ONLY = linkOut(2, {
  platform: 'tiktok',
  url: 'https://www.tiktok.com/@quietone/video/2',
  title: 'No link, no views, no date',
  creatorName: 'quietone',
  creatorUrl: null,
  viewCount: null,
  publishedAt: null,
});

const LONG_STRINGS = mention(1, {
  title:
    'The one with the really long title that has to wrap onto two lines and then stop before a third',
  creatorName: 'AVeryLongCreatorChannelNameThatNeverBreaksAnywhere',
  viewCount: 1,
  project: {
    slug: 'a-project-with-a-long-title',
    title: 'A project title long enough to need its ellipsis in the footer strip',
    type: 'datapack',
  },
});

export const mentionCardFixtures: MentionCardFixture[] = [
  { label: 'MentionCard · youtube idle', props: { mention: YOUTUBE } },
  {
    label: 'MentionCard · youtube project footer',
    props: { mention: YOUTUBE_PACK, withProjectFooter: true },
  },
  {
    label: 'MentionCard · tiktok odsens chip',
    props: { mention: TIKTOK_GENERAL, withProjectFooter: true },
  },
  { label: 'MentionCard · twitch link-out', props: { mention: TWITCH } },
  { label: 'MentionCard · reddit link-out', props: { mention: REDDIT } },
  { label: 'MentionCard · article site', props: { mention: ARTICLE, withProjectFooter: true } },
  { label: 'MentionCard · article long host', props: { mention: ARTICLE_LONG_HOST } },
  { label: 'MentionCard · other open', props: { mention: OTHER } },
  { label: 'MentionCard · youtube no id', props: { mention: YOUTUBE_NO_ID } },
  { label: 'MentionCard · name only', props: { mention: NAME_ONLY } },
  {
    label: 'MentionCard · long strings',
    props: { mention: LONG_STRINGS, withProjectFooter: true },
  },
];

export const reachLineFixtures: ReachLineFixture[] = [
  { label: 'ReachLine · millions', props: { views: 1200000, videos: 6, creators: 4 } },
  { label: 'ReachLine · singulars', props: { views: 999, videos: 1, creators: 1 } },
  { label: 'ReachLine · no views', props: { views: 0, videos: 3, creators: 2 } },
  { label: 'ReachLine · billions', props: { views: 1500000000, videos: 120, creators: 45 } },
];

export const seenOnRowFixtures: SeenOnRowFixture[] = [
  { label: 'SeenOnRow · two mentions', props: { mentions: [YOUTUBE, TWITCH] } },
  { label: 'SeenOnRow · one mention', props: { mentions: [YOUTUBE] } },
];

/** Totals over a whole published list — never the featured subset (02 §2.1 item 3). */
const REACH = { views: 1458313, videos: 9, creators: 8 };

export const inTheWildStripFixtures: InTheWildStripFixture[] = [
  {
    label: 'InTheWildStrip · three featured',
    props: { featured: [YOUTUBE, TIKTOK_GENERAL, TWITCH], reach: REACH },
  },
  {
    label: 'InTheWildStrip · four featured',
    props: { featured: [YOUTUBE, YOUTUBE_PACK, REDDIT, ARTICLE], reach: REACH },
  },
];

/**
 * Newest first, as the reader hands it over. Three platforms get a button (`YOUTUBE 2 · TIKTOK 1 ·
 * TWITCH 1`), two projects + "About OddSense" fill the select, and TIKTOK × Metal Pipe Mace
 * matches nothing — the "NOTHING HERE" state is one click and one pick away (05 T-E2E-10's leg).
 */
const GRID: MentionCardData[] = [YOUTUBE, YOUTUBE_PACK, TIKTOK_GENERAL, TWITCH];

export const seenOnGridFixtures: SeenOnGridFixture[] = [
  { label: 'SeenOnGrid · filters in URL', props: { mentions: GRID } },
];

/** 03 §3 / §2.8 states the gallery describes instead of rendering. */
export const seenOnDescribedStates: SeenOnDescribedState[] = [
  {
    name: 'MentionCard',
    label: 'MentionCard · playing',
    note: 'After the click: the privacy-enhanced YouTube frame replaces the thumbnail inside the same fixed box, the card takes the indigo outline and "on YouTube ↗" appears at the end of the creator row. Playing another video anywhere on the page returns this card to idle. Only on a real page — this gallery never frames YouTube.',
  },
  {
    name: 'SeenOnRow',
    label: 'SeenOnRow · no mentions',
    note: 'Renders nothing: a project with no mentions has no SEEN ON heading, no section and no empty state.',
  },
  {
    name: 'InTheWildStrip',
    label: 'InTheWildStrip · none featured',
    note: 'Renders nothing: Home has no IN THE WILD strip until a mention is featured.',
  },
  {
    name: 'ReachLine',
    label: 'ReachLine · nothing yet',
    note: 'Renders nothing when there are no mentions at all.',
  },
];
