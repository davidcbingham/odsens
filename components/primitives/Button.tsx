import Link from 'next/link';
import type { MouseEventHandler, ReactNode } from 'react';
import styles from './Button.module.css';

/**
 * Button — DESIGN.md §5 (primary / secondary / ghost + gold variant), §11.4 (gold-ink);
 * 03 §2.2 `Button` row. Shared (no directive): renders `<a>` via next/link when `href` is set,
 * otherwise a native `<button>`. `pending` = disabled look + `aria-busy="true"`, label
 * unchanged, no spinner (ADR-0002 #46). Every size is a ≥44px target (03 C-24).
 */
export type ButtonProps = {
  variant: 'primary' | 'secondary' | 'ghost' | 'gold' | 'gold-ink';
  size?: 'md' | 'sm';
  href?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  pending?: boolean;
  /** Ghost `→` suffix (default true for ghost, ignored otherwise). */
  arrow?: boolean;
  children: ReactNode;
  className?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
};

export function Button({
  variant,
  size = 'md',
  href,
  type = 'button',
  disabled = false,
  pending = false,
  arrow = true,
  children,
  className,
  onClick,
}: ButtonProps) {
  const classes = className ? `${styles.button} ${className}` : styles.button;
  const showArrow = variant === 'ghost' && arrow;
  const content = (
    <>
      <span className={styles['button-label']}>{children}</span>
      {showArrow ? (
        <span className={styles['button-arrow']} aria-hidden="true">
          →
        </span>
      ) : null}
    </>
  );

  if (typeof href === 'string') {
    // Links have no disabled state (03 `Button` row: `disabled` is the native attribute on <button>).
    return (
      <Link href={href} className={classes} data-variant={variant} data-size={size}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      className={classes}
      data-variant={variant}
      data-size={size}
      disabled={disabled || pending}
      aria-busy={pending ? 'true' : undefined}
      {...(pending ? { 'data-pending': '' } : {})}
      onClick={onClick}
    >
      {content}
    </button>
  );
}
