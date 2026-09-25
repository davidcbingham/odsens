/**
 * tests/fixtures/ui/adminForms.ts — the S1.7 admin form islands for `/dev/components` (03 §2.10
 * admin-only controls rule; 02 §1.3 `/admin/skins` / `/admin/art`; ADR-0048 D19 / D27 / D19 / D27;
 * T-E2E-48). Three states each: `create` (empty fields, the well `idle`), `edit` (the row
 * pre-filled, "Replace texture" / "Replace image" beside the current picture) and `moderator`
 * (`readOnly`: every control rendered disabled under `title="Admin only"`, never hidden, no
 * `<form>`).
 *
 * No DB. Pending / field-error / conflict / "render later" are interaction-only states (the
 * `MentionPreview` precedent): Save calls the real `createSkin` / `updateSkin` / `createArt` /
 * `updateArt`, which answer a signed-out gallery visitor with their inline error; the art well's
 * `begin` does the same before any byte leaves. The `edit` pictures are the LOCAL Supabase seed
 * objects (SEED-13 — the `skinsArt.ts` / `skinViewer3d.ts` exception to "no network": the local
 * stack is the e2e's own origin). Ids are the seed ids; slugs and names are the artboard's mock
 * data, never a real person (no PII — `credit` is an invented handle). Labels: "<Name> · <state>"
 * (≤ 5 words — PixelLabel guard).
 */
import type { ArtFormProps } from '@/components/admin/ArtForm';
import type { SkinFormProps } from '@/components/admin/SkinForm';

export type SkinFormFixture = { label: string; props: SkinFormProps };
export type ArtFormFixture = { label: string; props: ArtFormProps };

/** SEED-7 / SEED-8 / SEED-13 objects in the local `skins` / `art` buckets (05 §3). */
const STORAGE_PUBLIC = 'http://127.0.0.1:54321/storage/v1/object/public';
const SEED_SKIN_A = '00000000-0000-4000-8000-000000000601';
const SEED_ART_THUMB = '00000000-0000-4000-8000-000000000702';

const skin: NonNullable<SkinFormProps['skin']> = {
  id: SEED_SKIN_A,
  slug: 'gallery-skin-a',
  name: 'Gallery Skin A',
  descriptionMd: 'The one that started it. Plain, dependable, slightly cursed.',
  model: 'classic',
  exclusive: false,
  status: 'published',
  sortOrder: 2,
  textureUrl: `${STORAGE_PUBLIC}/skins/${SEED_SKIN_A}/texture.png`,
  bustUrl: `${STORAGE_PUBLIC}/skins/${SEED_SKIN_A}/bust.png`,
};

const art: NonNullable<ArtFormProps['art']> = {
  id: SEED_ART_THUMB,
  slug: 'gallery-thumb',
  title: 'Gallery Thumbnail',
  kind: 'thumbnail',
  year: 2025,
  credit: 'gallerycreator',
  downloadable: true,
  status: 'published',
  sortOrder: 2,
  imageUrl: `${STORAGE_PUBLIC}/art/${SEED_ART_THUMB}/6ce87bbf56e4d5f6.png`,
  width: 1280,
  height: 720,
};

export const skinFormFixtures: SkinFormFixture[] = [
  { label: 'SkinForm · create', props: {} },
  { label: 'SkinForm · edit', props: { skin } },
  { label: 'SkinForm · moderator', props: { skin, readOnly: true } },
];

export const artFormFixtures: ArtFormFixture[] = [
  { label: 'ArtForm · create', props: {} },
  { label: 'ArtForm · edit', props: { art } },
  { label: 'ArtForm · moderator', props: { art, readOnly: true } },
];
