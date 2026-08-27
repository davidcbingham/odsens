/**
 * tests/unit/format-project.test.ts — `lib/format/project.ts` `typeGlyph` (05 T-UNIT-31;
 * DESIGN.md §4 glyphs) and `sourceColor` (05 T-UNIT-32; DESIGN.md §11.1 source colours) plus
 * their mandatory word companions (C-26: meaning never rides on colour alone). Pure.
 */
import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_SOURCES,
  PROJECT_TYPES,
  sourceColor,
  sourceWord,
  typeGlyph,
  typeWord,
} from '@/lib/format/project';

describe('T-UNIT-31 typeGlyph', () => {
  it.each([
    ['mod', 'square'],
    ['datapack', 'diamond'],
    ['resourcepack', 'triangle'],
    ['plugin', 'circle'],
  ] as const)('T-UNIT-31 %s → %s (DESIGN.md §4)', (type, glyph) => {
    expect(typeGlyph(type)).toBe(glyph);
  });

  it('T-UNIT-31 every enum value has a glyph and a word', () => {
    expect([...PROJECT_TYPES]).toEqual(['mod', 'datapack', 'resourcepack', 'plugin']);
    for (const type of PROJECT_TYPES) {
      expect(typeGlyph(type)).toBeTruthy();
      expect(typeWord(type).length).toBeGreaterThan(0);
    }
    expect(typeWord('resourcepack')).toBe('RESOURCE PACK'); // two words on the badge (03 §2.2)
  });
});

describe('T-UNIT-32 sourceColor', () => {
  it.each([
    ['modrinth', '--emerald'],
    ['curseforge', '--orange'],
    ['direct', '--indigo-lift'],
  ] as const)('T-UNIT-32 %s → %s (DESIGN.md §11.1)', (source, token) => {
    expect(sourceColor(source)).toBe(token);
  });

  it('T-UNIT-32 returns token names, never hex', () => {
    for (const source of DOWNLOAD_SOURCES) {
      const color = sourceColor(source);
      expect(color.startsWith('--')).toBe(true);
      expect(color).not.toMatch(/#|rgb/i);
      expect(sourceWord(source).length).toBeGreaterThan(0); // swatch AND word (C-26)
    }
  });

  it('T-UNIT-32 words are the DESIGN.md/03 spellings', () => {
    expect(sourceWord('modrinth')).toBe('Modrinth');
    expect(sourceWord('curseforge')).toBe('CurseForge');
    expect(sourceWord('direct')).toBe('Direct');
  });
});
