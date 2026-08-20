/**
 * tests/fixtures/ui/profilePanel.ts — `ProfilePanel` for `/dev/components` (03 §2.5; ADR-0014).
 * With and without a stored picture; with the 7-day rename limit active (`limitedUntil` is the
 * `YYYY-MM-DD` string the server page computes — a fixed value here, so the specimen renders the
 * same on every run). It is also the only server-composable host for `InlineConfirm` (closed state)
 * on this page.
 */
import type { ProfilePanelProps } from '@/components/accounts/ProfilePanel';

export type ProfilePanelFixture = { label: string; props: ProfilePanelProps };

export const profilePanelFixtures: ProfilePanelFixture[] = [
  {
    label: 'ProfilePanel · picture',
    props: { handle: 'pipe_enjoyer', avatarUrl: '/brand/avatar-160.png', limitedUntil: null },
  },
  {
    label: 'ProfilePanel · no picture',
    props: { handle: 'seed_user2', avatarUrl: null, limitedUntil: null },
  },
  {
    label: 'ProfilePanel · rename limited',
    props: { handle: 'seed_user', avatarUrl: null, limitedUntil: '2026-08-27' },
  },
];
