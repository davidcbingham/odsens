import type { Metadata } from 'next';
import styles from './page.module.css';

/**
 * `/how-comments-work` — DESIGN.md §12.5 (pass-3 "How comments work page" frame); 02 §1.1
 * ISR(600; —), no data. Four short Bungee-headed blocks: SIGN IN · FIRST COMMENT · THE RULES ·
 * LEAVING, with the handle guidance line and the Google age-rules line (05 T-E2E-13; 00 S1.1.AC7).
 * Linked from the Footer "Site" column.
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'How comments work',
  description: 'Sign in with Google, pick a handle, say something. That is most of it.',
  alternates: { canonical: '/how-comments-work' },
};

const BLOCKS: { id: string; title: string; lines: string[] }[] = [
  {
    id: 'sign-in',
    title: 'SIGN IN',
    lines: [
      'Google account, then you pick a handle. The handle is all anyone sees.',
      "Sign-in needs a Google account; Google's age rules apply.",
      "Handles are made-up names. Don't use your real one — nobody here needs to know it, including us.",
    ],
  },
  {
    id: 'first-comment',
    title: 'FIRST COMMENT',
    lines: ['It may wait for approval. Usually quick.'],
  },
  {
    id: 'the-rules',
    title: 'THE RULES',
    lines: ["Don't be rude. Don't spam links. That's most of it."],
  },
  {
    id: 'leaving',
    title: 'LEAVING',
    lines: ['Delete your account whenever. Your comments go with it.'],
  },
];

export default function HowCommentsWorkPage() {
  return (
    <article className={styles['how-comments-work']}>
      <h1 className={styles['how-comments-work-title']}>HOW COMMENTS WORK</h1>
      {BLOCKS.map((block) => (
        <section
          key={block.id}
          className={styles['how-comments-work-block']}
          aria-labelledby={block.id}
        >
          <h2 id={block.id} className={styles['how-comments-work-h2']}>
            {block.title}
          </h2>
          {block.lines.map((line) => (
            <p key={line} className={styles['how-comments-work-body']}>
              {line}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
