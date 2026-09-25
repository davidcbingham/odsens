import type { Metadata } from 'next';
import { FIND_ME } from '@/components/layout/Footer';
import { Avatar } from '@/components/primitives/Avatar';
import { Button } from '@/components/primitives/Button';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Icon } from '@/components/primitives/Icon';
import { PlatformMark } from '@/components/primitives/PlatformMark';
import { FeaturedHero } from '@/components/projects/FeaturedHero';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { TipPanel } from '@/components/projects/TipPanel';
import { InTheWildStrip } from '@/components/seen-on/InTheWildStrip';
import { VideoCard } from '@/components/videos/VideoCard';
import { getHomeMentions } from '@/lib/data/mentions';
import { getHomeFeatured, isNewProject, listPublishedProjects } from '@/lib/data/projects';
import { listVisibleVideos } from '@/lib/data/videos';
import { YOUTUBE_CHANNEL_URL, latestLongVideos } from '@/lib/videos';
import styles from './page.module.css';

/**
 * Home `/` — S1.2 hero + Featured 4-up, S1.8 IN THE WILD strip, S1.6 Latest videos + "Find me"
 * row (02 §2.1 #1–#4; 00 S1.2.AC7 = 00-O-3 DECIDED; 00 S1.6.AC6; 00 S1.8.AC3 / AC4; DESIGN.md
 * §6.1, §12.2). ISR(600) — reads via `lib/data/projects.ts`, `lib/data/mentions.ts` and
 * `lib/data/videos.ts` on the cookie-less anon client only (01 INV-09/INV-12/INV-15); the data
 * cache carries tags `projects`, `videos` and `mentions` (02 §5/RP-23 — `syncYoutube` and
 * `updateVideo` refresh this page through `videos`; `createMention`, `updateMention` and
 * `refreshMentions` through `mentions`).
 *
 * Sections in DOM order (02 §2.1): 1. `FeaturedHero` (`h1`; NEW badge computed HERE server-side
 * — `published_at` < 30 days, ADR-0002 #41 — so the clock never bakes into the data cache);
 * 2. Featured 4-up (`ProjectCard density="tight"`; next featured by `featured_order`, hero
 * excluded, NO back-fill when anything is featured); 3. `InTheWildStrip` (S1.8; ADR-0045 D19 —
 * `getHomeMentions` over the ONE cached `listPublishedMentions` read `/seen-on` and the project
 * page also use: up to four featured mentions by `sort_order`, then the `ReachLine` over ALL
 * published mentions, "All mentions →" to `/seen-on`; nothing featured → the component renders
 * nothing, no empty state — AC3; YouTube cards are facades, no other platform's thumbnail is ever
 * requested — ADR-0002 #33); 4. ONE row, two columns (pass-3 "Home desktop"; ADR-0041 D6 —
 * S1.6 fills the row the compact panel was holding; ADR-0043 D15):
 *   - videos column — `h2` LATEST VIDEOS + the "@OdSens on YouTube" channel link, then the two
 *     newest visible long videos as `VideoCard variant="home"` (`latestLongVideos` over the ONE
 *     cached `listVisibleVideos` read `/videos` also uses — ADR-0043 D6; hidden rows and Shorts
 *     never reach it, AC6/AC7). Every card is a facade: nothing is requested from YouTube or any
 *     Google host until a click (01 INV-57; thumbnails via `next/image`, 01 INV-54). No visible
 *     long video → the §11.7 empty state in this column, strings verbatim (03 G-05), `h3`.
 *   - side column — `h2` FIND ME over the three RP-13 links (`PlatformMark` 26 + word; the list
 *     is the footer's own `FIND_ME`, one source for the URLs; page-level arrangement per 03 C-21,
 *     no new component), then the compact `TipPanel` — static, ALWAYS rendered, exactly one on
 *     the page (00 S1.5b.AC4; T-E2E-49).
 * Below 900px the row is a single column in DOM order; below 600px the videos are 1-up and the
 * head row is a column (title over link — side by side they would fit in one font and not the
 * other). No prototype frame shows this row on a phone: the layout follows DESIGN.md §6
 * breakpoints and §3 gutters.
 *
 * Empty state (0 published, pre-first-sync): hero not rendered, intro strip + the compact
 * `TipPanel` render, Featured, IN THE WILD and the videos row hidden (02 §2.1 States; transient,
 * no design).
 *
 * Metadata per 02 RP-05: `title.absolute = 'odsens'`, canonical `/`; description + OG default
 * image inherit from `app/layout.tsx`. Loading: `app/(public)/loading.tsx` (03 G-01).
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: { absolute: 'odsens' },
  alternates: { canonical: '/' },
};

/** 02 §2.1 #1 intro strip line (DESIGN.md §6.1), shared with `FeaturedHero`'s rail. */
const INTRO_LINE = 'OddSense makes things for Minecraft.';

/** 02 §2.1 #4 / 00 S1.6.AC6 — "the two newest non-hidden, non-short videos". */
const LATEST_VIDEO_COUNT = 2;

export default async function HomePage() {
  const [{ hero, screenshot, featured }, projects, visibleVideos, wild] = await Promise.all([
    getHomeFeatured(),
    listPublishedProjects(),
    listVisibleVideos(),
    getHomeMentions(),
  ]);

  // 02 §2.1 States — empty (no published projects, pre-first-sync): hero not rendered, intro
  // strip + the compact TipPanel render; Featured, IN THE WILD and the videos row hidden
  // (transient; no design).
  if (hero === null) {
    return (
      <section className={styles['home-empty']}>
        <h1 className={styles['home-empty-title']}>ODSENS</h1>
        <div className={styles['home-intro']}>
          <Avatar src="/brand/avatar-80.png" alt="OddSense" size={56} />
          <p className={styles['home-intro-line']}>{INTRO_LINE}</p>
        </div>
        <TipPanel compact className={styles['home-tip']} />
      </section>
    );
  }

  const total = projects.length;
  const videos = latestLongVideos(visibleVideos, LATEST_VIDEO_COUNT);

  return (
    <div className={styles.home}>
      {/* The ONE page-side assembly step (03 C-17a / FeaturedHero doc): isNew at render time. */}
      <FeaturedHero
        project={{ ...hero, isNew: isNewProject(hero.publishedAt) }}
        screenshot={screenshot}
      />
      {featured.length > 0 ? (
        <section aria-labelledby="featured-projects" className={styles['home-featured']}>
          <div className={styles['home-featured-head']}>
            <h2 id="featured-projects" className={styles['home-featured-title']}>
              FEATURED PROJECTS
            </h2>
            {/* Ghost link per pass-3 Home mockup ("All 18 projects →"); arrow via Button ghost. */}
            <Button variant="ghost" href="/projects">
              All {total} {total === 1 ? 'project' : 'projects'}
            </Button>
          </div>
          <ul className={styles['home-featured-grid']}>
            {featured.map((project) => (
              <li key={project.slug} className={styles['home-featured-item']}>
                <ProjectCard project={project} density="tight" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {/* 02 §2.1 #3 — IN THE WILD (S1.8). Renders nothing when no mention is featured (AC3). */}
      <InTheWildStrip featured={wild.featured} reach={wild.reach} className={styles['home-wild']} />
      {/* 02 §2.1 #4 — videos column | Find me over the compact TipPanel (ADR-0041 D6). */}
      <div className={styles['home-latest']}>
        <section aria-labelledby="latest-videos" className={styles['home-videos']}>
          <div className={styles['home-videos-head']}>
            <h2 id="latest-videos" className={styles['home-row-title']}>
              LATEST VIDEOS
            </h2>
            {/* External, new tab — the `VideoStage` "Watch on YouTube ↗" recipe (`Button href`
                is a same-tab `next/link`; widening it would touch a 03 props cell). */}
            <a
              className={styles['home-videos-channel']}
              href={YOUTUBE_CHANNEL_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              @OdSens on YouTube ↗<span className="visually-hidden"> (opens in new tab)</span>
            </a>
          </div>
          {videos.length > 0 ? (
            <ul className={styles['home-videos-grid']}>
              {videos.map((video) => (
                <li key={video.id} className={styles['home-videos-item']}>
                  <VideoCard video={video} variant="home" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              as="h3"
              title="NO VIDEOS YET"
              line="They'll show up here when they exist."
              action={{ label: 'The YouTube channel', href: YOUTUBE_CHANNEL_URL }}
            />
          )}
        </section>
        <div className={styles['home-side']}>
          <section aria-labelledby="find-me" className={styles['home-find']}>
            <h2 id="find-me" className={styles['home-row-title']}>
              FIND ME
            </h2>
            <ul className={styles['home-find-list']}>
              {FIND_ME.map((link) => (
                <li key={link.href}>
                  <a
                    className={styles['home-find-row']}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <PlatformMark platform={link.platform} size={26} />
                    <span className={styles['home-find-word']}>{link.label}</span>
                    <span className="visually-hidden"> (opens in new tab)</span>
                    <Icon name="external" size={16} className={styles['home-find-glyph']} />
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <TipPanel compact />
        </div>
      </div>
    </div>
  );
}
