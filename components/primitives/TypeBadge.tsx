import { Icon } from '@/components/primitives/Icon';
import { typeGlyph, typeWord, type ProjectType } from '@/lib/format/project';
import styles from './TypeBadge.module.css';

/**
 * TypeBadge — DESIGN.md §5 "Type badge" + §4 glyphs (mod = square, datapack = diamond,
 * resource pack = triangle, plugin = circle); 03 §2.2 `TypeBadge`. Shared (no directive).
 * Glyph + word, meaning never colour alone (03 C-26): the glyph is an `aria-hidden` `Icon`,
 * the word is the text. 11px 700 Space Grotesk, .06em tracking, 7×11px padding, radius 0;
 * fills per type (mod `--indigo-wash`/`--mod-badge-text` · datapack `--emerald-wash`/
 * `--emerald-soft` · resourcepack `--gold-wash`/`--gold-bright` · plugin `--plugin-wash`/
 * `--chalk`). Not interactive; glyph/word maps live in `lib/format/project.ts` (T-UNIT-31).
 */
export type TypeBadgeProps = {
  type: ProjectType;
  className?: string;
};

export function TypeBadge({ type, className }: TypeBadgeProps) {
  const classes = className ? `${styles['type-badge']} ${className}` : styles['type-badge'];
  return (
    <span className={classes} data-type={type}>
      <Icon name={typeGlyph(type)} size={16} className={styles['type-badge-glyph']} />
      {typeWord(type)}
    </span>
  );
}
