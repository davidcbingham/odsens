/**
 * tests/fixtures/ui/versionsTable.ts — `VersionsTable` for `/dev/components` (03 §2.3; T-E2E-48;
 * the S1.2 e2e asserts the word Download and the "Changes ▾" expander). Per ADR-0037 D6 each
 * file carries its own `kind`: `modrinth` rows link the Modrinth CDN URL (`project_files.url`,
 * ADR-0002 #42), `direct` rows link `/api/download/<id>`; the project-level `source` prop is
 * gone. The "cross-posted" specimen shows one version living in both homes (hosted primary
 * first, then the CDN mirror — `hostedFirst` order). No DB, no network.
 */
import type { VersionsTableProps } from '@/components/projects/VersionsTable';

export type VersionsTableFixture = { label: string; props: VersionsTableProps };

const cdn = (name: string) => `https://cdn.modrinth.com/data/fixture0/versions/${name}`;

export const versionsTableFixtures: VersionsTableFixture[] = [
  {
    label: 'VersionsTable · with changelogs',
    props: {
      projectId: 'fixture-project-1',
      slug: 'metal-pipe-mace',
      versions: [
        {
          id: 'v-130',
          versionNumber: 'v1.3.0',
          gameVersions: ['1.21.4'],
          loaders: ['Fabric'],
          datePublished: '2026-08-01T12:00:00Z',
          changelogMd:
            '- Pipe sound no longer plays twice on crits. It was funny once.\n- Enchant glint fixed on NeoForge.',
          files: [
            {
              id: 'f-130-jar',
              filename: 'metal-pipe-mace-1.3.0.jar',
              sizeBytes: 188416,
              href: cdn('metal-pipe-mace-1.3.0.jar'),
              kind: 'modrinth',
              primary: true,
            },
            {
              id: 'f-130-sources',
              filename: 'metal-pipe-mace-1.3.0-sources.jar',
              sizeBytes: 92160,
              href: cdn('metal-pipe-mace-1.3.0-sources.jar'),
              kind: 'modrinth',
              primary: false,
            },
          ],
        },
        {
          id: 'v-121',
          versionNumber: 'v1.2.1',
          gameVersions: ['1.20.1', '1.20.4'],
          loaders: ['Fabric'],
          datePublished: '2026-05-14T12:00:00Z',
          changelogMd: '- The mace now knocks back armour stands. This was requested.',
          files: [
            {
              id: 'f-121-jar',
              filename: 'metal-pipe-mace-1.2.1.jar',
              sizeBytes: 184320,
              href: cdn('metal-pipe-mace-1.2.1.jar'),
              kind: 'modrinth',
              primary: true,
            },
          ],
        },
      ],
    },
  },
  {
    label: 'VersionsTable · no changelog',
    props: {
      projectId: 'fixture-project-2',
      slug: 'duck-crosshair',
      versions: [
        {
          id: 'v-100',
          versionNumber: 'v1.0.0',
          gameVersions: ['1.21.1', '1.21.4'],
          loaders: ['Fabric', 'NeoForge'],
          datePublished: '2026-07-02T12:00:00Z',
          changelogMd: null,
          files: [
            {
              id: 'f-100-zip',
              filename: 'duck-crosshair-1.0.0.zip',
              sizeBytes: 51200,
              href: cdn('duck-crosshair-1.0.0.zip'),
              kind: 'modrinth',
              primary: true,
            },
          ],
        },
      ],
    },
  },
  {
    label: 'VersionsTable · cross-posted',
    props: {
      projectId: 'fixture-project-3',
      slug: 'heavy-spear',
      versions: [
        {
          id: 'v-hs-110',
          versionNumber: 'v1.1.0',
          gameVersions: ['1.21.4'],
          loaders: ['Fabric'],
          datePublished: '2026-08-20T12:00:00Z',
          changelogMd: '- Spear now sticks in walls. On purpose this time.',
          files: [
            {
              id: 'f-hs-110-cdn',
              filename: 'heavy-spear-1.1.0.jar',
              sizeBytes: 94208,
              href: cdn('heavy-spear-1.1.0.jar'),
              kind: 'modrinth',
              primary: true,
            },
            {
              id: 'f-hs-110-jar',
              filename: 'heavy-spear-1.1.0.jar',
              sizeBytes: 94208,
              href: '/api/download/00000000-0000-4000-8000-000000000110',
              kind: 'direct',
              primary: true,
            },
          ],
        },
        {
          id: 'v-hs-100',
          versionNumber: 'v1.0.0',
          gameVersions: ['1.21.1'],
          loaders: ['Fabric'],
          datePublished: '2026-06-10T12:00:00Z',
          changelogMd: null,
          files: [
            {
              id: 'f-hs-100-jar',
              filename: 'heavy-spear-1.0.0.jar',
              sizeBytes: 92160,
              href: '/api/download/00000000-0000-4000-8000-000000000100',
              kind: 'direct',
              primary: true,
            },
          ],
        },
      ],
    },
  },
];
