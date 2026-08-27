/**
 * tests/fixtures/ui/detailsList.ts — `DetailsList` for `/dev/components` (03 §2.3; T-E2E-48):
 * the four detail-page pairs (type, updated, licence, source — DESIGN.md §6 #3). `value` is
 * `ReactNode`; fixtures use plain strings so props stay serialisable across the Server
 * Component boundary (the real page passes a link for Source).
 */
import type { DetailsListProps } from '@/components/projects/DetailsList';

export type DetailsListFixture = { label: string; props: DetailsListProps };

export const detailsListFixtures: DetailsListFixture[] = [
  {
    label: 'DetailsList · project detail',
    props: {
      items: [
        { label: 'Type', value: 'Mod' },
        { label: 'Updated', value: '3 weeks ago' },
        { label: 'Licence', value: 'MIT' },
        { label: 'Source', value: 'GitHub' },
      ],
    },
  },
  {
    label: 'DetailsList · two pairs',
    props: {
      items: [
        { label: 'Type', value: 'Resource pack' },
        { label: 'Updated', value: 'yesterday' },
      ],
    },
  },
];
