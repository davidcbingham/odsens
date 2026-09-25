/**
 * tests/fixtures/ui/platformMark.ts — `PlatformMark` for `/dev/components` (03 §2.2
 * `PlatformMark`; T-E2E-48). S1.2 shipped Modrinth / CurseForge / YouTube; S1.8 (Seen on) brings
 * the rest of the union: TikTok / Twitch / Reddit (neutral placeholder assets until Oliver's
 * official-logo PR — Q44, like the first three), `article` / `other` (no logo — the `external`
 * glyph) and `odsens` (the ODSENS wordmark chip that tags a general mention — ADR-0045 D21).
 * Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard).
 */
import type { PlatformMarkProps } from '@/components/primitives/PlatformMark';

export type PlatformMarkFixture = { label: string; props: PlatformMarkProps };

export const platformMarkFixtures: PlatformMarkFixture[] = [
  { label: 'PlatformMark · modrinth', props: { platform: 'modrinth' } },
  { label: 'PlatformMark · curseforge', props: { platform: 'curseforge' } },
  { label: 'PlatformMark · youtube word', props: { platform: 'youtube', withWord: true } },
  { label: 'PlatformMark · compact 24', props: { platform: 'modrinth', size: 24 } },
  // ---- S1.8 Seen on ----
  { label: 'PlatformMark · tiktok', props: { platform: 'tiktok' } },
  { label: 'PlatformMark · twitch', props: { platform: 'twitch' } },
  { label: 'PlatformMark · reddit word', props: { platform: 'reddit', withWord: true } },
  { label: 'PlatformMark · article glyph', props: { platform: 'article' } },
  { label: 'PlatformMark · other word', props: { platform: 'other', withWord: true } },
  { label: 'PlatformMark · odsens wordmark', props: { platform: 'odsens' } },
  { label: 'PlatformMark · odsens compact', props: { platform: 'odsens', size: 24 } },
];
