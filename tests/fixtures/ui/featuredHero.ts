/**
 * tests/fixtures/ui/featuredHero.ts — `FeaturedHero` states for `/dev/components` (03 §2.3
 * `FeaturedHero`; DESIGN.md §6.1; 02 §2.1 #1). `isNew` is precomputed here exactly as the page
 * computes it server-side (ADR-0002 #41) — fixtures never read the clock. Screenshot uses a
 * local brand asset (no network). The `null` row documents the renders-nothing contract.
 */
import type { FeaturedHeroProps } from '@/components/projects/FeaturedHero';

export type FeaturedHeroFixture = { label: string; props: FeaturedHeroProps };

const mace: NonNullable<FeaturedHeroProps['project']> = {
  slug: 'metal-pipe-mace',
  title: 'Metal Pipe Mace',
  description: 'A mace made out of a metal pipe. It does the sound. That is the whole mod.',
  type: 'mod',
  exclusive: false,
  isNew: false,
  chips: ['1.21.x', 'Fabric', 'NeoForge'],
  downloadHref: 'https://modrinth.com/mod/metal-pipe-mace',
  downloadKind: 'modrinth',
};

const screenshot = { url: '/brand/og-default.png', alt: 'Metal Pipe Mace in a cave' };

export const featuredHeroFixtures: FeaturedHeroFixture[] = [
  {
    label: 'FeaturedHero · modrinth',
    props: { project: mace, screenshot },
  },
  {
    label: 'FeaturedHero · new',
    props: { project: { ...mace, isNew: true }, screenshot },
  },
  {
    label: 'FeaturedHero · chip overflow',
    props: {
      project: {
        ...mace,
        chips: ['1.21.4', '1.21.1', '1.20.x', 'Fabric', 'NeoForge', 'Quilt'],
      },
      screenshot,
    },
  },
  {
    label: 'FeaturedHero · no screenshot',
    props: { project: mace, screenshot: null },
  },
  {
    label: 'FeaturedHero · direct',
    props: {
      project: {
        ...mace,
        slug: 'duck-crosshair',
        title: 'Duck Crosshair',
        description: 'Your crosshair is a duck now.',
        type: 'resourcepack',
        isNew: true,
        chips: ['1.21.x'],
        downloadHref: '/api/download/00000000-0000-4000-8000-000000000001',
        downloadKind: 'direct',
      },
      screenshot: null,
    },
  },
  {
    label: 'FeaturedHero · none',
    props: { project: null, screenshot: null },
  },
];
