/**
 * tests/unit/skins.test.ts — `lib/skins.ts`, the pure client-safe half of the skins data layer
 * (S1.7; 03 §2.7; 02 route row `/skins`; 04 §2.3 kind `skin`; ADR-0048 D12). The S1.7 §8 row
 * gives these helpers no id of their own (ADR-R9) — each title carries the id of the test the
 * helper backs: T-E2E-7 (`?skin=` selection, the DOWNLOAD PNG href), T-E2E-38 (the `SkinForm`
 * slug pre-fill), T-ACT-76 (the saved file name). Pure — no DOM, no network, no clock (05 §1.1);
 * `server-only` is mocked by the unit setup file so the `lib/validation/slug.ts` twin can load.
 */
import { describe, expect, it } from 'vitest';
import {
  selectSkin,
  skinDownloadHref,
  skinFilename,
  slugifyName,
  type SkinCardData,
  type SkinStageItem,
} from '@/lib/skins';
import { slugify } from '@/lib/validation/slug';

/** The SEED-7 rows in reader order (`sort_order` asc: …0602 first) as `lib/data/skins.ts` maps them. */
function skin(n: 1 | 2, extra: Partial<SkinStageItem> = {}): SkinStageItem {
  const id = `00000000-0000-4000-8000-00000000060${String(n)}`;
  return {
    id,
    slug: n === 1 ? 'seed-skin-a' : 'seed-skin-b',
    name: n === 1 ? 'Seed Skin A' : 'Seed Skin B',
    model: n === 1 ? 'classic' : 'slim',
    textureUrl: `http://127.0.0.1:54321/storage/v1/object/public/skins/${id}/texture.png`,
    bustUrl:
      n === 1 ? `http://127.0.0.1:54321/storage/v1/object/public/skins/${id}/bust.png` : null,
    exclusive: n === 2,
    descriptionMd: n === 1 ? 'The one that started it.' : 'Slim arms. Big feelings.',
    downloads: 0,
    ...extra,
  };
}

const SEED_ORDER: SkinStageItem[] = [skin(2), skin(1)];

describe('T-E2E-38 backing — slugifyName (the SkinForm slug pre-fill; ADR-0048 D19 / D27)', () => {
  it.each([
    ['Seed Skin A', 'seed-skin-a'],
    ['Metal Pipe Mace!', 'metal-pipe-mace'],
    ['  spaced   out  ', 'spaced-out'],
    ['Ünïcödé Skîn', 'unicode-skin'],
    ['already-a-slug', 'already-a-slug'],
    ['UPPER_snake.dot', 'upper-snake-dot'],
    ['---', ''],
    ['', ''],
  ])('T-E2E-38 slugifyName(%j) → %j', (name, expected) => {
    expect(slugifyName(name)).toBe(expected);
  });

  it('T-E2E-38 agrees with lib/validation/slug slugify on every input (one rule, two bundles)', () => {
    for (const name of [
      'Seed Skin A',
      'Ünïcödé Skîn',
      'x'.repeat(70),
      'a b c',
      '!!!',
      'Ægir & Þór',
      'naïve café',
    ]) {
      expect(slugifyName(name), name).toBe(slugify(name));
    }
  });
});

describe('T-E2E-7 backing — selectSkin (`?skin=<slug>` → the shown skin)', () => {
  it('T-E2E-7 no param → the FIRST skin of the reader order (seed-skin-b, sort_order 1)', () => {
    expect(selectSkin(SEED_ORDER, null)?.slug).toBe('seed-skin-b');
  });

  it('T-E2E-7 a known slug → that skin', () => {
    expect(selectSkin(SEED_ORDER, 'seed-skin-a')?.id).toBe(skin(1).id);
    expect(selectSkin(SEED_ORDER, 'seed-skin-b')?.id).toBe(skin(2).id);
  });

  it('T-E2E-7 an unknown or empty slug falls back to the first skin (never a 404)', () => {
    expect(selectSkin(SEED_ORDER, 'nonsense')?.slug).toBe('seed-skin-b');
    expect(selectSkin(SEED_ORDER, '')?.slug).toBe('seed-skin-b');
    expect(selectSkin(SEED_ORDER, 'SEED-SKIN-A')?.slug).toBe('seed-skin-b');
  });

  it('T-E2E-7 an empty list → null (the page renders the §11.7 empty state instead)', () => {
    expect(selectSkin([], null)).toBeNull();
    expect(selectSkin([], 'seed-skin-a')).toBeNull();
  });

  it('T-E2E-7 works on the card shape too and never mutates the list', () => {
    const cards: SkinCardData[] = SEED_ORDER.map((item) => ({
      id: item.id,
      slug: item.slug,
      name: item.name,
      model: item.model,
      textureUrl: item.textureUrl,
      bustUrl: item.bustUrl,
      exclusive: item.exclusive,
    }));
    const frozen = Object.freeze([...cards]);
    expect(selectSkin(frozen, 'seed-skin-a')).toBe(cards[1]);
    expect(frozen).toEqual(cards);
  });
});

describe('T-E2E-7 / T-ACT-76 backing — the DOWNLOAD PNG link', () => {
  it('T-E2E-7 skinDownloadHref is the 04 §2.3 route for the skin id', () => {
    expect(skinDownloadHref(skin(2).id)).toBe('/api/download/00000000-0000-4000-8000-000000000602');
  });

  it('T-E2E-7 skinDownloadHref encodes what it is given (an id can never leave its segment)', () => {
    expect(skinDownloadHref('a/b?c')).toBe('/api/download/a%2Fb%3Fc');
  });

  it('T-ACT-76 skinFilename is `<slug>.png` — the `?download=` name Supabase serves', () => {
    expect(skinFilename('seed-skin-a')).toBe('seed-skin-a.png');
    expect(skinFilename('seed-skin-b')).toBe('seed-skin-b.png');
  });
});
