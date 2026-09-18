/**
 * tests/fixtures/ui/videos.ts — S1.6 Videos components for `/dev/components` (03 §2.6
 * `VideoFacade` / `UpNextList` / `ShortsRow` / `VideoCard` / `VideoStage`; 03 §3 `VideoFacade`
 * `idle | loading | playing`; T-E2E-48).
 *
 * The gallery never frames YouTube (01 INV-57: the iframe exists only after a visitor's click on a
 * real page — the `KofiPanelSlot` idle-only precedent, ADR-0014 live-state exception): every
 * facade here is `idle`, and `loading` / `playing` are labelled static descriptions
 * (`videoFacadeLiveStates`). The `upnext` (132px) and `short` (104px) variants are shown at their
 * real widths inside the `UpNextList` and `ShortsRow` specimens. Thumbnails are the local brand
 * image (no network); ids are 11-char stand-ins that exist nowhere. Dates are fixed and older than
 * a week, so `relativeTime` prints the absolute form and no screenshot depends on the clock.
 * Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard).
 */
import type { ShortsRowProps } from '@/components/videos/ShortsRow';
import type { UpNextListProps } from '@/components/videos/UpNextList';
import type { VideoCardProps } from '@/components/videos/VideoCard';
import type { VideoFacadeProps } from '@/components/videos/VideoFacade';
import type { VideoStageProps } from '@/components/videos/VideoStage';
import type { VideoStageItem } from '@/lib/videos';

export type VideoFacadeFixture = { label: string; props: VideoFacadeProps };
export type VideoFacadeLiveState = { label: string; note: string };
export type UpNextListFixture = { label: string; props: UpNextListProps };
export type ShortsRowFixture = { label: string; props: ShortsRowProps };
export type VideoCardFixture = { label: string; props: VideoCardProps };
export type VideoStageFixture = { label: string; props: VideoStageProps };

const THUMB = '/brand/og-default.png';

function video(n: number, overrides: Partial<VideoStageItem> = {}): VideoStageItem {
  return {
    id: `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`,
    youtubeId: `gallery${String(n).padStart(4, '0')}`,
    title: `Gallery video ${n}`,
    thumbnailUrl: THUMB,
    durationSeconds: 724,
    publishedAt: `2026-08-${String(10 + n).padStart(2, '0')}T12:00:00.000Z`,
    viewCount: 8200,
    isShort: false,
    blurb: 'A very small chameleon, a very large problem.',
    ...overrides,
  };
}

const LONG: VideoStageItem[] = [
  video(1, { title: 'I gave the mace a metal pipe sound', viewCount: 12345, durationSeconds: 600 }),
  video(2),
  video(3, {
    title: 'The one with the really long title that has to wrap onto two lines and then stop',
    durationSeconds: 3723,
    blurb: null,
  }),
  // Degraded row (04 §3.3, no API key): no duration chip, date-only meta.
  video(4, { title: 'RSS-only row', durationSeconds: null, viewCount: null, blurb: null }),
  video(5, { title: 'Sixty-one seconds', durationSeconds: 61 }),
];

const SHORTS: VideoStageItem[] = [
  video(11, { title: 'Pipe bonk', durationSeconds: 45, isShort: true }),
  video(12, { title: 'Chameleon blink', durationSeconds: 31, isShort: true }),
  video(13, { title: 'No length yet', durationSeconds: null, isShort: true }),
];

const [FIRST, SECOND, WRAPS, DEGRADED] = LONG as [
  VideoStageItem,
  VideoStageItem,
  VideoStageItem,
  VideoStageItem,
  VideoStageItem,
];

function facade(item: VideoStageItem, variant: VideoFacadeProps['variant']): VideoFacadeProps {
  return {
    youtubeId: item.youtubeId,
    title: item.title,
    thumbnailUrl: item.thumbnailUrl,
    durationSeconds: item.durationSeconds,
    variant,
  };
}

export const videoFacadeFixtures: VideoFacadeFixture[] = [
  { label: 'VideoFacade · idle hero', props: facade(FIRST, 'hero') },
  { label: 'VideoFacade · idle card', props: facade(SECOND, 'card') },
  { label: 'VideoFacade · idle mention', props: facade(SECOND, 'mention') },
  { label: 'VideoFacade · no duration', props: facade(DEGRADED, 'card') },
];

/** 03 §3 states that need a live YouTube frame — described, never rendered (01 INV-57). */
export const videoFacadeLiveStates: VideoFacadeLiveState[] = [
  {
    label: 'VideoFacade · loading',
    note: 'After the click: the privacy-enhanced YouTube frame is mounted over the thumbnail, inside the same fixed box. Focus moves to the frame. Only on a real page — this gallery never frames YouTube.',
  },
  {
    label: 'VideoFacade · playing',
    note: 'The frame has loaded and replaces the thumbnail; any other facade on the page goes back to idle (one player at a time). Only on a real page.',
  },
];

export const upNextListFixtures: UpNextListFixture[] = [
  {
    label: 'UpNextList · second row selected',
    props: { videos: LONG.slice(0, 4), selectedId: SECOND.youtubeId },
  },
];

export const shortsRowFixtures: ShortsRowFixture[] = [
  { label: 'ShortsRow · three shorts', props: { shorts: SHORTS } },
];

export const videoCardFixtures: VideoCardFixture[] = [
  { label: 'VideoCard · grid', props: { video: FIRST, variant: 'grid' } },
  { label: 'VideoCard · home', props: { video: SECOND, variant: 'home' } },
  { label: 'VideoCard · two-line title', props: { video: WRAPS, variant: 'grid' } },
  { label: 'VideoCard · date only', props: { video: DEGRADED, variant: 'grid' } },
];

export const videoStageFixtures: VideoStageFixture[] = [
  { label: 'VideoStage · newest selected', props: { videos: LONG } },
];
