import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StatTile } from '@/components/primitives/StatTile';
import { SeenOnGrid, SeenOnGridView } from '@/components/seen-on/SeenOnGrid';
import { getSeenOnMentions } from '@/lib/data/mentions';
import styles from './page.module.css';

/**
 * `/seen-on` — S1.8 replaces the S0 placeholder (02 route row `/seen-on`, §2.6, RP-16; 00
 * S1.8.AC2 / AC6 / AC8; DESIGN.md §12.2 "Seen on page — reach totals as three stat tiles, filter
 * bar (ALL + platform counts, project select at right), 3-up mention grid tagged with their
 * project, newest first", §12.7 #62 empty filter; ADR-0045 D15 / D20). ISR(600; mentions,
 * projects): one read through `lib/data/mentions.ts` on the cookie-less anon client (01 INV-09 /
 * INV-15; tags from the data cache — `createMention` / `updateMention` / `refreshMentions`
 * revalidate `mentions`, a project hide or retitle revalidates `projects`, 02 RP-22 / RP-23). The
 * page tree never reads `searchParams`, `cookies()` or `headers()` (02 RP-02 / RP-03, 01 INV-38):
 * `?platform=` / `?project=` belong to the `SeenOnGrid` client island inside the `<Suspense>`
 * boundary below, whose FALLBACK is the same view with no filter — the bar and every card are in
 * the ISR HTML and the resolved island changes nothing on an unfiltered visit.
 *
 * Sections per 02 §2.6: `h1` SEEN ON → three `StatTile`s, the reach totals over every published
 * mention (`VIEWS` = Σ `view_count`, `MENTIONS` = how many, `CREATORS` = distinct creator names;
 * compact numbers via `StatTile`; 3-across, 2-up on phones with the third tile full width — shown
 * at every width, no subline: 02 §2.6 is the binding copy, not the pass-3 artboard's) → the
 * island: `FilterBar` (ALL + one button per platform that has a mention, project `Select` with
 * "About OddSense" for the general ones) and the 3 / 2 / 1-up `MentionCard` grid, newest first,
 * every card with its project footer strip (or the ODSENS chip). A filter that matches nothing →
 * "NOTHING HERE" / "Try another filter." (inside the island).
 *
 * Zero published mentions → the title only: no tiles, no bar, no grid, no empty state (02 §2.6;
 * DESIGN.md §12.1 "No mentions → the surface doesn't render"). YouTube cards are facades until
 * clicked (01 INV-57); no other platform's thumbnail is ever requested (ADR-0002 #33).
 *
 * Metadata per 02 RP-05 / RP-06: title `Seen on` (renders `Seen on — odsens`), canonical
 * `/seen-on`; description + OG default inherit from `app/layout.tsx`. Loading: `loading.tsx`
 * (3 tile shells + 6 card shells — 02 §6, RP-10).
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Seen on',
  alternates: { canonical: '/seen-on' },
};

export default async function SeenOnPage() {
  const { mentions, reach } = await getSeenOnMentions();

  return (
    <section className={styles['seen-on']}>
      <h1 className={styles['seen-on-title']}>SEEN ON</h1>
      {mentions.length === 0 ? null : (
        <>
          <div className={styles['seen-on-tiles']}>
            <StatTile label="VIEWS" value={reach.views} />
            <StatTile label="MENTIONS" value={reach.videos} />
            <StatTile label="CREATORS" value={reach.creators} />
          </div>
          {/* RP-02: the island reads the URL via useSearchParams — Suspense boundary required on
              an ISR page. The fallback is the SAME markup with no filter applied. */}
          <Suspense fallback={<SeenOnGridView mentions={mentions} query="" />}>
            <SeenOnGrid mentions={mentions} />
          </Suspense>
        </>
      )}
    </section>
  );
}
