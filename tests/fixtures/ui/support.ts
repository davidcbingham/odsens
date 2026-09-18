/**
 * tests/fixtures/ui/support.ts — S1.5b Support components for `/dev/components` (03 §2.1
 * `FloatingSupportButton`, §2.9 `KofiCard` / `KofiPanelSlot` / `Leaderboard`; T-E2E-48).
 * `KofiPanelSlot` is shown idle only — the gallery never loads a Ko-fi iframe (01 INV-58: `/support`
 * is the one place it may appear). `oddsense` is the SEED-1 page name.
 */
import type { FloatingSupportButtonProps } from '@/components/layout/FloatingSupportButton';
import type { KofiCardProps } from '@/components/support/KofiCard';
import type { KofiPanelSlotProps } from '@/components/support/KofiPanelSlot';
import type { LeaderboardProps } from '@/components/support/Leaderboard';

export type KofiCardFixture = { label: string; props: KofiCardProps };
export type KofiPanelSlotFixture = { label: string; props: KofiPanelSlotProps };
export type LeaderboardFixture = { label: string; props: LeaderboardProps };
export type FloatingSupportButtonFixture = { label: string; props: FloatingSupportButtonProps };

export const kofiCardFixtures: KofiCardFixture[] = [
  { label: 'KofiCard · tips closed (no Ko-fi page)', props: { kofiPage: null } },
];

export const kofiPanelSlotFixtures: KofiPanelSlotFixture[] = [
  { label: 'KofiPanelSlot · idle', props: { kofiPage: 'oddsense', loaded: false } },
];

export const leaderboardFixtures: LeaderboardFixture[] = [
  { label: 'Leaderboard · empty (v1)', props: { rows: [] } },
];

export const floatingSupportButtonFixtures: FloatingSupportButtonFixture[] = [
  { label: 'FloatingSupportButton · fixed bottom-right', props: {} },
];
