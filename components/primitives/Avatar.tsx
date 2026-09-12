import Image from 'next/image';
import styles from './Avatar.module.css';

/**
 * Avatar — square picture with a 2px white border (the card/button outline width — ADR-0035 D2),
 * never round (DESIGN.md §3, §5 Nav/Comment bubble, §11.1 Profile menu; 03 §2.2 `Avatar`). No picture → `--slab-sunk` square with 2px `--line`
 * and the first character of `alt` in Bungee (ADR-0002 #48), or `?` when `fallback="question"`.
 * Pixel art stays crisp: `image-rendering: pixelated` (01 INV-64).
 */
export type AvatarProps = {
  src: string | null;
  alt: string;
  size: 28 | 34 | 40 | 56 | 88 | 104;
  /** Banned composer / Anonymous rows: opacity .5. */
  dim?: boolean;
  fallback?: 'initial' | 'question';
  /**
   * `'none'` drops the white outline: the crown **site mark** in the Nav / Admin header is a logo,
   * not a person's picture (ADR-0038 D2; DESIGN.md v1.9 §5 Nav, §9 Admin). People keep the frame.
   */
  frame?: 'outline' | 'none';
  className?: string;
};

export function Avatar({
  src,
  alt,
  size,
  dim = false,
  fallback = 'initial',
  frame = 'outline',
  className,
}: AvatarProps) {
  const classes = className ? `${styles.avatar} ${className}` : styles.avatar;
  const flags = {
    ...(dim ? { 'data-dim': '' } : {}),
    ...(frame === 'none' ? { 'data-frame': 'none' } : {}),
  };

  if (src) {
    return (
      <span className={classes} data-size={size} {...flags}>
        <Image
          className={styles['avatar-picture']}
          src={src}
          alt={alt}
          width={size}
          height={size}
          sizes={`${size}px`}
          // Static pixel-art brand files are served as-is: one downscale (80px source → the 36px content box
          // inside the 2px border at size 40) instead of the optimizer's 80→48→40 double resample (01 INV-64).
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
      data-fallback={fallback}
      {...flags}
    >
      <span className={styles['avatar-glyph']} aria-hidden="true">
        {glyph}
      </span>
    </span>
  );
}
