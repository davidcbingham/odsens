import { sourceWord, type DownloadSource } from '@/lib/format/project';
import styles from './SourceSwatch.module.css';

/**
 * SourceSwatch — DESIGN.md §11.1 Flat bar chart source colours, "always with a swatch AND
 * the word" (modrinth `--emerald` · curseforge `--orange` · direct `--indigo-lift`);
 * 03 §2.2 `SourceSwatch`. Shared (no directive). The 12px square swatch is `aria-hidden`;
 * the word is the text (03 C-26). Colour/word maps live in `lib/format/project.ts`
 * (T-UNIT-32 `sourceColor` — token names, never hex). Not interactive.
 */
export type SourceSwatchProps = {
  source: DownloadSource;
  /** Overrides the default word (Modrinth / CurseForge / Direct). */
  word?: string;
  className?: string;
};

export function SourceSwatch({ source, word, className }: SourceSwatchProps) {
  const classes = className ? `${styles['source-swatch']} ${className}` : styles['source-swatch'];
  return (
    <span className={classes} data-source={source}>
      <span className={styles['source-swatch-mark']} aria-hidden="true" />
      {word ?? sourceWord(source)}
    </span>
  );
}
