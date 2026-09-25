/**
 * tests/fixtures/ui/skinViewer3d.ts — S1.7 `SkinViewer3D` for `/dev/components` (03 §2.7 row; 03 §3
 * `loading | ready | unsupported`; ADR-0048 D14 / D15 `variant`; ADR-0048 D14; T-E2E-48).
 *
 * The gallery is "no DB, no network" (03 §7) — with one local exception it shares with the e2e
 * run: the texture is the LOCAL Supabase public object of SEED-7's `seed-skin-b` (SEED-13 uploads
 * it in `globalSetup.db.ts`; `tests/e2e/fixtures.ts` leaves local Supabase URLs real), so the
 * specimens exercise the true path — skinview3d fetching the public URL — against `127.0.0.1`,
 * never a third-party host. `unsupported` is reached through the same code, not a switch: a
 * same-origin texture URL that does not exist (404 → the image load rejects → the leaf falls to
 * the render), with the local brand image standing in for a cached bust. `loading` is the
 * moment before the chunk and the texture arrive — a screenshot may catch it, nothing describes it.
 *
 * Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard).
 */
import type { SkinViewer3DProps } from '@/components/skins-art/SkinViewer3D';

export type SkinViewer3DFixture = {
  label: string;
  props: SkinViewer3DProps;
  /** Printed above the specimen when the state needs a word of explanation. */
  note?: string;
};

/** SEED-7 `seed-skin-b` (`…0602`) — the object SEED-13 uploads to the local `skins` bucket. */
const SEED_SKIN_B_TEXTURE =
  'http://127.0.0.1:54321/storage/v1/object/public/skins/00000000-0000-4000-8000-000000000602/texture.png';

/** Same origin as the page, exists nowhere: the load fails and the leaf shows the render. */
const MISSING_TEXTURE = '/brand/skins/does-not-exist.png';

export const skinViewer3dFixtures: SkinViewer3DFixture[] = [
  {
    label: 'SkinViewer3D · stage slim',
    props: {
      textureUrl: SEED_SKIN_B_TEXTURE,
      model: 'slim',
      name: 'Seed Skin B',
      bustFallbackUrl: null,
      autoRotate: false,
    },
    note: 'Spin starts off here (on the page it starts on): a still stage is `renderPaused` and draws on demand, so the gallery never runs several GL loops at once — press Spin to see it turn.',
  },
  {
    label: 'SkinViewer3D · stage classic still',
    props: {
      textureUrl: SEED_SKIN_B_TEXTURE,
      model: 'classic',
      name: 'Seed Skin B',
      bustFallbackUrl: null,
      autoRotate: false,
    },
    note: 'Spin starts off (`autoRotate: false` — also the reduced-motion default; Walk is disabled only under reduced motion).',
  },
  {
    label: 'SkinViewer3D · bust',
    props: {
      textureUrl: SEED_SKIN_B_TEXTURE,
      model: 'slim',
      name: 'Seed Skin B',
      bustFallbackUrl: null,
      variant: 'bust',
    },
    note: 'The SkinCard live fallback: one frame, head and shoulders, no controls, transparent — the card slot supplies the well.',
  },
  {
    label: 'SkinViewer3D · unsupported',
    props: {
      textureUrl: MISSING_TEXTURE,
      model: 'classic',
      name: 'Seed Skin B',
      bustFallbackUrl: '/brand/og-default.png',
    },
    note: 'No WebGL, or the texture will not load (here: a same-origin 404): the cached bust and one line stand in for the canvas; no controls.',
  },
];
