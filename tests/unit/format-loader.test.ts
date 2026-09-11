/**
 * T-UNIT-47 — `lib/format/loader.ts` `loaderLabel` (ADR-0034 D2): lowercase loader ids render as
 * their proper names; unknown ids capitalise; ids never change as data.
 */
import { describe, expect, it } from 'vitest';
import { loaderLabel, loaderLabels } from '@/lib/format/loader';

describe('T-UNIT-47 loaderLabel (ADR-0034 D2)', () => {
  it('T-UNIT-47 known ids map to their proper names', () => {
    expect(loaderLabel('fabric')).toBe('Fabric');
    expect(loaderLabel('forge')).toBe('Forge');
    expect(loaderLabel('neoforge')).toBe('NeoForge');
    expect(loaderLabel('quilt')).toBe('Quilt');
    expect(loaderLabel('paper')).toBe('Paper');
    expect(loaderLabel('bungeecord')).toBe('BungeeCord');
    expect(loaderLabel('datapack')).toBe('Datapack');
    expect(loaderLabel('minecraft')).toBe('Minecraft');
  });

  it('T-UNIT-47 unknown ids capitalise the first letter; case and whitespace are tolerated', () => {
    expect(loaderLabel('rift')).toBe('Rift');
    expect(loaderLabel(' Fabric ')).toBe('Fabric');
    expect(loaderLabel('NEOFORGE')).toBe('NeoForge');
  });

  it('T-UNIT-47 blanks pass through and lists keep their order', () => {
    expect(loaderLabel('')).toBe('');
    expect(loaderLabels(['fabric', 'quilt', 'forge'])).toEqual(['Fabric', 'Quilt', 'Forge']);
  });
});
