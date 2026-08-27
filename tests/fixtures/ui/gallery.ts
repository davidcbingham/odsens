/**
 * tests/fixtures/ui/gallery.ts — `Gallery` for `/dev/components` (03 §2.3; T-E2E-48; the 7-image
 * row is the `+N` fixture for the S1.2 gallery e2e). S1.2 gallery = Modrinth URLs only
 * (ADR-0002 C10) — hosts from the INV-54 allowlist; no DB, no network.
 */
import type { GalleryProps } from '@/components/projects/Gallery';

export type GalleryFixture = { label: string; props: GalleryProps };

const shot = (n: number) => ({
  url: `https://cdn.modrinth.com/data/fixture0/images/screenshot-${n}.png`,
  alt: `The mace mid-swing, screenshot ${n}`,
});

export const galleryFixtures: GalleryFixture[] = [
  {
    label: 'Gallery · three images',
    props: { images: [shot(1), shot(2), shot(3)] },
  },
  {
    label: 'Gallery · seven images',
    props: { images: [shot(1), shot(2), shot(3), shot(4), shot(5), shot(6), shot(7)] },
  },
  {
    label: 'Gallery · single image',
    props: { images: [{ ...shot(1), caption: 'It does the sound.' }] },
  },
  {
    label: 'Gallery · empty',
    props: { images: [] }, // 03: renders nothing — the specimen shows an empty block
  },
];
