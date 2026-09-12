/**
 * tests/fixtures/ui/getItPanel.ts — `GetItPanel` for `/dev/components` (03 §2.3; T-E2E-48;
 * the S1.2 e2e wants a Modrinth-source AND an exclusive/direct fixture — the big download is
 * the primary look for BOTH). The "cross-posted" specimen is ADR-0037 D6: a hosted primary
 * with "Also on Modrinth" / "Also on CurseForge" rows (`also: true`) whose counts plus the
 * direct row sum to the combined total (00 S1.5a.AC6). Counts sum per `combinedDownloads`
 * (05 T-UNIT-11); no DB, no network.
 */
import type { GetItPanelProps } from '@/components/projects/GetItPanel';

export type GetItPanelFixture = { label: string; props: GetItPanelProps };

export const getItPanelFixtures: GetItPanelFixture[] = [
  {
    label: 'GetItPanel · modrinth source',
    props: {
      slug: 'metal-pipe-mace',
      primary: {
        kind: 'modrinth',
        href: 'https://cdn.modrinth.com/data/fixture0/versions/metal-pipe-mace-1.3.0.jar',
        label: 'Download 1.21.4',
        fileMeta: {
          filename: 'metal-pipe-mace-1.3.0.jar',
          sizeBytes: 188416,
          gameVersions: ['1.21.4'],
          loaders: ['Fabric'],
        },
      },
      rows: [
        { platform: 'modrinth', href: 'https://modrinth.com/mod/metal-pipe-mace', downloads: 2904 },
        {
          platform: 'curseforge',
          href: 'https://www.curseforge.com/minecraft/mc-mods/metal-pipe-mace',
          downloads: 305,
        },
      ],
      combined: { total: 3209, direct: 0 },
    },
  },
  {
    label: 'GetItPanel · exclusive direct',
    props: {
      slug: 'heavy-spear',
      primary: {
        kind: 'direct',
        href: '/api/download/f-hs-100', // S1.3 download route shape (04)
        label: 'Download',
        fileMeta: {
          filename: 'heavy-spear-1.0.0.jar',
          sizeBytes: 92160,
          gameVersions: ['1.21.1'],
          loaders: ['Fabric'],
        },
      },
      rows: [],
      combined: { total: 412, direct: 412 },
    },
  },
  {
    label: 'GetItPanel · cross-posted',
    props: {
      slug: 'heavy-spear-cross',
      primary: {
        kind: 'direct',
        href: '/api/download/f-hs-110',
        label: 'Download',
        fileMeta: {
          filename: 'heavy-spear-1.1.0.jar',
          sizeBytes: 94208,
          gameVersions: ['1.21.4'],
          loaders: ['Fabric'],
        },
      },
      rows: [
        {
          platform: 'modrinth',
          href: 'https://modrinth.com/project/fixture1',
          downloads: 1200,
          also: true,
        },
        {
          platform: 'curseforge',
          href: 'https://www.curseforge.com/minecraft/mc-mods/heavy-spear',
          downloads: 80,
          also: true,
        },
      ],
      combined: { total: 1692, direct: 412 },
    },
  },
];
