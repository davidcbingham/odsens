import { SectionTitle, sectionTitleId } from '@/components/primitives/SectionTitle';
import { MentionCard } from '@/components/seen-on/MentionCard';
import { ReachLine } from '@/components/seen-on/ReachLine';
import type { MentionCardData, ReachTotals } from '@/lib/mentions';
import styles from './InTheWildStrip.module.css';

/**
 * InTheWildStrip — DESIGN.md §12.2 "Home — an IN THE WILD strip after Featured projects: 3–4
 * featured mentions, the reach line, 'All mentions →'"; 03 §2.8 `InTheWildStrip` row; 02 §2.1
 * item 3; 00 S1.8.AC3 / AC4; ADR-0045 D19. Server Component; the cards are the client
 * `MentionCard` (no footer strip on Home).
 *
 * Order per 02 / 03: head — `SectionTitle` IN THE WILD with the ghost action "All mentions"
 * (`/seen-on`; the ghost `Button` draws the `→`) → the cards → `ReachLine`. `featured` is the
 * caller's list (`featuredMentions`: featured, by `sort_order`, at most 4 — a longer list is cut
 * here too); `reach` is the totals over ALL published mentions, never the featured subset.
 *
 * Grid: 4 columns when there are four cards, otherwise 3 — one or two cards keep a third of the
 * row and never stretch (the count lands on `data-count`; a column count is not an inline style,
 * 03 C-05). 2-up on tablets, 1-up on phones (DESIGN.md §6 breakpoints, the Featured grid's own).
 *
 * Nothing featured → renders NOTHING: no heading, no reach line, no empty state (§12.1; AC3).
 */
export type InTheWildStripProps = {
  /** Featured mentions in `sort_order` (3–4 by design; 1–2 render too). */
  featured: MentionCardData[];
  reach: ReachTotals;
  className?: string;
};

const TITLE = 'IN THE WILD';
const MAX_CARDS = 4;

export function InTheWildStrip({ featured, reach, className }: InTheWildStripProps) {
  const cards = featured.slice(0, MAX_CARDS);
  if (cards.length === 0) return null;

  const classes = className
    ? `${styles['in-the-wild-strip']} ${className}`
    : styles['in-the-wild-strip'];
  return (
    <section aria-labelledby={sectionTitleId(TITLE)} className={classes}>
      <SectionTitle
        action={{ label: 'All mentions', href: '/seen-on' }}
        className={styles['in-the-wild-strip-head']}
      >
        {TITLE}
      </SectionTitle>
      <ul className={styles['in-the-wild-strip-list']} data-count={cards.length}>
        {cards.map((mention) => (
          <li key={mention.id} className={styles['in-the-wild-strip-item']}>
            <MentionCard mention={mention} />
          </li>
        ))}
      </ul>
      <ReachLine views={reach.views} videos={reach.videos} creators={reach.creators} />
    </section>
  );
}
