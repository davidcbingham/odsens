import { VideoFacade } from '@/components/videos/VideoFacade';
import { relativeTime } from '@/lib/format/date';
import { formatCount } from '@/lib/format/number';
import type { VideoCardData } from '@/lib/videos';
import styles from './VideoCard.module.css';

/**
 * VideoCard — DESIGN.md §6.1 "Latest videos (2-up)", §6.4 "Grid of older videos below", §11.5
 * "Long-form grid keeps its layout"; 03 §2.6 `VideoCard` row. Server Component wrapping the client
 * `VideoFacade variant="card"` (16:9; play block 56px — DESIGN.md §12.7, ADR-0043 D7).
 *
 * `<article>`; title `<h3>` Bungee 17px `--chalk`, 2-line clamp that always HOLDS two line boxes
 * (a one-line title and a fallback-font wrap take the same height — no shift when the webfont
 * swaps in, and a row of cards keeps its meta lines level); meta 13px `--mute-dim` = relative date
 * · views via `lib/format/*`. A row with no view count (RSS-only, 04 §3.3) shows the date alone —
 * never "0 views". The facade button is the only interactive element. Slab `--slab`, 2px
 * `--line-soft` outline; hover / focus-within `--indigo-lift` outline. No `overflow: hidden` here:
 * the facade's gold focus ring draws around the thumbnail, past the card's own edge.
 *
 * `variant`: `grid` = the `/videos` MORE VIDEOS grid (3 / 2 / 1-up — the page owns the columns),
 * `home` = Home "Latest videos" 2-up. Same card; the value lands on `data-variant` (03 C-10) for
 * the parent's layout. Rendered at ISR time, so the date is the cache's — deterministic for any
 * video older than a week (`relativeTime` prints the absolute date from there).
 */
export type VideoCardProps = {
  video: VideoCardData;
  variant: 'grid' | 'home';
  className?: string;
};

export function VideoCard({ video, variant, className }: VideoCardProps) {
  const classes = className ? `${styles['video-card']} ${className}` : styles['video-card'];
  return (
    <article className={classes} data-variant={variant}>
      <VideoFacade
        className={styles['video-card-facade']}
        youtubeId={video.youtubeId}
        title={video.title}
        thumbnailUrl={video.thumbnailUrl}
        durationSeconds={video.durationSeconds}
        variant="card"
      />
      <div className={styles['video-card-body']}>
        <h3 className={styles['video-card-title']}>{video.title}</h3>
        <p className={styles['video-card-meta']}>
          <time dateTime={video.publishedAt}>{relativeTime(video.publishedAt)}</time>
          {video.viewCount === null ? null : ` · ${formatCount(video.viewCount)} views`}
        </p>
      </div>
    </article>
  );
}
