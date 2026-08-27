import { Button } from '@/components/primitives/Button';
import styles from './EmptyState.module.css';

/**
 * EmptyState — DESIGN.md §11.7 Empty states ("Each is one Bungee line, one mute line, at most
 * one action."); 03 §2.2 `EmptyState`. Shared (no directive; also rendered inside the client
 * `CommentThread`): slab `--slab`, 2px `--line-soft`, 28px padding; title is a heading at the
 * right level (`as` prop, default `h2`). Copy is passed by the page (the strings live in
 * 02 / DESIGN.md §11.7 — e.g. /projects "NOTHING MATCHES" / "Try fewer filters." → Clear
 * filters, 05 T-E2E-2); the component enforces the shape (`action` is a single object,
 * never an array).
 */
export type EmptyStateProps = {
  /** Bungee, uppercase. */
  title: string;
  line: string;
  action?: {
    label: string;
    href?: string;
    onClick?: never;
    variant?: 'primary' | 'ghost';
  };
  as?: 'h2' | 'h3';
  className?: string;
};

export function EmptyState({
  title,
  line,
  action,
  as: Heading = 'h2',
  className,
}: EmptyStateProps) {
  const classes = className ? `${styles['empty-state']} ${className}` : styles['empty-state'];
  return (
    <div className={classes}>
      <Heading className={styles['empty-state-title']}>{title}</Heading>
      <p className={styles['empty-state-line']}>{line}</p>
      {action ? (
        <Button variant={action.variant ?? 'ghost'} href={action.href}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
