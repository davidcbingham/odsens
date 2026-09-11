/**
 * lib/format/loader.ts — display names for loader ids (ADR-0034 D2; 05 T-UNIT-47).
 *
 * Modrinth (and the admin forms, 04 §1.4) store loaders as lowercase ids (`fabric`, `neoforge`,
 * `bungeecord`). Visitors see the proper names (`Fabric`, `NeoForge`, `BungeeCord`) on chips, the
 * VERSIONS & FILES loader column and the GET IT file meta. Ids stay lowercase everywhere they are
 * data — filters, forms, the sync, the DB. Plain module, client-safe (no env, no zod).
 */

/** Ids whose proper name is not a simple capitalisation. Everything else capitalises its first letter. */
const LOADER_NAMES: Readonly<Record<string, string>> = {
  neoforge: 'NeoForge',
  bungeecord: 'BungeeCord',
  liteloader: 'LiteLoader',
  modloader: 'ModLoader',
  optifine: 'OptiFine',
  datapack: 'Datapack',
  minecraft: 'Minecraft',
};

/** `'fabric'` → `'Fabric'`, `'neoforge'` → `'NeoForge'`; an unknown id gets its first letter upper-cased; blanks pass through. */
export function loaderLabel(id: string): string {
  const key = id.trim().toLowerCase();
  if (key === '') return id;
  const known = LOADER_NAMES[key];
  if (known !== undefined) return known;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** `loaderLabel` over a list, order kept. */
export function loaderLabels(ids: readonly string[]): string[] {
  return ids.map(loaderLabel);
}
