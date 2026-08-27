/**
 * lib/format/size.ts — file-size display (`184 KB`, `1.9 MB` — DESIGN.md pass-3 detail mockup
 * Size column + GET IT file meta; upload-well copy "That's 82 MB. The limit is 50."). Registry
 * Modules `format/*.ts`. Pure and client-safe (no zod, no server imports — ADR-0008).
 *
 * Binary units (1 KB = 1024 B — the buckets are MiB-limited, `_registry.md` Buckets), printed
 * in plain words: whole KB, one-decimal MB under 10, whole MB from 10. Never a trailing `.0`
 * (same rule as `formatCount`, 05 T-UNIT-10).
 */

const KB = 1024;
const MB = 1024 * 1024;

/** `sizeBytes` → `"184 KB"` / `"1.9 MB"` / `"82 MB"`; sub-KB sizes print as `"512 B"`. */
export function formatFileSize(bytes: number): string {
  const n = Number.isFinite(bytes) ? Math.max(0, Math.floor(bytes)) : 0;
  if (n < KB) return `${n} B`;
  if (n < MB) return `${Math.round(n / KB)} KB`;
  const mb = n / MB;
  const rounded = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  return `${rounded} MB`;
}
