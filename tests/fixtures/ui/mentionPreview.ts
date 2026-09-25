/**
 * tests/fixtures/ui/mentionPreview.ts — `MentionPreview` states for `/dev/components` (03 §2.8
 * `MentionPreview`; 03 §3 `empty | preview | error | manual`; ADR-0045; T-E2E-48). The 03 props are
 * the island's INITIAL state, so every state renders statically: `preview` alone → the card,
 * `error` → the line + the manual fields, `manual` → the fields (seeded from `preview` when given),
 * neither → the empty slot. `readOnly` is the moderator view (03 §2.10: every control rendered
 * disabled under `title="Admin only"`, never hidden, no `<form>`).
 *
 * No DB. Pending / field-error / conflict are interaction-only states (the `SyncStatus`
 * precedent): "Fetch" and PUBLISH call the real `fetchMentionPreview` / `createMention`, which
 * answer a signed-out gallery visitor with their inline error. Network: the non-YouTube fixtures
 * render the `PlatformMark` well — no image at all (ADR-0002 #33). The ONE YouTube card builds its
 * thumbnail from the id (`mentionThumbnail` → `i.ytimg.com`, the only host the island ever
 * renders); `gallery0001` is an 11-char stand-in that exists nowhere (the `videos.ts` fixture id),
 * so the well shows its `--ink` ground — the same empty well the pass-3 artboard draws. Dates are
 * fixed. Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard). Sample names are the artboard's
 * mock data, never seeded.
 */
import type { MentionPreviewProps } from '@/components/seen-on/MentionPreview';
import type { MentionPreviewData } from '@/lib/actions/mentions.schema';

export type MentionPreviewFixture = { label: string; props: MentionPreviewProps };

const projects: MentionPreviewProps['projects'] = [
  { id: '00000000-0000-4000-8000-000000000903', title: 'Duck Crosshair' },
  { id: '00000000-0000-4000-8000-000000000902', title: 'Heavy Spear' },
  { id: '00000000-0000-4000-8000-000000000901', title: 'Metal Pipe Mace' },
];

/** `source: 'data_api'` — everything the card can show (04 §1.6 return shape, ten keys). */
const youtube: MentionPreviewData = {
  platform: 'youtube',
  external_id: 'gallery0001',
  canonical_url: 'https://www.youtube.com/watch?v=gallery0001',
  title: 'PixelPete tried the pipe mace',
  creator_name: 'PixelPete',
  creator_url: 'https://www.youtube.com/@pixelpete',
  thumbnail_url: 'https://i.ytimg.com/vi/gallery0001/hqdefault.jpg',
  published_at: '2026-05-14T16:00:00.000Z',
  view_count: 212_000,
  source: 'data_api',
};

/** Open Graph only: no views, no date, and a thumbnail the island never renders. */
const tiktok: MentionPreviewData = {
  platform: 'tiktok',
  external_id: null,
  canonical_url: 'https://www.tiktok.com/@beelo/video/7300000000000000001',
  title: 'this mod makes no sense and I love it',
  creator_name: 'beelo',
  creator_url: 'https://www.tiktok.com/@beelo',
  thumbnail_url: 'https://p16.example.test/never-rendered.jpg',
  published_at: null,
  view_count: null,
  source: 'og',
};

export const mentionPreviewFixtures: MentionPreviewFixture[] = [
  { label: 'MentionPreview · empty', props: { preview: null, projects } },
  { label: 'MentionPreview · preview', props: { preview: youtube, projects } },
  { label: 'MentionPreview · preview, no image', props: { preview: tiktok, projects } },
  {
    label: 'MentionPreview · error',
    props: {
      preview: null,
      error: "Couldn't read that page. You can fill the fields by hand.",
      projects,
    },
  },
  { label: 'MentionPreview · manual', props: { preview: youtube, manual: true, projects } },
  { label: 'MentionPreview · moderator', props: { preview: null, projects, readOnly: true } },
];
