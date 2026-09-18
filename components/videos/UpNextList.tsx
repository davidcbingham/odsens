'use client';

import type { MouseEvent } from 'react';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { VideoFacade } from '@/components/videos/VideoFacade';
import { relativeTime } from '@/lib/format/date';
import { spokenDuration } from '@/lib/format/duration';
import { formatCount } from '@/lib/format/number';
import type { VideoCardData } from '@/lib/videos';
import styles from './UpNextList.module.css';

/**
 * UpNextList — DESIGN.md §6.4 "'Up next' list at right (132px thumbs, selected item gets the
 * indigo-lift outline)", §11.1 "'Up next' rows … use the same facade"; 03 §2.6 `UpNextList` row,
 * O-7 (ADR-0002 #49); 00 S1.6.AC4. Client island (03 C-16a): selection only.
 *
 * `<nav aria-label="Up next"><ol>`; each row is ONE `<a href="?v=<youtubeId>">` — a click sets
 * `?v=` through `window.history.replaceState` — which Next syncs into `useSearchParams` with no
 * server round-trip and no scroll handling (02 RP-02: the URL is the state; the page never scrolls.
 * ADR-0043 D24: `router.replace({ scroll: false })` jumped a phone to the top once the ISR page had
 * been regenerated) — and the `VideoStage` parent swaps the big player. Rows never play inline: the 132px
 * thumb is `VideoFacade variant="upnext"`, which is presentational (ADR-0043 D5 — no button inside
 * the link, no `video_play`); its duration chip is decorative there, so the row adds the length as
 * sr text ("12 minutes 4 seconds" — 03 §2.6) after the title. Without JS the link is a plain reload of the default selection: an
 * ISR page never reads `searchParams` (02 RP-03; ADR-0043 D4).
 *
 * Selected row: `aria-current="true"` (03 C-13) → a 2px `--indigo-lift` edge drawn as an INSET
 * shadow, so the global 3px gold focus ring (an outline, 2px outside the row) stays whole and the
 * two read apart when a row is both selected and focused. Focus stays on the clicked row — it
 * persists across the swap (rows are keyed by id), so nothing has to be moved.
 *
 * Meta = date · views (`lib/format/*`); a row with no view count (RSS-only, 04 §3.3) shows the
 * date alone. `<time suppressHydrationWarning>`: the ISR HTML is older than hydration, so a video
 * under a week old may read differently on the two passes (`Comment` precedent). The title holds
 * two line boxes whatever its length, so a fallback-font wrap cannot move the rows (CLS).
 * `videos.length === 0` → renders nothing.
 */
export type UpNextListProps = {
  videos: VideoCardData[];
  /** `youtubeId` of the video in the big player; a value not in `videos` outlines no row. */
  selectedId: string;
  className?: string;
};

export function UpNextList({ videos, selectedId, className }: UpNextListProps) {
  if (videos.length === 0) return null;

  const hrefFor = (youtubeId: string): string => `?v=${encodeURIComponent(youtubeId)}`;

  const select = (event: MouseEvent<HTMLAnchorElement>, youtubeId: string) => {
    // Modified clicks (new tab / window) keep the browser's own behaviour.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    event.preventDefault();
    window.history.replaceState(null, '', hrefFor(youtubeId));
  };

  const classes = className ? `${styles['up-next-list']} ${className}` : styles['up-next-list'];

  return (
    <nav className={classes} aria-label="Up next">
      <span aria-hidden="true">
        <PixelLabel size={11} tone="mute-dim">
          UP NEXT
        </PixelLabel>
      </span>
      <ol className={styles['up-next-list-rows']}>
        {videos.map((video) => (
          <li key={video.id}>
            <a
              className={styles['up-next-list-row']}
              href={hrefFor(video.youtubeId)}
              aria-current={video.youtubeId === selectedId ? 'true' : undefined}
              onClick={(event) => select(event, video.youtubeId)}
            >
              <VideoFacade
                className={styles['up-next-list-thumb']}
                youtubeId={video.youtubeId}
                title={video.title}
                thumbnailUrl={video.thumbnailUrl}
                durationSeconds={video.durationSeconds}
                variant="upnext"
              />
              <span className={styles['up-next-list-body']}>
                <span className={styles['up-next-list-title']}>{video.title}</span>
                {video.durationSeconds === null ? null : (
                  <span className="visually-hidden">
                    {`, ${spokenDuration(video.durationSeconds)}, `}
                  </span>
                )}
                <span className={styles['up-next-list-meta']}>
                  <time dateTime={video.publishedAt} suppressHydrationWarning>
                    {relativeTime(video.publishedAt)}
                  </time>
                  {video.viewCount === null ? null : ` · ${formatCount(video.viewCount)} views`}
                </span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
