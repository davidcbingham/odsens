/**
 * tests/fixtures/ui/adminShell.ts — `AdminShell` for `/dev/components` (03 §2.10; 02 RP-14; T-E2E-33):
 * moderator (no Settings item, held count 0, no picture) and admin (Settings item, held count 3 in
 * gold, picture in the header trigger).
 */
import type { AdminShellProps } from '@/components/admin/AdminShell';

export type AdminShellFixture = { label: string; props: AdminShellProps };

export const adminShellFixtures: AdminShellFixture[] = [
  {
    label: 'AdminShell · moderator',
    props: {
      viewer: { handle: 'seed_mod', role: 'moderator' },
      counts: { heldComments: 0 },
      children: 'Nothing to do yet.',
    },
  },
  {
    label: 'AdminShell · admin held 3',
    props: {
      viewer: { handle: 'oddsense', role: 'admin', avatarUrl: '/brand/avatar-160.png' },
      counts: { heldComments: 3 },
      children: 'Nothing to do yet.',
    },
  },
];
