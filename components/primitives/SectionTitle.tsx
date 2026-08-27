import { Button } from '@/components/primitives/Button';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import styles from './SectionTitle.module.css';

/**
 * SectionTitle — DESIGN.md §2 "Section title" (24–26px Bungee, gold, uppercase); 03 §2.2
 * `SectionTitle`. Shared (no directive; also rendered inside the client `CommentThread`, S1.4).
 * Optional `PixelLabel` count beside the heading ("14 TOTAL" — 11px, informational) and an
 * optional right-aligned ghost `Button` action ("All mentions →", 03 §2.7).
 *
 * A11y (03 §2.2): the heading stays in document order (`as`, default `h2`); the count is read
 * INSIDE the heading as sr text "14 total" while the visible `PixelLabel` is decorative
 * (`aria-hidden`), so "COMMENTS · 14 TOTAL" announces once, as one heading. The heading carries
 * a deterministic id derived from its text (the `GetItPanel` per-slug precedent — Server
 * Component, no `useId`) so parents can point `<section aria-labelledby>` at it via
 * `sectionTitleId()`.
 */
export type SectionTitleProps = {
  /** The title text (Bungee renders it uppercase). */
  children: string;
  count?: { value: number; word: string /* TOTAL, MENTIONS */ };
  as?: 'h2' | 'h3';
  /** Right-aligned ghost link (e.g. "All mentions" — the ghost `Button` adds the `→`). */
  action?: { label: string; href: string };
  className?: string;
};

/** Deterministic heading id for `<section aria-labelledby>` parents. */
export function sectionTitleId(children: string): string {
  const slug = children
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `section-title-${slug}`;
}

export function SectionTitle({
  children,
  count,
  as: Heading = 'h2',
  action,
  className,
}: SectionTitleProps) {
  const classes = className ? `${styles['section-title']} ${className}` : styles['section-title'];
  return (
    <div className={classes}>
      <Heading id={sectionTitleId(children)} className={styles['section-title-heading']}>
        {children}
        {count ? (
          <span className="visually-hidden">{` ${count.value} ${count.word.toLowerCase()}`}</span>
        ) : null}
      </Heading>
      {count ? (
        <span aria-hidden="true">
          <PixelLabel informational tone="mute-dim">
            {`${count.value} ${count.word}`}
          </PixelLabel>
        </span>
      ) : null}
      {action ? (
        <Button variant="ghost" href={action.href} className={styles['section-title-action']}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
