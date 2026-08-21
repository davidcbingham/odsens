import { isDev } from '@/lib/env/public';
import styles from './PixelLabel.module.css';

/**
 * PixelLabel — Silkscreen micro-label (DESIGN.md §2 "Pixel label"; 03 §2.2 `PixelLabel`).
 * Uppercase, letter-spaced, 10–12px; ≥11px when informational; never a sentence (≤5 words).
 * Tag variants (CREATOR, MOD, SIGNED IN, NOTE, …) are `tone` + `fill`.
 */
export type PixelLabelProps = {
  children: string;
  size?: 10 | 11 | 12;
  tone?: 'mute-dim' | 'gold' | 'emerald' | 'chalk' | 'gold-ink';
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3';
  /** Carries information the user needs (counts, HELD FOR REVIEW) — forces ≥11px. */
  informational?: boolean;
  fill?: 'gold' | 'indigo-wash' | 'neutral';
  className?: string;
};

const MAX_WORDS = 5;

function assertPixelLabel(text: string, size: number, informational: boolean): void {
  if (!isDev) return;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words > MAX_WORDS) {
    throw new Error(
      `PixelLabel is never a sentence: "${text}" has ${words} words (max ${MAX_WORDS}).`,
    );
  }
  if (informational && size < 11) {
    throw new Error(`PixelLabel size 10 is not allowed for informational labels ("${text}").`);
  }
}

export function PixelLabel({
  children,
  size = 11,
  tone,
  as: Tag = 'span',
  informational = false,
  fill,
  className,
}: PixelLabelProps) {
  assertPixelLabel(children, size, informational);
  const effectiveSize = informational && size < 11 ? 11 : size;
  const classes = className ? `${styles['pixel-label']} ${className}` : styles['pixel-label'];
  return (
    <Tag className={classes} data-size={effectiveSize} data-tone={tone} data-fill={fill}>
      {children}
    </Tag>
  );
}
