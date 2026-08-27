/**
 * lib/format/downloads.ts — combined download counts (05 T-UNIT-11 `combinedDownloads`;
 * 02 §2.3 GET IT rail "combined-count line"; 03 §2.3 `GetItPanel`; T-RLS-23 sum parity).
 *
 * Pure and client-safe (no zod, no server imports). Keys are the `projects` /
 * `projects_public` column names verbatim (docs/data-model; the view exposes
 * `downloads_total = downloads_modrinth + downloads_curseforge + downloads_direct` — the
 * seed project `…0102` sums to 1688, shown as `1.7K` via `formatCount`, 05 T-E2E-3).
 */

/** The three per-source counters, named as the DB columns. */
export type DownloadCounts = {
  downloads_modrinth?: number | null;
  downloads_curseforge?: number | null;
  downloads_direct?: number | null;
};

/**
 * `modrinth + curseforge + direct`, nulls/absent treated as 0 (05 T-UNIT-11). Must always equal
 * the view's `downloads_total` (T-RLS-23) — callers may pass either and get the same number.
 */
export function combinedDownloads(project: DownloadCounts): number {
  return (
    (project.downloads_modrinth ?? 0) +
    (project.downloads_curseforge ?? 0) +
    (project.downloads_direct ?? 0)
  );
}

/**
 * The line explaining the combined count (DESIGN.md §6 #3 "a line explaining the combined
 * count"; exact copy fixed by 03 §2.3 `GetItPanel`, verbatim). The pass-3 mockup's shorter
 * caption ("Combined count includes direct downloads from here.") is superseded by 03.
 */
export const COMBINED_COUNT_LINE =
  'Modrinth and CurseForge report their own counts. Direct downloads are the ones we serve.';
