/**
 * tests/fixtures/ui/avatar.ts — `Avatar` states for `/dev/components` (03 §2.2 `Avatar`; ADR-0002 #48).
 * Every size with a picture and with the initial fallback; question fallback; dim; 2px border.
 * Pictures are the brand avatar (public/brand): 80px source under 88, 160px source at 88/104.
 */
import type { AvatarProps } from '@/components/primitives/Avatar';

export type AvatarFixture = { label: string; props: AvatarProps };

const SIZES = [28, 34, 40, 56, 88, 104] as const;

const pictureFor = (size: (typeof SIZES)[number]) =>
  size >= 88 ? '/brand/avatar-160.png' : '/brand/avatar-80.png';

export const avatarFixtures: AvatarFixture[] = [
  ...SIZES.map((size): AvatarFixture => ({
    label: `Avatar · ${size} picture`,
    props: { src: pictureFor(size), alt: 'OddSense', size },
  })),
  ...SIZES.map((size): AvatarFixture => ({
    label: `Avatar · ${size} initial`,
    props: { src: null, alt: 'oddling', size, fallback: 'initial' },
  })),
  {
    label: 'Avatar · 34 question',
    props: { src: null, alt: 'Anonymous', size: 34, fallback: 'question' },
  },
  {
    label: 'Avatar · 40 dim',
    props: { src: '/brand/avatar-80.png', alt: 'OddSense', size: 40, dim: true },
  },
  {
    label: 'Avatar · 28 dim question',
    props: { src: null, alt: 'Anonymous', size: 28, fallback: 'question', dim: true },
  },
  {
    label: 'Avatar · 40 border-2',
    props: { src: '/brand/avatar-80.png', alt: 'OddSense', size: 40, border: 2 },
  },
  {
    label: 'Avatar · 34 border-2',
    props: { src: '/brand/avatar-80.png', alt: 'OddSense', size: 34, border: 2 },
  },
  {
    label: 'Avatar · 40 initial border-2',
    props: { src: null, alt: 'oddling', size: 40, border: 2 },
  },
];
