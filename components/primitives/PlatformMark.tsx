import Image from 'next/image';
import { Icon } from '@/components/primitives/Icon';
import styles from './PlatformMark.module.css';

/**
 * PlatformMark — DESIGN.md §4 ("Third-party marks use official logos at official colours
 * inside a neutral slab"), §12.1 Mention card (26px neutral slab); 03 §2.2 `PlatformMark`. Shared
 * (no directive). The logo sits in a neutral `--plugin-wash` slab (26px, 24 compact), never
 * recoloured; assets live at `public/brand/marks/<platform>.svg` — neutral placeholders until
 * Oliver's official-asset PR (Q44; ADR-0002 #25). Without `withWord` the slab is `role="img"
 * aria-label="<Platform>"`; with it the word is the text and the slab is decorative (03 C-26).
 * Not interactive.
 *
 * S1.8 (03 §2.2 row; ADR-0045 D21) — the two kinds of mark that are not a logo file:
 *   `article` / `other`  no platform to draw: the slab holds `Icon name="external"` (16px,
 *                        `--mute` — the placeholder marks' own stroke colour).
 *   `odsens`             the `ODSENS` wordmark chip that tags a general mention ("About OddSense
 *                        generally") in the `/seen-on` card footer: Bungee on the same slab, as
 *                        tall as `size` and as wide as the word. 16px — DESIGN.md §2 keeps Bungee
 *                        at 16px or more outside button / filter labels.
 * Every other platform renders exactly as before (same slab, same 16px `next/image`). The slab is
 * also the placeholder in a non-YouTube mention's thumb slot (ADR-0002 #33 — the remote thumbnail
 * of an arbitrary host is never fetched); `MentionCard` centres a 26px mark in its own well, so no
 * larger size exists here.
 */
export type PlatformMarkPlatform =
  | 'modrinth'
  | 'curseforge'
  | 'youtube'
  | 'kofi'
  | 'tiktok'
  | 'twitch'
  | 'reddit'
  | 'article'
  | 'other'
  | 'odsens';

export type PlatformMarkProps = {
  platform: PlatformMarkPlatform;
  size?: 24 | 26;
  withWord?: boolean;
  className?: string;
};

const PLATFORM_WORDS: Record<PlatformMarkPlatform, string> = {
  modrinth: 'Modrinth',
  curseforge: 'CurseForge',
  youtube: 'YouTube',
  kofi: 'Ko-fi',
  tiktok: 'TikTok',
  twitch: 'Twitch',
  reddit: 'Reddit',
  article: 'Article',
  other: 'Other',
  odsens: 'odsens',
};

/** The wordmark as it is lettered everywhere else (Nav, Footer). */
const WORDMARK = 'ODSENS';

/** What the slab holds: a logo file, the `external` glyph, or the wordmark. */
type MarkKind = 'logo' | 'glyph' | 'wordmark';

function markKind(platform: PlatformMarkPlatform): MarkKind {
  if (platform === 'odsens') return 'wordmark';
  return platform === 'article' || platform === 'other' ? 'glyph' : 'logo';
}

export function PlatformMark({
  platform,
  size = 26,
  withWord = false,
  className,
}: PlatformMarkProps) {
  const word = PLATFORM_WORDS[platform];
  const kind = markKind(platform);
  const classes = className ? `${styles['platform-mark']} ${className}` : styles['platform-mark'];
  return (
    <span className={classes}>
      <span
        className={styles['platform-mark-slab']}
        data-size={size}
        {...(kind === 'logo' ? {} : { 'data-kind': kind })}
        {...(withWord ? { 'aria-hidden': true } : { role: 'img', 'aria-label': word })}
      >
        {kind === 'wordmark' ? (
          WORDMARK
        ) : kind === 'glyph' ? (
          <Icon name="external" size={16} />
        ) : (
          <Image
            src={`/brand/marks/${platform}.svg`}
            alt=""
            width={16}
            height={16}
            unoptimized
            className={styles['platform-mark-logo']}
          />
        )}
      </span>
      {withWord ? word : null}
    </span>
  );
}
