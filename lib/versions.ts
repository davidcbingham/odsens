/**
 * lib/versions.ts — game-version grouping + versions-table ordering (03 V-01; 02 §2.2 `version`
 * param; 05 T-UNIT-39, T-UNIT-30; registry Modules `versions.ts`).
 *
 * Plain, client-safe module — no zod, no server imports: `ProjectGrid`/`FilterBar` (client
 * islands) group and match versions client-side over the ISR-fetched list (ADR-0002 A7), and
 * the server `VersionsTable` uses the same ordering helpers.
 *
 * 03 V-01, verbatim rule: "Group `game_versions` by `major.minor` and label `major.minor.x`
 * (`1.21.1`, `1.21.4` → `1.21.x`); snapshots (`24w10a`, `1.21-pre1`) grouped under `snapshots`;
 * option order = newest group first; a project matches a group when any of its `game_versions`
 * starts with `major.minor.` (or equals `major.minor`)."
 */

/** One option for the `/projects` version `Select` — `value` is the `?version=` URL value. */
export type VersionGroup = { value: string; label: string };

/** The catch-all group value/label for snapshot versions (03 V-01: "grouped under `snapshots`"). */
export const SNAPSHOT_GROUP = 'snapshots';

/** `1.21` / `1.21.4` style releases; anything else (`24w10a`, `1.21-pre1`, `1.21.4-rc1`) is a snapshot. */
const RELEASE_RE = /^(\d+)\.(\d+)(?:\.\d+)*$/;

/** True when `version` is not a plain `major.minor[.patch]` release id. */
export function isSnapshotVersion(version: string): boolean {
  return !RELEASE_RE.test(version.trim());
}

/**
 * Groups a union of `game_versions` per 03 V-01 (05 T-UNIT-39):
 * `['1.21','1.21.1','1.21.4','1.20.1','24w10a','1.21-pre1']` →
 * `[{1.21.x}, {1.20.x}, {snapshots}]` — newest release group first, `snapshots` last.
 */
export function groupGameVersions(gameVersions: readonly string[]): VersionGroup[] {
  const releases = new Map<string, { major: number; minor: number }>();
  let hasSnapshots = false;
  for (const raw of gameVersions) {
    const version = raw.trim();
    if (version === '') continue;
    const match = RELEASE_RE.exec(version);
    if (match === null) {
      hasSnapshots = true;
      continue;
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    releases.set(`${major}.${minor}`, { major, minor });
  }
  const groups = [...releases.values()]
    .sort((a, b) => b.major - a.major || b.minor - a.minor)
    .map(({ major, minor }) => {
      const label = `${major}.${minor}.x`;
      return { value: label, label };
    });
  if (hasSnapshots) groups.push({ value: SNAPSHOT_GROUP, label: SNAPSHOT_GROUP });
  return groups;
}

/**
 * 03 V-01 match rule: a project matches `1.21.x` when any of its `game_versions` equals `1.21`
 * or starts with `1.21.`; it matches `snapshots` when any of them is a snapshot id.
 */
export function matchesVersionGroup(gameVersions: readonly string[], group: string): boolean {
  if (group === SNAPSHOT_GROUP) return gameVersions.some((v) => isSnapshotVersion(v.trim()));
  const majorMinor = group.endsWith('.x') ? group.slice(0, -2) : group;
  return gameVersions.some((raw) => {
    const version = raw.trim();
    return version === majorMinor || version.startsWith(`${majorMinor}.`);
  });
}

// ---- VERSIONS & FILES ordering — 05 T-UNIT-30 ("versionsTable sort", registered here) ----

export type SortableFile = { primary: boolean };
export type SortableVersion = { datePublished: string; files: readonly SortableFile[] };

/** Files with `primary: true` first, otherwise in their given order (stable). */
export function primaryFirst<F extends SortableFile>(files: readonly F[]): F[] {
  return [...files].sort((a, b) => Number(b.primary) - Number(a.primary));
}

/** True when a version's changelog should show the "Changes ▾" expander (03 `ChangelogExpander`). */
export function hasChangelog(changelogMd: string | null | undefined): boolean {
  return typeof changelogMd === 'string' && changelogMd.trim() !== '';
}

/**
 * The `VersionsTable` order (05 T-UNIT-30): versions by `date_published` desc (newest first),
 * files within each version primary-first. Pure — returns new arrays, never mutates.
 */
export function sortVersionsForTable<V extends SortableVersion>(versions: readonly V[]): V[] {
  return [...versions]
    .sort((a, b) => toTime(b.datePublished) - toTime(a.datePublished))
    .map((version) => ({ ...version, files: primaryFirst(version.files) }) as V);
}

function toTime(value: string): number {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}
