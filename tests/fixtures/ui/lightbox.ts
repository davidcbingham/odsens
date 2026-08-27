/**
 * tests/fixtures/ui/lightbox.ts — `Lightbox` copy for `/dev/components` (03 §2.3, §3).
 * `onClose` / `onIndex` / `meta` are functions, so a Server Component cannot pass them
 * (the InlineConfirm precedent): the page shows `Lightbox` through the `Gallery` specimen
 * (click the big well → open, Esc → closing → closed). These rows document the prop shapes
 * the S1.2 gallery and the S1.7 Art call sites use.
 */
import type { LightboxProps } from '@/components/projects/Lightbox';

export type LightboxFixture = {
  label: string;
  props: Omit<LightboxProps, 'onClose' | 'onIndex' | 'meta'>;
};

export const lightboxFixtures: LightboxFixture[] = [
  {
    label: 'Lightbox · gallery images',
    props: {
      images: [
        {
          url: 'https://cdn.modrinth.com/data/fixture0/images/screenshot-1.png',
          alt: 'The mace mid-swing',
          caption: 'It does the sound.',
        },
        {
          url: 'https://cdn.modrinth.com/data/fixture0/images/screenshot-2.png',
          alt: 'The mace at rest',
        },
      ],
      index: 0,
    },
  },
  {
    label: 'Lightbox · single image',
    props: {
      images: [
        {
          url: 'https://cdn.modrinth.com/data/fixture0/images/screenshot-1.png',
          alt: 'The mace mid-swing',
        },
      ],
      index: 0, // arrows hidden — a flag, not a state (03)
    },
  },
];
