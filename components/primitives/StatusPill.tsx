import styles from './StatusPill.module.css';

/**
 * StatusPill — DESIGN.md §5 Admin table "worded pill" + §12.7 #47 fill map (O-4, ADR-0002 #47);
 * 03 §2.2 `StatusPill`, §9 (`--plugin-wash`). Shared (no directive). The text IS the status
 * word — statuses are spelled out, never colour alone (03 C-26). Silkscreen 11px, radius 0;
 * `<span>`, not interactive. `live` and `published` both read LIVE (03 fill map).
 */
export const STATUS_PILL_STATUSES = [
  'held',
  'live',
  'hidden',
  'featured',
  'draft',
  'published',
  'new',
  'replied',
  'closed',
  'not-set',
  'suggested',
  'first-comment',
  'stale',
  'failed',
] as const;

export type StatusPillStatus = (typeof STATUS_PILL_STATUSES)[number];

export type StatusPillProps = {
  status: StatusPillStatus;
  className?: string;
};

/** The worded half (03 §2.2 fill map, words verbatim). */
const STATUS_WORDS: Record<StatusPillStatus, string> = {
  held: 'HELD',
  live: 'LIVE',
  hidden: 'HIDDEN',
  featured: 'FEATURED',
  draft: 'DRAFT',
  published: 'LIVE',
  new: 'NEW',
  replied: 'REPLIED',
  closed: 'CLOSED',
  'not-set': 'NOT SET',
  suggested: 'SUGGESTED',
  'first-comment': 'FIRST COMMENT',
  stale: 'STALE',
  failed: 'FAILED',
};

export function StatusPill({ status, className }: StatusPillProps) {
  const classes = className ? `${styles['status-pill']} ${className}` : styles['status-pill'];
  return (
    <span className={classes} data-status={status}>
      {STATUS_WORDS[status]}
    </span>
  );
}
