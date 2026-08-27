/**
 * tests/fixtures/ui/platformMark.ts — `PlatformMark` for `/dev/components` (03 §2.2
 * `PlatformMark`; T-E2E-48). S1.2 ships Modrinth / CurseForge / YouTube (neutral placeholder
 * assets until Oliver's official-logo PR — Q44); the wider platform union arrives with Seen on.
 * Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard).
 */
import type { PlatformMarkProps } from '@/components/primitives/PlatformMark';

export type PlatformMarkFixture = { label: string; props: PlatformMarkProps };

export const platformMarkFixtures: PlatformMarkFixture[] = [
  { label: 'PlatformMark · modrinth', props: { platform: 'modrinth' } },
  { label: 'PlatformMark · curseforge', props: { platform: 'curseforge' } },
  { label: 'PlatformMark · youtube word', props: { platform: 'youtube', withWord: true } },
  { label: 'PlatformMark · compact 24', props: { platform: 'modrinth', size: 24 } },
];
