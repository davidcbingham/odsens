/**
 * tests/fixtures/ui/skinsArt.ts — S1.7 Skins + Art components for `/dev/components` (03 §2.7
 * `SkinCard` + the `SkinsStage` island; the art half is appended by the art build after the
 * marker at the end of this file; 03 §3 `SkinCard` states; T-E2E-48).
 *
 * The gallery is "no DB, no network" (03 §7) — with the one local exception the `SkinViewer3D`
 * fixture set (`skinViewer3d.ts`): every texture and bust here is a LOCAL Supabase public object
 * that SEED-13 uploads in `globalSetup.db.ts` (`tests/e2e/fixtures.ts` leaves local Supabase URLs
 * real), so the specimens exercise the true path — `next/image` optimising a Storage object,
 * skinview3d fetching the texture — against `127.0.0.1`, never a third-party host. The seed
 * "bust" of `…0601` is the 1280×720 fixture, so the 3:4 slot shows it cropped (`object-fit:
 * cover`) — the SHAPE of the slot is what the specimen is for.
 *
 * `no bust` is the one specimen that opens a WebGL context (a paused single frame — ADR-0048 D14 / D15). The
 * `SkinsStageView` specimen gives both of its skins a bust so it adds one stage context only.
 * The page-level empty state (§11.7 "NO SKINS YET") is described, not rendered: the island is not
 * mounted when there is nothing to show (the Seen on "renders nothing" precedent).
 *
 * Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard).
 */
import type { SkinCardProps } from '@/components/skins-art/SkinCard';
import type { SkinsStageViewProps } from '@/components/skins-art/SkinsStage';
import type { SkinStageItem } from '@/lib/skins';

export type SkinCardFixture = {
  label: string;
  props: SkinCardProps;
  /** Printed above the specimen when the state needs a word of explanation. */
  note?: string;
};
export type SkinsStageFixture = { label: string; props: SkinsStageViewProps; note?: string };
/** A state the gallery describes instead of rendering (`name` = the specimen's component). */
export type SkinsDescribedState = { name: string; label: string; note: string };

/** SEED-7 / SEED-13 objects in the local `skins` bucket (05 §3). */
const SKINS_PUBLIC = 'http://127.0.0.1:54321/storage/v1/object/public/skins';
const SEED_SKIN_A = '00000000-0000-4000-8000-000000000601';
const SEED_SKIN_B = '00000000-0000-4000-8000-000000000602';
const SEED_SKIN_A_TEXTURE = `${SKINS_PUBLIC}/${SEED_SKIN_A}/texture.png`;
const SEED_SKIN_A_BUST = `${SKINS_PUBLIC}/${SEED_SKIN_A}/bust.png`;
const SEED_SKIN_B_TEXTURE = `${SKINS_PUBLIC}/${SEED_SKIN_B}/texture.png`;

const CARD_A: SkinCardProps['skin'] = {
  slug: 'gallery-skin-a',
  name: 'Gallery Skin A',
  model: 'classic',
  textureUrl: SEED_SKIN_A_TEXTURE,
  bustUrl: SEED_SKIN_A_BUST,
  exclusive: false,
};

const CARD_EXCLUSIVE: SkinCardProps['skin'] = {
  slug: 'gallery-skin-b',
  name: 'Gallery Skin B',
  model: 'slim',
  textureUrl: SEED_SKIN_B_TEXTURE,
  bustUrl: SEED_SKIN_A_BUST,
  exclusive: true,
};

/** `render_bust_path NULL`: the slot renders the live 3D bust (ADR-0048 D14 / D15). */
const CARD_LIVE: SkinCardProps['skin'] = {
  slug: 'gallery-skin-live',
  name: 'Gallery Skin Live',
  model: 'slim',
  textureUrl: SEED_SKIN_B_TEXTURE,
  bustUrl: null,
  exclusive: false,
};

/** A long name: the card name wraps to two lines and stops. */
const CARD_LONG: SkinCardProps['skin'] = {
  slug: 'gallery-skin-long',
  name: 'The Skin With The Really Long Name That Wraps',
  model: 'classic',
  textureUrl: SEED_SKIN_A_TEXTURE,
  bustUrl: SEED_SKIN_A_BUST,
  exclusive: false,
};

const hrefFor = (slug: string): string => `?skin=${slug}`;

export const skinCardFixtures: SkinCardFixture[] = [
  {
    label: 'SkinCard · rest',
    props: { skin: CARD_A, selected: false, href: hrefFor(CARD_A.slug) },
  },
  {
    label: 'SkinCard · selected',
    props: { skin: CARD_A, selected: true, href: hrefFor(CARD_A.slug) },
  },
  {
    label: 'SkinCard · exclusive',
    props: { skin: CARD_EXCLUSIVE, selected: false, href: hrefFor(CARD_EXCLUSIVE.slug) },
  },
  {
    label: 'SkinCard · exclusive selected',
    props: { skin: CARD_EXCLUSIVE, selected: true, href: hrefFor(CARD_EXCLUSIVE.slug) },
  },
  {
    label: 'SkinCard · no bust',
    props: { skin: CARD_LIVE, selected: false, href: hrefFor(CARD_LIVE.slug) },
    note: 'render_bust_path is NULL: the slot holds a live 3D bust (one paused WebGL frame) until the render job fills it; the Skeleton sits there while the chunk loads.',
  },
  {
    label: 'SkinCard · long name',
    props: { skin: CARD_LONG, selected: false, href: hrefFor(CARD_LONG.slug) },
  },
];

const STAGE_A: SkinStageItem = {
  id: SEED_SKIN_A,
  ...CARD_A,
  descriptionMd: 'The one that started it.',
  downloads: 12,
};

const STAGE_B: SkinStageItem = {
  id: SEED_SKIN_B,
  ...CARD_EXCLUSIVE,
  descriptionMd: 'Slim arms. Big feelings.',
  downloads: 0,
};

export const skinsStageFixtures: SkinsStageFixture[] = [
  {
    label: 'SkinsStageView · two skins',
    props: {
      skins: [STAGE_B, STAGE_A],
      descriptions: {
        [STAGE_A.slug]: STAGE_A.descriptionMd,
        [STAGE_B.slug]: STAGE_B.descriptionMd,
      },
      selectedSlug: STAGE_B.slug,
    },
    note: 'The /skins island with a fixed selection (no URL read): the live viewer, the details slab and the 4-up grid. On the page a card click rewrites ?skin= and this view re-renders.',
  },
];

/** 03 §3 / §2.7 states the gallery describes instead of rendering. */
export const skinsDescribedStates: SkinsDescribedState[] = [
  {
    name: 'SkinsStage',
    label: 'SkinsStage · no skins',
    note: 'Not mounted: with no published skin the page renders the §11.7 empty state instead — "NO SKINS YET" / "Working on it. Check the projects meanwhile." → "See the projects". The EmptyState primitive has its own specimens.',
  },
];

// ---- Art (B3) ----
/*
 * The art half — 03 §2.7 `ArtCard` / `ArtMasonry` (+ `ArtMasonryLightbox`) + the `ArtGallery`
 * island (ADR-0048 D13 / D17); 03 §3 `Lightbox` `open | closing` (reached by clicking a card);
 * §11.7 "NO ART HERE YET" (an `ArtMasonry` whose filter matches nothing); T-E2E-9 / T-E2E-48.
 *
 * Pieces are the two SEED-8 objects in the local `art` bucket (SEED-13: a 256×256 icon and a
 * 1280×720 thumbnail — the same local-Supabase exception as the skins above) plus the local brand
 * images (`/brand/og-default.png` 1200×630, `/brand/avatar-160.png` 160×160), every `width` /
 * `height` the image's real size so `next/image` draws no stretched box. Squares and wides mixed
 * on purpose: the masonry's job is to show them at their own aspect. `downloadHref` is the
 * object URL + `?download=` exactly as `lib/data/art.ts` builds it (downloadable pieces only);
 * `credit` is a made-up handle, never a name (no PII).
 *
 * `ArtGallery` reads `?kind=` from this page's URL (`/dev/components?kind=icon` shows the empty
 * state through the island; its bar rewrites the param). The lightbox is reached by clicking any
 * card; no specimen renders it open (its `onClose` is a function — the `Lightbox` fixture note).
 */
import type { ArtCardProps } from '@/components/skins-art/ArtCard';
import type { ArtGalleryProps } from '@/components/skins-art/ArtGallery';
import type { ArtMasonryProps } from '@/components/skins-art/ArtMasonry';
import type { ArtItem } from '@/lib/art';

export type ArtCardFixture = { label: string; props: ArtCardProps; note?: string };
export type ArtMasonryFixture = { label: string; props: ArtMasonryProps; note?: string };
export type ArtGalleryFixture = { label: string; props: ArtGalleryProps; note?: string };

/** SEED-8 / SEED-13 objects in the local `art` bucket (05 §3; F-8 hashes). */
const ART_PUBLIC = 'http://127.0.0.1:54321/storage/v1/object/public/art';
const SEED_ART_AVATAR = '00000000-0000-4000-8000-000000000701';
const SEED_ART_THUMB = '00000000-0000-4000-8000-000000000702';
const SEED_AVATAR_URL = `${ART_PUBLIC}/${SEED_ART_AVATAR}/b64a4e0e96965d51.png`;
const SEED_THUMB_URL = `${ART_PUBLIC}/${SEED_ART_THUMB}/6ce87bbf56e4d5f6.png`;

function artPiece(
  n: number,
  overrides: Partial<ArtItem> & Pick<ArtItem, 'imageUrl' | 'width' | 'height'>,
): ArtItem {
  const slug = overrides.slug ?? `gallery-art-${n}`;
  const downloadable = overrides.downloadable ?? false;
  return {
    id: `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`,
    slug,
    title: `Gallery piece ${n}`,
    kind: 'avatar',
    year: null,
    credit: null,
    downloadable,
    downloadHref: downloadable ? `${overrides.imageUrl}?download=${slug}.png` : null,
    ...overrides,
  };
}

const AVATAR = artPiece(11, {
  slug: 'gallery-avatar',
  title: 'Gallery avatar',
  kind: 'avatar',
  imageUrl: SEED_AVATAR_URL,
  width: 256,
  height: 256,
  year: 2025,
  credit: 'galleryhands',
  downloadable: true,
});

const THUMB = artPiece(12, {
  slug: 'gallery-thumb',
  title: 'Gallery thumbnail',
  kind: 'thumbnail',
  imageUrl: SEED_THUMB_URL,
  width: 1280,
  height: 720,
});

const WIDE = artPiece(13, {
  slug: 'gallery-wide',
  title: 'Gallery wide render',
  kind: 'render',
  imageUrl: '/brand/og-default.png',
  width: 1200,
  height: 630,
  year: 2024,
});

const SMALL_SQUARE = artPiece(14, {
  slug: 'gallery-small',
  title: 'Gallery small avatar',
  kind: 'avatar',
  imageUrl: '/brand/avatar-160.png',
  width: 160,
  height: 160,
  downloadable: true,
});

/** A long title: the caption wraps and the card grows; nothing is clipped. */
const LONG_TITLE = artPiece(15, {
  slug: 'gallery-long-title',
  title: 'The piece with the really long title that wraps onto a second line',
  kind: 'other',
  imageUrl: SEED_THUMB_URL,
  width: 1280,
  height: 720,
  year: 2023,
});

const SECOND_THUMB = artPiece(16, {
  slug: 'gallery-thumb-2',
  title: 'Gallery thumbnail two',
  kind: 'thumbnail',
  imageUrl: '/brand/og-default.png',
  width: 1200,
  height: 630,
});

/** Six pieces, squares and wides mixed — no icon among them (ICONS reads 0 on the bar). */
const MIXED: ArtItem[] = [AVATAR, THUMB, WIDE, SMALL_SQUARE, LONG_TITLE, SECOND_THUMB];

export const artCardFixtures: ArtCardFixture[] = [
  {
    label: 'ArtCard · avatar',
    props: { item: AVATAR, index: 0 },
    note: 'Square, downloadable, with a year: the lightbox shows title · 2025 · Download.',
  },
  {
    label: 'ArtCard · thumbnail',
    props: { item: THUMB, index: 1 },
    note: '16:9 at its own aspect, not downloadable, no year: the lightbox shows the title only.',
  },
  { label: 'ArtCard · long title', props: { item: LONG_TITLE, index: 2 } },
];

export const artMasonryFixtures: ArtMasonryFixture[] = [
  {
    label: 'ArtMasonry · mixed sizes',
    props: { items: MIXED },
    note: 'Column flow, 4 / 2 / 1 columns, every piece at its natural size. Click a card for the lightbox; ←/→ move, Esc returns focus to the card.',
  },
  {
    label: 'ArtMasonry · empty filter',
    props: { items: MIXED, filter: 'icon' },
    note: 'A filter that matches nothing (here: icons among pieces that have none) — the §11.7 state, also what /art shows with no art at all.',
  },
];

export const artGalleryFixtures: ArtGalleryFixture[] = [
  {
    label: 'ArtGallery · six pieces',
    props: { items: MIXED },
    note: 'The /art island: ALL · AVATARS · THUMBNAILS · ICONS always, RENDERS / OTHER because such pieces exist; the bar writes ?kind= on this page.',
  },
];
