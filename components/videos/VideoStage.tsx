'use client';

import { useSearchParams } from 'next/navigation';
import { UpNextList } from '@/components/videos/UpNextList';
import { VideoFacade } from '@/components/videos/VideoFacade';
import { relativeTime } from '@/lib/format/date';
import { formatCount } from '@/lib/format/number';
import { UP_NEXT_COUNT, youtubeWatchUrl, type VideoStageItem } from '@/lib/videos';
import styles from './VideoStage.module.css';

/**
 * VideoStage — DESIGN.md §6.4 Videos ("big embedded player, Bungee title, view/date meta, dry
 * blurb, 'Up next' list at right"); pass-3 Videos 1280 (grid 1.6fr / 1fr, gap 28); 03 §2.6
 * `VideoStage` row; 00 S1.6.AC4. Client island added by ADR-0043 D4: `/videos` is ISR and may not
 * read `searchParams` (02 RP-02 / RP-03, 01 INV-38), `UpNextList` takes `selectedId` as a prop and
 * the big player is a separate facade — so ONE island has to own the `?v=` selection. It never
 * fetches: the long-form list arrives as props (01 INV-09).
 *
 * Two exports, one view:
 *   `VideoStage`      reads `?v=` with `useSearchParams` — the page wraps it in `<Suspense>`.
 *                     The param is checked against `videos`; anything else (absent, a Short, a
 *                     hidden or unknown id) falls back to the newest video.
 *   `VideoStageView`  the same markup for a given `selectedId`, with no URL read — the page uses
 *                     it as the `<Suspense>` FALLBACK with the default selection, so the big
 *                     player is in the ISR HTML (02 SM-05, LCP) and the resolved island renders
 *                     identical markup: zero shift.
 *
 * Layout: big player (`VideoFacade variant="hero"`, 88px play block) + `<h2>` title + meta + blurb
 * + "Watch on YouTube", beside `UpNextList` = the first `UP_NEXT_COUNT` videos, the selected one
 * included (ADR-0043 D12). A `?v=` that names a MORE VIDEOS grid video swaps the player and
 * outlines no row. The hero is rendered with `key={youtubeId}`: picking a row remounts it, so a
 * playing video goes back to `idle` and no second iframe can appear (03 `UpNextList` Tests cell).
 *
 * No layout shift on a swap the user did not start (a direct `/videos?v=<id>` load resolves after
 * hydration): the title is a 2-line clamp, the meta line is one nowrap line, the blurb is a 3-line
 * clamp, and the text block under the player always holds the height of the tallest case (two
 * title lines + meta + three blurb lines) — every selection has the same height, in the webfont
 * and in the fallback, and the spare room sits at the bottom of the block, not between its lines. Below 600px the meta line and
 * the "Watch on YouTube" link stack as a column (never "it fits"). Focus is never moved here: on
 * an Up next pick it stays on the clicked row; on first render nothing takes it.
 *
 * `<time suppressHydrationWarning>`: the ISR HTML is older than hydration (`Comment` precedent).
 * The blurb is printed as a text node — upstream text, never Markdown or HTML.
 * `videos.length === 0` → renders nothing (the page shows the §11.7 empty state instead).
 */
export type VideoStageProps = {
  /** Visible long-form videos, newest first (Shorts never reach the stage — 00 S1.6.AC5). */
  videos: VideoStageItem[];
  className?: string;
};

export type VideoStageViewProps = VideoStageProps & {
  /** `youtubeId` of the video in the big player; unknown → the newest. */
  selectedId: string | null;
};

export function VideoStage({ videos, className }: VideoStageProps) {
  const selectedId = useSearchParams().get('v');
  return <VideoStageView videos={videos} selectedId={selectedId} className={className} />;
}

export function VideoStageView({ videos, selectedId, className }: VideoStageViewProps) {
  const selected = videos.find((video) => video.youtubeId === selectedId) ?? videos[0];
  if (selected === undefined) return null;

  const classes = className ? `${styles['video-stage']} ${className}` : styles['video-stage'];

  return (
    <div className={classes}>
      <div className={styles['video-stage-player']}>
        <VideoFacade
          key={selected.youtubeId}
          youtubeId={selected.youtubeId}
          title={selected.title}
          thumbnailUrl={selected.thumbnailUrl}
          durationSeconds={selected.durationSeconds}
          variant="hero"
        />
        <div className={styles['video-stage-text']}>
          <h2 className={styles['video-stage-title']}>{selected.title}</h2>
          <div className={styles['video-stage-meta']}>
            <p className={styles['video-stage-stats']}>
              <time dateTime={selected.publishedAt} suppressHydrationWarning>
                {relativeTime(selected.publishedAt)}
              </time>
              {selected.viewCount === null ? null : ` · ${formatCount(selected.viewCount)} views`}
            </p>
            <a
              className={styles['video-stage-watch']}
              href={youtubeWatchUrl(selected.youtubeId)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Watch on YouTube ↗<span className="visually-hidden"> (opens in new tab)</span>
            </a>
          </div>
          {selected.blurb === null ? null : (
            <p className={styles['video-stage-blurb']}>{selected.blurb}</p>
          )}
        </div>
      </div>
      <UpNextList videos={videos.slice(0, UP_NEXT_COUNT)} selectedId={selected.youtubeId} />
    </div>
  );
}
