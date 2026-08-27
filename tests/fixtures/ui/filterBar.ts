/**
 * tests/fixtures/ui/filterBar.ts — `FilterBar` for `/dev/components` (03 §2.3 `FilterBar`;
 * DESIGN.md §5 "Filter bar"; T-E2E-48). Active state follows the dev route's own URL
 * (`?type=mod` lights MODS — 02 RP-02); the specimen renders the all-types default. The
 * `/seen-on` shape (platform group, S1.8 reuse) is previewed with a second fixture.
 * Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard).
 */
import type { FilterBarProps } from '@/components/projects/FilterBar';

export type FilterBarFixture = { label: string; props: FilterBarProps };

const PROJECT_GROUPS: FilterBarProps['groups'] = [
  {
    key: 'type',
    options: [
      { value: 'mod', label: 'MODS', count: 7 },
      { value: 'datapack', label: 'DATAPACKS', count: 4 },
      { value: 'resourcepack', label: 'PACKS', count: 5 },
      { value: 'plugin', label: 'PLUGINS', count: 2 },
    ],
  },
];

const PROJECT_SELECTS: FilterBarProps['selects'] = [
  {
    name: 'version',
    label: 'Version',
    options: [
      { value: '', label: 'All versions' },
      { value: '1.21.x', label: '1.21.x' },
      { value: '1.20.x', label: '1.20.x' },
      { value: 'snapshots', label: 'snapshots' },
    ],
  },
  {
    name: 'sort',
    label: 'Sort',
    options: [
      { value: 'downloads', label: 'Downloads' },
      { value: 'updated', label: 'Updated' },
      { value: 'newest', label: 'Newest' },
      { value: 'title', label: 'Title' },
    ],
  },
];

export const filterBarFixtures: FilterBarFixture[] = [
  {
    label: 'FilterBar · projects',
    props: { groups: PROJECT_GROUPS, selects: PROJECT_SELECTS },
  },
  {
    label: 'FilterBar · platform group',
    props: {
      groups: [
        {
          key: 'platform',
          options: [
            { value: 'youtube', label: 'YOUTUBE', count: 6 },
            { value: 'tiktok', label: 'TIKTOK', count: 2 },
            { value: 'twitch', label: 'TWITCH', count: 1 },
          ],
        },
      ],
      selects: [],
    },
  },
];
