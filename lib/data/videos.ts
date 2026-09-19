/**
 * lib/data/videos.ts — the ISR read of `videos` (registry Modules `data/videos.ts`; 02 route row
 * `/videos` "Data `videos` (not hidden)" + §2.1 item 4 Home "Latest videos"; 02 RP-23 tag
 * `videos`; 00 S1.6.AC7 / AC10).
 *
 * Server-only; the cookie-less anon client (01 INV-15). RLS already keeps `hidden` rows from anon
 * (05 T-RLS-49) — the explicit `hidden = false` filter stays anyway: a hidden video must never
 * render publicly (00 S1.6.AC7), whatever a later policy edit does. ONE cached reader serves both
 * `/videos` and Home (ADR-0043 D6: one cache entry, one stale-while-revalidate window) under tag
 * `videos` with the pages' 600 s (01 INV-38); `syncYoutube` and `updateVideo` revalidate the tag
 * (02 RP-22). Render code never reads the clock inside the cache — dates leave as ISO strings
 * (03 C-19) and are formatted by the components.
 *
 * The prop shapes `VideoCardData` / `VideoStageItem` are DECLARED in the pure client-safe
 * `lib/videos.ts` (the `VideoFacade` / `UpNextList` / `VideoStage` client leaves may not import
 * `@/lib/data/*` — 01 INV-09 Check) and re-exported here with `export type`, so server callers
 * still import them from the data layer (ADR-0043 D6; 03 §2.6 `VideoCard` row). The long/Shorts
 * split, Home's newest two and the blurb rule are the pure helpers of the same module.
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { blurbFrom, type VideoStageItem } from '@/lib/videos';

export type { VideoCardData, VideoStageItem } from '@/lib/videos';

const REVALIDATE_S = 600;
const TAG_VIDEOS = 'videos';

const LIST_SELECT =
  'id, youtube_id, title, description, thumbnail_url, duration_seconds, published_at, view_count, is_short';

async function fetchVisibleVideos(): Promise<VideoStageItem[]> {
  const { data, error } = await createAnonClient()
    .from('videos')
    .select(LIST_SELECT)
    .eq('hidden', false)
    .order('published_at', { ascending: false })
    .order('youtube_id', { ascending: true });
  if (error) throw new Error(`lib/data/videos: list read failed — ${error.message}`);
  return data.map((row) => ({
    id: row.id,
    youtubeId: row.youtube_id,
    title: row.title,
    thumbnailUrl: row.thumbnail_url,
    durationSeconds: row.duration_seconds,
    publishedAt: new Date(row.published_at).toISOString(),
    viewCount: row.view_count,
    isShort: row.is_short,
    blurb: blurbFrom(row.description),
  }));
}

/**
 * Every visible video (`hidden = false`), newest first (`published_at` desc; `youtube_id` breaks a
 * tie so the order is stable between revalidations) — long-form and Shorts together; callers split
 * with `splitVideos` / `latestLongVideos` (`lib/videos.ts`). `blurb` is the first paragraph of
 * `videos.description` as plain text, `null` on RSS-only rows. Cached under tag `videos`
 * (01 INV-38; 02 RP-23).
 */
export const listVisibleVideos = unstable_cache(fetchVisibleVideos, ['data-videos-list'], {
  revalidate: REVALIDATE_S,
  tags: [TAG_VIDEOS],
});
