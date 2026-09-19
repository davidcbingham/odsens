import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Button } from '@/components/primitives/Button';
import { EmptyState } from '@/components/primitives/EmptyState';
import { SectionTitle, sectionTitleId } from '@/components/primitives/SectionTitle';
import { ShortsRow } from '@/components/videos/ShortsRow';
import { VideoCard } from '@/components/videos/VideoCard';
import { VideoStage, VideoStageView } from '@/components/videos/VideoStage';
import { listVisibleVideos } from '@/lib/data/videos';
import { UP_NEXT_COUNT, YOUTUBE_CHANNEL_URL, splitVideos } from '@/lib/videos';
import styles from './page.module.css';

/**
 * `/videos` — S1.6 replaces the S0 placeholder (02 route row `/videos`, RP-16; 00 S1.6.AC2–AC5,
 * AC7, AC8, AC10; DESIGN.md §6.4, §11.1 Video facade, §11.5 Shorts row, §11.7 empty). ISR(600;
 * videos): one read through `lib/data/videos.ts` `listVisibleVideos` on the cookie-less anon
 * client (01 INV-09 / INV-15; tag `videos` from the data cache — `syncYoutube` and `updateVideo`
 * revalidate it, 02 RP-22). The page tree never reads `searchParams`, `cookies()` or `headers()`
 * (02 RP-02 / RP-03, 01 INV-38): the `?v=` selection belongs to the `VideoStage` client island
 * inside the `<Suspense>` boundary below, whose FALLBACK is the same view for the default
 * selection — the big player is in the ISR HTML and the resolved island changes nothing
 * (ADR-0043 D4).
 *
 * Composition (ADR-0043 D12; pass-3 "Videos" 1280): head — `h1` VIDEOS, the dry subline and
 * "Subscribe on YouTube" (secondary `Button`) → `VideoStage` (big player + title / meta / blurb +
 * "Watch on YouTube" + `UpNextList`, the first `UP_NEXT_COUNT` long videos) → MORE VIDEOS, the
 * rest of the long videos as `VideoCard variant="grid"` (3 / 2 / 1-up) → `ShortsRow` last. Shorts
 * never enter the stage or the grid (AC5). Everything is a facade until clicked: nothing is
 * requested from YouTube or any Google host before that (01 INV-57; AC2) — thumbnails go through
 * `next/image` (01 INV-54).
 *
 * No VISIBLE video (an empty table, or every row hidden — AC7 / AC8; ADR-0043 D9) → the §11.7
 * empty state, strings verbatim (03 G-05), with the channel link as its one action.
 *
 * Metadata per 02 RP-05 / RP-06: title `Videos` (renders `Videos — odsens`), canonical `/videos`;
 * description + OG default inherit from `app/layout.tsx`. Loading: `loading.tsx` (player well +
 * 4 facade shells — 02 §6, RP-10). No comments here (ADR-0002 C21).
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Videos',
  alternates: { canonical: '/videos' },
};

const MORE_TITLE = 'MORE VIDEOS';

export default async function VideosPage() {
  const videos = await listVisibleVideos();

  if (videos.length === 0) {
    return (
      <section className={styles.videos}>
        <h1 className={styles['videos-title']}>VIDEOS</h1>
        <EmptyState
          title="NO VIDEOS YET"
          line="They'll show up here when they exist."
          action={{ label: 'The YouTube channel', href: YOUTUBE_CHANNEL_URL }}
        />
      </section>
    );
  }

  const { long, shorts } = splitVideos(videos);
  const more = long.slice(UP_NEXT_COUNT);

  return (
    <section className={styles.videos}>
      <div className={styles['videos-head']}>
        <div className={styles['videos-heading']}>
          <h1 className={styles['videos-title']}>VIDEOS</h1>
          <p className={styles['videos-line']}>Mostly me explaining bad decisions.</p>
        </div>
        <Button variant="secondary" href={YOUTUBE_CHANNEL_URL}>
          Subscribe on YouTube
        </Button>
      </div>

      {/* RP-02: the island reads the URL via useSearchParams — Suspense boundary required on an
          ISR page. The fallback is the SAME markup for the default selection (newest video). */}
      <Suspense fallback={<VideoStageView videos={long} selectedId={null} />}>
        <VideoStage videos={long} />
      </Suspense>

      {more.length === 0 ? null : (
        <section className={styles['videos-more']} aria-labelledby={sectionTitleId(MORE_TITLE)}>
          <SectionTitle>{MORE_TITLE}</SectionTitle>
          <ul className={styles['videos-grid']}>
            {more.map((video) => (
              <li key={video.id} className={styles['videos-grid-item']}>
                <VideoCard video={video} variant="grid" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <ShortsRow shorts={shorts} />
    </section>
  );
}
