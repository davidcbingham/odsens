/**
 * lib/format/project.ts — project-type glyph/word and source colour/word maps
 * (05 T-UNIT-31 `typeGlyph`, T-UNIT-32 `sourceColor`; DESIGN.md §4 glyphs, §11.1 source
 * colours "always with a swatch AND the word"; 03 §2.2 `TypeBadge` / `SourceSwatch`).
 *
 * Pure and client-safe (no zod, no server imports — ADR-0008). Meaning never rides on colour
 * alone (C-26): every type has a glyph AND a word, every source a colour AND a word.
 * `sourceColor` returns token NAMES (`--emerald`), never hex — tokens-only CSS (C-08).
 */
import type { IconName } from '@/components/primitives/Icon';

/** `project_type` enum values (04 "Shared" `PROJECT_TYPE`; docs/data-model). */
export const PROJECT_TYPES = ['mod', 'datapack', 'resourcepack', 'plugin'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

/** Download sources with a fixed app-wide colour (DESIGN.md §11.1 Flat bar chart). */
export const DOWNLOAD_SOURCES = ['modrinth', 'curseforge', 'direct'] as const;
export type DownloadSource = (typeof DOWNLOAD_SOURCES)[number];

/** DESIGN.md §4: mod = square, datapack = diamond, resource pack = triangle, plugin = circle. */
const TYPE_GLYPHS: Record<ProjectType, IconName> = {
  mod: 'square',
  datapack: 'diamond',
  resourcepack: 'triangle',
  plugin: 'circle',
};

/** The worded half of the badge (03 §2.2 `TypeBadge`, verbatim words). */
const TYPE_WORDS: Record<ProjectType, string> = {
  mod: 'MOD',
  datapack: 'DATAPACK',
  resourcepack: 'RESOURCE PACK',
  plugin: 'PLUGIN',
};

/** DESIGN.md §11.1: Modrinth `--emerald` · CurseForge `--orange` · direct/odsens `--indigo-lift`. */
const SOURCE_COLORS: Record<DownloadSource, `--${string}`> = {
  modrinth: '--emerald',
  curseforge: '--orange',
  direct: '--indigo-lift',
};

/** The worded half of the swatch (03 §2.2 `SourceSwatch`: Modrinth / CurseForge / Direct). */
const SOURCE_WORDS: Record<DownloadSource, string> = {
  modrinth: 'Modrinth',
  curseforge: 'CurseForge',
  direct: 'Direct',
};

/** `Icon` glyph name for a project type (05 T-UNIT-31). */
export function typeGlyph(projectType: ProjectType): IconName {
  return TYPE_GLYPHS[projectType];
}

/** Badge word for a project type — the glyph's mandatory companion (C-26). */
export function typeWord(projectType: ProjectType): string {
  return TYPE_WORDS[projectType];
}

/** Colour TOKEN NAME for a download source (05 T-UNIT-32) — use as `var(<token>)`. */
export function sourceColor(source: DownloadSource): string {
  return SOURCE_COLORS[source];
}

/** Swatch word for a download source — the colour's mandatory companion (C-26). */
export function sourceWord(source: DownloadSource): string {
  return SOURCE_WORDS[source];
}
