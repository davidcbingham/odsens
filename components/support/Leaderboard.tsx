import { EmptyState } from '@/components/primitives/EmptyState';
import { FLAGS } from '@/lib/flags';
import styles from './Leaderboard.module.css';

/**
 * Leaderboard — DESIGN.md §12.4 Supporters leaderboard (empty state "NOBODY YET / Be first." +
 * the how-to line); 03 §2.9 `Leaderboard` row; 01 INV-74. Server Component.
 *
 * v1 (`FLAGS.leaderboard` false): the EMPTY STATE regardless of `rows` — there is no data source
 * until the Ko-fi webhook lands (S2.1 flips the flag and replaces this branch with the top-3 cards
 * + compact `LeaderboardRow` list, 03 §8). No amounts, no rows (00 S1.5b.AC2).
 */
export type LeaderboardRowData = {
  rank: number;
  /** `null` = Anonymous. */
  handle: string | null;
  avatarUrl: string | null;
  amount: number | null;
  showAmount: boolean;
};

export type LeaderboardProps = {
  rows: LeaderboardRowData[];
};

export const LEADERBOARD_HOW_TO =
  'Tip on Ko-fi with the same email as your Google sign-in, or put your handle in the message.';

export function Leaderboard({ rows }: LeaderboardProps) {
  // S2.1: `FLAGS.leaderboard && rows.length > 0` renders the live board here.
  const live = FLAGS.leaderboard && rows.length > 0;
  return (
    <section aria-labelledby="supporters" className={styles.leaderboard}>
      <h2 id="supporters" className={styles['leaderboard-title']}>
        SUPPORTERS
      </h2>
      {live ? null : (
        <EmptyState
          title="NOBODY YET"
          line="Be first."
          as="h3"
          className={styles['leaderboard-empty']}
        />
      )}
      <p className={styles['leaderboard-how-to']}>{LEADERBOARD_HOW_TO}</p>
    </section>
  );
}
