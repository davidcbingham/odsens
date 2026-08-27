/**
 * tests/fixtures/ui/sectionTitle.ts — `SectionTitle` states for `/dev/components` (03 §2.2
 * `SectionTitle`; DESIGN.md §2 Section title; T-E2E-48). The count shows as a `PixelLabel`
 * ("14 TOTAL") and reads inside the heading as sr "14 total"; the action is the right-aligned
 * ghost `Button` (the "All mentions →" pattern — the ghost arrow comes from `Button`, so the
 * label carries none). No DB, no network.
 */
import type { SectionTitleProps } from '@/components/primitives/SectionTitle';

export type SectionTitleFixture = { label: string; props: SectionTitleProps };

export const sectionTitleFixtures: SectionTitleFixture[] = [
  { label: 'SectionTitle · plain', props: { children: 'VERSIONS & FILES' } },
  {
    label: 'SectionTitle · count',
    props: { children: 'COMMENTS', count: { value: 14, word: 'TOTAL' } },
  },
  {
    label: 'SectionTitle · action',
    props: { children: 'IN THE WILD', action: { label: 'All mentions', href: '/seen-on' } },
  },
  {
    label: 'SectionTitle · h3 count',
    props: { children: 'SEEN ON', as: 'h3', count: { value: 3, word: 'MENTIONS' } },
  },
];
