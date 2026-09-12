/**
 * tests/unit/format-project.test.ts — `lib/format/project.ts` `typeGlyph` (05 T-UNIT-31;
 * DESIGN.md §4 glyphs) and `sourceColor` (05 T-UNIT-32; DESIGN.md §11.1 source colours) plus
 * their mandatory word companions (C-26: meaning never rides on colour alone); the ADR-0037
 * pure helpers `modrinthListingUrl` (D6/D10 — the listing page from the id, the S1.2
 * `modrinthProjectUrl(slug)` case retired) and `projectMatchKey` (D8; 05 T-UNIT-50 — the
 * `/admin/projects` "Looks like the same project" key). Pure.
 */
import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_SOURCES,
  PROJECT_TYPES,
  modrinthListingUrl,
  projectMatchKey,
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

describe('modrinthListingUrl (ADR-0037 D6/D10; ADR-0034 D1)', () => {
  it('builds the type-neutral /project/<id> page from the Modrinth id, never our slug', () => {
    expect(modrinthListingUrl('sd000102')).toBe('https://modrinth.com/project/sd000102');
    expect(modrinthListingUrl('AANobbMI')).toBe('https://modrinth.com/project/AANobbMI');
  });

  it('URL-encodes anything outside the id alphabet (never an injectable path)', () => {
    expect(modrinthListingUrl('a/b?c')).toBe('https://modrinth.com/project/a%2Fb%3Fc');
  });
});

describe('T-UNIT-50 projectMatchKey (ADR-0037 D8; 00 S1.5a.AC7)', () => {
  it('T-UNIT-50 keys a slug and its title to the same lower-case alphanumerics', () => {
    expect(projectMatchKey('metal-pipe-mace')).toBe('metalpipemace');
    expect(projectMatchKey('Metal Pipe Mace')).toBe('metalpipemace');
    expect(projectMatchKey('metal_pipe_mace')).toBe('metalpipemace');
    expect(projectMatchKey('METAL-PIPE-MACE!')).toBe('metalpipemace');
  });

  it('T-UNIT-50 the suggestion rule: a modrinth row matches an odsens row on slug OR title', () => {
    const odsens = { slug: 'heavy-spear', title: 'Heavy Spear (Fabric)' };
    const keys = new Set([projectMatchKey(odsens.slug), projectMatchKey(odsens.title)]);
    expect(keys.has(projectMatchKey('heavy-spear'))).toBe(true); // slug ↔ slug
    expect(keys.has(projectMatchKey('Heavy Spear (Fabric)'))).toBe(true); // title ↔ title
    expect(keys.has(projectMatchKey('p-abc123'))).toBe(false); // the ADR-0034 last-resort slug never matches
  });

  it('T-UNIT-50 empty or symbol-only text keys to "" (never a match)', () => {
    expect(projectMatchKey('')).toBe('');
    expect(projectMatchKey('---')).toBe('');
    // Keep the numeric part: `1.21` and `121` are the same project name either way.
    expect(projectMatchKey('Pack 1.21')).toBe('pack121');
  });
});
