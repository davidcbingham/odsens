import { renderMarkdown, type MarkdownVariant } from '@/lib/markdown';
import styles from './Markdown.module.css';

/**
 * Markdown — DESIGN.md §6 #3 ABOUT (h2/h3 Bungee gold, body 17px, lists, NOTE callout),
 * §12.5 changelog; 03 §2.2 `Markdown`. Server component: thin wrapper over `lib/markdown.ts`
 * `renderMarkdown()` (01 INV-65); imports nothing from `react-markdown`/`remark-gfm` itself,
 * so they never enter a client bundle (03 C-18). Sanitisation, link attrs, heading demotion
 * and the `> NOTE:` → `NoteCallout` mapping all live in `lib/markdown.ts` (05 T-UNIT-14);
 * this file owns only the wrapping element, the `data-variant` attribute (03 C-10) and the
 * module CSS.
 */
export type MarkdownProps = {
  source: string;
  variant?: MarkdownVariant;
  className?: string;
};

export function Markdown({ source, variant = 'about', className }: MarkdownProps) {
  const classes = className ? `${styles.markdown} ${className}` : styles.markdown;
  return (
    <div className={classes} data-variant={variant}>
      {renderMarkdown(source, variant)}
    </div>
  );
}
