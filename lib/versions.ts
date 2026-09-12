/**
 * lib/versions.ts — game-version grouping + versions-table ordering + the primary-download rule
 * (03 V-01; 02 §2.2 `version` param; 05 T-UNIT-39, T-UNIT-30, T-UNIT-49; ADR-0037 D6; registry
 * Modules `versions.ts`).
 *
 * Plain, client-safe module — no zod, no server imports: `ProjectGrid`/`FilterBar` (client
 * islands) group and match versions client-side over the ISR-fetched list (ADR-0002 A7), the
 * server `VersionsTable` uses the same ordering helpers, and `lib/data/projects.ts` picks the
 * GET IT / hero primary with `selectPrimaryFile`.
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

// ---- Minecraft-version display (ADR-0034 D3; 05 T-UNIT-48) --------------------------------

type Release = { raw: string; major: number; minor: number; patch: number };

const RELEASE_PARTS_RE = /^(\d+)\.(\d+)(?:\.(\d+))?$/;

function parseRelease(raw: string): Release | null {
  const match = RELEASE_PARTS_RE.exec(raw);
  if (match === null) return null;
  return { raw, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) };
}

/** Same major and the minor is equal or the very next one — the run continues. */
function continues(prev: Release, next: Release): boolean {
  return next.major === prev.major && next.minor - prev.minor <= 1;
}

/**
 * Compact form of a version list for the VERSIONS & FILES Minecraft column and similar
 * read-only spots: releases sorted oldest→newest, then every run of neighbouring minors
 * collapses to `first – last` (`1.17 – 1.21.11`); a run breaks only where a whole minor
 * series is skipped (`1.16.5, 1.18 – 1.19.4`). Snapshots follow verbatim, in their given
 * order. Empty input → `''`. The full list stays available to the filter (`matchesVersionGroup`).
 */
export function formatVersionList(gameVersions: readonly string[]): string {
  const releases: Release[] = [];
  const snapshots: string[] = [];
  const seen = new Set<string>();
  for (const raw of gameVersions) {
    const version = raw.trim();
    if (version === '' || seen.has(version)) continue;
    seen.add(version);
    const release = parseRelease(version);
    if (release === null) snapshots.push(version);
    else releases.push(release);
  }
  releases.sort((a, b) => a.major - b.major || a.minor - b.minor || a.patch - b.patch);
  const parts: string[] = [];
  let runStart: Release | null = null;
  let runEnd: Release | null = null;
  const flush = () => {
    if (runStart === null || runEnd === null) return;
    parts.push(runStart === runEnd ? runStart.raw : `${runStart.raw} – ${runEnd.raw}`);
  };
  for (const release of releases) {
    if (runEnd !== null && continues(runEnd, release)) {
      runEnd = release;
      continue;
    }
    flush();
    runStart = release;
    runEnd = release;
  }
  flush();
  return [...parts, ...snapshots].join(', ');
}

// ---- VERSIONS & FILES ordering — 05 T-UNIT-30 ("versionsTable sort", registered here) ----

/**
 * Where a file's bytes live (ADR-0037 D6): `direct` = hosted in our Storage (`storage_path`
 * set, served by `/api/download/<id>`); `modrinth` = CDN-only (`project_files.url`). The same
 * two words are the `TrackedLink` `download.source` values (04 §5.6).
 */
export type FileKind = 'direct' | 'modrinth';

export type SortableFile = { primary: boolean; kind: FileKind };
export type SortableVersion = { datePublished: string; files: readonly SortableFile[] };

/** ADR-0037 D6 rank: hosted primary → hosted → CDN primary → CDN. */
function fileRank(file: SortableFile): number {
  return (file.kind === 'direct' ? 0 : 2) + (file.primary ? 0 : 1);
}

/**
 * ADR-0037 D6 file order within a version — hosted primary, then hosted, then CDN primary,
 * then CDN; stable inside each rank (files in their given order). Replaces S1.2's
 * `primaryFirst` (05 T-UNIT-30 amended): a version that lives in two homes lists the file we
 * serve before the mirror on the Modrinth CDN.
 */
export function hostedFirst<F extends SortableFile>(files: readonly F[]): F[] {
  return [...files].sort((a, b) => fileRank(a) - fileRank(b));
}

/**
 * The primary download (ADR-0037 D6; 02 §2.1 #1, §2.3 rail): the hosted primary file of the
 * NEWEST version that has a hosted file — "the hosted file is always the primary": an older
 * hosted release beats a newer CDN-only one (which the versions table still lists). Within
 * that version `hostedFirst` order applies, so a hosted `primary: true` wins and a hosted
 * version whose flag was never set still yields its first hosted file. `null` when no version
 * carries a hosted file — the caller then falls back to the project's Modrinth home, or
 * renders no panel (05 T-UNIT-49).
 */
export function selectPrimaryFile<V extends SortableVersion>(
  versions: readonly V[],
): V['files'][number] | null {
  const newestFirst = [...versions].sort(
    (a, b) => toTime(b.datePublished) - toTime(a.datePublished),
  );
  for (const version of newestFirst) {
    const hosted = hostedFirst(version.files).find((file) => file.kind === 'direct');
    if (hosted !== undefined) return hosted;
  }
  return null;
}

/** True when a version's changelog should show the "Changes ▾" expander (03 `ChangelogExpander`). */
export function hasChangelog(changelogMd: string | null | undefined): boolean {
  return typeof changelogMd === 'string' && changelogMd.trim() !== '';
}

/**
 * The `VersionsTable` order (05 T-UNIT-30, amended by ADR-0037 D6): versions by
 * `date_published` desc (newest first), files within each version `hostedFirst`. Pure —
 * returns new arrays, never mutates.
 */
export function sortVersionsForTable<V extends SortableVersion>(versions: readonly V[]): V[] {
  return [...versions]
    .sort((a, b) => toTime(b.datePublished) - toTime(a.datePublished))
    .map((version) => ({ ...version, files: hostedFirst(version.files) }) as V);
}

function toTime(value: string): number {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}
