import { SectionTitle, sectionTitleId } from '@/components/primitives/SectionTitle';
import { MentionCard } from '@/components/seen-on/MentionCard';
import type { MentionCardData } from '@/lib/mentions';
import styles from './SeenOnRow.module.css';

/**
 * SeenOnRow — DESIGN.md §12.2 "Project detail — a SEEN ON row between VERSIONS & FILES and
 * COMMENTS: section title + mention count in Silkscreen, 2-up mention cards"; 03 §2.8 `SeenOnRow`
 * row; 02 §2.3 item 5; 00 S1.8.AC2 / AC3; ADR-0045 D18. Server Component; the cards are the
 * client `MentionCard` (no footer strip here — the page already is the project).
 *
 * `<section aria-labelledby>` pointing at the `SectionTitle` heading (`h2`, like the page's other
 * sections). The count beside it reads `N MENTIONS` — `1 MENTION` for one (03 writes the plural
 * only; a singular noun is the `formatReachLine` rule, T-UNIT-9) — and is spoken inside the
 * heading. Cards in a `<ul>`, 2-up, 1-up on phones (DESIGN.md §6 breakpoints). Order is the
 * caller's: featured first, then newest (`projectMentions`).
 *
 * No mentions → renders NOTHING: no heading, no section, no empty state (§12.1; AC3).
 */
export type SeenOnRowProps = {
  mentions: MentionCardData[];
  className?: string;
};

const TITLE = 'SEEN ON';

export function SeenOnRow({ mentions, className }: SeenOnRowProps) {
  if (mentions.length === 0) return null;

  const classes = className ? `${styles['seen-on-row']} ${className}` : styles['seen-on-row'];
  return (
    <section aria-labelledby={sectionTitleId(TITLE)} className={classes}>
      <SectionTitle
        count={{ value: mentions.length, word: mentions.length === 1 ? 'MENTION' : 'MENTIONS' }}
      >
        {TITLE}
      </SectionTitle>
      <ul className={styles['seen-on-row-list']}>
        {mentions.map((mention) => (
          <li key={mention.id} className={styles['seen-on-row-item']}>
            <MentionCard mention={mention} />
          </li>
        ))}
      </ul>
    </section>
  );
}
