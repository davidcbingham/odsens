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

/** The 04 §1.4 shared `LOADERS` ids in their order — the `CheckGrid` options for the admin forms (ADR-0035 D4). */
export const LOADER_IDS = [
  'fabric',
  'forge',
  'neoforge',
  'quilt',
  'paper',
  'spigot',
  'bukkit',
  'purpur',
  'folia',
  'velocity',
  'bungeecord',
  'waterfall',
  'sponge',
  'datapack',
  'minecraft',
] as const;

export const LOADER_OPTIONS: readonly { value: string; label: string }[] = LOADER_IDS.map((id) => ({
  value: id,
  label: loaderLabel(id),
}));

/** `loaderLabel` over a list, order kept. */
export function loaderLabels(ids: readonly string[]): string[] {
  return ids.map(loaderLabel);
}
