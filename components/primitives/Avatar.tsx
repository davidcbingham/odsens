import Image from 'next/image';
import styles from './Avatar.module.css';

/**
 * Avatar — square picture with a white border, never round (DESIGN.md §3, §5 Nav/Comment bubble,
 * §11.1 Profile menu; 03 §2.2 `Avatar`). No picture → `--slab-sunk` square with 2px `--line`
 * and the first character of `alt` in Bungee (ADR-0002 #48), or `?` when `fallback="question"`.
 * Pixel art stays crisp: `image-rendering: pixelated` (01 INV-64).
 */
export type AvatarProps = {
  src: string | null;
  alt: string;
  size: 28 | 34 | 40 | 56 | 88 | 104;
  /** Border width in px (default 3; comments pass 2). */
  border?: 2 | 3;
  /** Banned composer / Anonymous rows: opacity .5. */
  dim?: boolean;
  fallback?: 'initial' | 'question';
  className?: string;
};

export function Avatar({
  src,
  alt,
  size,
  border = 3,
  dim = false,
  fallback = 'initial',
  className,
}: AvatarProps) {
  const classes = className ? `${styles.avatar} ${className}` : styles.avatar;
  const flags = dim ? { 'data-dim': '' } : {};

  if (src) {
    return (
      <span className={classes} data-size={size} data-border={border} {...flags}>
        <Image
          className={styles['avatar-picture']}
          src={src}
          alt={alt}
          width={size}
          height={size}
          sizes={`${size}px`}
          // Static pixel-art brand files are served as-is: one downscale (80px source → the 34px content box
          // inside the 3px border at size 40) instead of the optimizer's 80→48→40 double resample (01 INV-64).
          // User avatars (S1.1) stay optimized.
          unoptimized={src.startsWith('/brand/')}
        />
      </span>
    );
  }

  const glyph = fallback === 'question' ? '?' : (Array.from(alt.trim())[0] ?? '?');
  return (
    <span
      className={classes}
      role="img"
      aria-label={alt}
      data-size={size}
      data-border={border}
      data-fallback={fallback}
      {...flags}
    >
      <span className={styles['avatar-glyph']} aria-hidden="true">
        {glyph}
      </span>
    </span>
  );
}
