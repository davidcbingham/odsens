/**
 * tests/fixtures/ui/projectGrid.ts — `ProjectGrid` for `/dev/components` (03 §2.3 `ProjectGrid`,
 * ADR-0002 A7; 02 §2.2; T-E2E-48). The grid owns filter/search/sort state from the URL, so the
 * dev page shows the unfiltered render; filters/search react to `?type=&version=&sort=&q=` on
 * the dev route itself. Fixtures: a four-project list (every type, one exclusive) and the
 * zero-projects empty state ("NOTHING MATCHES" without the Clear action — 02 §2.2).
 * Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard).
 */
import type { ProjectGridProps, ProjectListItem } from '@/components/projects/ProjectGrid';

export type ProjectGridFixture = { label: string; props: ProjectGridProps };

const PROJECTS: ProjectListItem[] = [
  {
    slug: 'metal-pipe-mace',
    title: 'Metal Pipe Mace',
    description: 'A mace made out of a metal pipe. It does the sound.',
    iconUrl: '/brand/avatar-80.png',
    type: 'mod',
    chips: ['1.21.x', 'Fabric'],
    downloadsTotal: 1688,
    exclusive: false,
    gameVersions: ['1.21', '1.21.1', '1.21.4'],
    externalUpdatedAt: '2026-08-01T12:00:00Z',
    publishedAt: '2026-05-10T12:00:00Z',
  },
  {
    slug: 'heavy-spear',
    title: 'Heavy Spear',
    description: 'Long reach, real weight, no shield.',
    iconUrl: '/brand/avatar-80.png',
    type: 'mod',
    chips: ['1.21.x', '1.20.x', 'Fabric', 'NeoForge'],
    downloadsTotal: 12431,
    exclusive: false,
    gameVersions: ['1.21.1', '1.20.1'],
    externalUpdatedAt: '2026-07-14T12:00:00Z',
    publishedAt: '2026-03-02T12:00:00Z',
  },
  {
    slug: 'pixel-chameleon',
    title: 'Pixel Chameleon',
    description: 'It hides. Sometimes too well.',
    iconUrl: null,
    type: 'datapack',
    chips: ['1.21.x'],
    downloadsTotal: 2147,
    exclusive: false,
    gameVersions: ['1.21.4', '24w10a'],
    externalUpdatedAt: '2026-08-20T12:00:00Z',
    publishedAt: '2026-08-18T12:00:00Z',
  },
  {
    slug: 'troll-resources',
    title: 'Troll Resources',
    description: 'Everything looks slightly wrong.',
    iconUrl: null,
    type: 'resourcepack',
    chips: ['1.20.x'],
    downloadsTotal: 3209,
    exclusive: true,
    gameVersions: ['1.20.1'],
    externalUpdatedAt: null,
    publishedAt: '2026-01-20T12:00:00Z',
  },
];

const GROUPS: ProjectGridProps['groups'] = [
  {
    key: 'type',
    options: [
      { value: 'mod', label: 'MODS', count: 2 },
      { value: 'datapack', label: 'DATAPACKS', count: 1 },
      { value: 'resourcepack', label: 'RESOURCE PACKS', count: 1 },
      { value: 'plugin', label: 'PLUGINS', count: 0 },
    ],
  },
];

const SELECTS: ProjectGridProps['selects'] = [
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

export const projectGridFixtures: ProjectGridFixture[] = [
  {
    label: 'ProjectGrid · four projects',
    props: { projects: PROJECTS, groups: GROUPS, selects: SELECTS },
  },
  {
    label: 'ProjectGrid · empty',
    props: { projects: [], groups: GROUPS, selects: SELECTS },
  },
];
