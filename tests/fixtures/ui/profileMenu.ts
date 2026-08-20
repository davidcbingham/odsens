/**
 * tests/fixtures/ui/profileMenu.ts — `ProfileMenu` for `/dev/components` (03 §2.5, §3; T-E2E-48).
 * No `viewer` + no session = the anon slot ("Sign in"); with `viewer` = the trigger (closed); click
 * for `data-state="open"`. Roles: user (no Admin item), moderator / admin (Admin item); no picture.
 */
import type { ProfileMenuProps } from '@/components/accounts/ProfileMenu';

export type ProfileMenuFixture = { label: string; props: ProfileMenuProps };

export const profileMenuFixtures: ProfileMenuFixture[] = [
  { label: 'ProfileMenu · anon', props: {} },
  {
    label: 'ProfileMenu · user (click for open)',
    props: { viewer: { handle: 'pipe_enjoyer', avatarUrl: '/brand/avatar-80.png', role: 'user' } },
  },
  {
    label: 'ProfileMenu · moderator',
    props: { viewer: { handle: 'seed_mod', avatarUrl: null, role: 'moderator' } },
  },
  {
    label: 'ProfileMenu · admin',
    props: { viewer: { handle: 'oddsense', avatarUrl: '/brand/avatar-80.png', role: 'admin' } },
  },
];
