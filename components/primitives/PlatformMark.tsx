import Image from 'next/image';
import styles from './PlatformMark.module.css';

/**
 * PlatformMark — DESIGN.md §4 ("Third-party marks use official logos at official colours
 * inside a neutral slab"); 03 §2.2 `PlatformMark`. Shared (no directive). The logo sits in a
 * neutral `--plugin-wash` slab (26px, 24 compact), never recoloured; assets live at
 * `public/brand/marks/<platform>.svg` — neutral placeholders until Oliver's official-asset
 * PR (Q44). Without `withWord` the slab is `role="img" aria-label="<Platform>"`; with it the
 * word is the text and the slab is decorative (03 C-26). Not interactive.
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

export function PlatformMark({
  platform,
  size = 26,
  withWord = false,
  className,
}: PlatformMarkProps) {
  const word = PLATFORM_WORDS[platform];
  const classes = className ? `${styles['platform-mark']} ${className}` : styles['platform-mark'];
  return (
    <span className={classes}>
      <span
        className={styles['platform-mark-slab']}
        data-size={size}
        {...(withWord ? { 'aria-hidden': true } : { role: 'img', 'aria-label': word })}
      >
        <Image
          src={`/brand/marks/${platform}.svg`}
          alt=""
          width={16}
          height={16}
          unoptimized
          className={styles['platform-mark-logo']}
        />
      </span>
      {withWord ? word : null}
    </span>
  );
}
