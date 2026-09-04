/**
 * lib/jobs/syncCurseforge.ts — hourly CurseForge download-count sync (04 §3.2 verbatim; §3 pipeline
 * through `lib/jobs/runner.ts` `runJob` — SC-11/SC-13, SC-07 tags, J-F edge emission (ADR-0030 D1);
 * SC-16 no-key degradation; J-P/J-I/J-D; 01 INV-24/INV-71; 05 T-ACT-45, T-ACT-52, T-ACT-71,
 * T-ACT-74).
 *
 * Precondition: `CURSEFORGE_API_KEY` set; else the run still writes its `sync_runs` row (SC-11) with
 * `ok=true, error='not configured'` (01 env matrix wording) and returns
 * `{ok:true, items:0, skipped:'not_configured'}` — no adapter is constructed, no `sync.failed`
 * (the runner emits only for `ok=false`).
 *
 * Steps: for each `project_links` row `platform='curseforge'`: `getMod(external_id)` (the stored id
 * is text — `setProjectLink` writes `String(id)` — converted back to the numeric CF id) →
 * `downloads = data.downloadCount`, `url = data.links.websiteUrl` → update
 * `project_links.downloads, synced_at` and `projects.downloads_curseforge`. A per-item error keeps
 * the old numbers (J-P); the adapter enforces sequential calls (04 §4.2). Idempotency key:
 * `project_links (project_id, platform='curseforge')` — an unchanged link moves `synced_at` only
 * (J-I). From S1.5 a failed run (`ok=false`) emits `sync.failed` per J-F through the runner —
 * edge-triggered, never twice for one failure episode (05 T-ACT-74).
 *
 * Revalidate (04 §3.2): `projects`; `project:<slug>` per changed row — none on a no-change run.
 */
import 'server-only';
import { createCurseforge } from '@/lib/adapters/curseforge';
import { env } from '@/lib/env';
import { runJob } from '@/lib/jobs/runner';
import type { JobOptions, JobSummary } from '@/lib/jobs/types';

const JOB = 'syncCurseforge';
const SOURCE = 'curseforge' as const;

/** J-P: at most 20 entries in `summary.errors[]`. */
const ERRORS_LIMIT = 20;
const ERROR_ENTRY_LIMIT = 300;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushError(errors: string[], entry: string): void {
  if (errors.length < ERRORS_LIMIT) errors.push(entry.slice(0, ERROR_ENTRY_LIMIT));
}

/**
 * 04 §3.2 — hourly CurseForge counts. `opts.full` is a youtube-only flag and is ignored here.
 * Lock, `sync_runs` row, revalidation, logging and J-F come from `runJob` (ADR-0030 D1).
 */
export async function syncCurseforge(opts: JobOptions): Promise<JobSummary> {
  return runJob({
    source: SOURCE,
    job: JOB,
    opts,
    work: async ({ db }) => {
      // 04 §3.2 precondition — the skipped run still writes its SC-11 row: ok=true, error='not configured'.
      if (env.CURSEFORGE_API_KEY === undefined) {
        return { ok: true, items: 0, error: 'not configured', skipped: 'not_configured' };
      }

      let ok = true;
      let errorText: string | null = null;
      let items = 0;
      let links = 0;
      const errors: string[] = [];
      const changedSlugs = new Set<string>();

      try {
        const curseforge = createCurseforge({ env });

        const linksRead = await db
          .from('project_links')
          .select('project_id, external_id, url, downloads')
          .eq('platform', SOURCE);
        if (linksRead.error)
          throw new Error(`project_links read failed: ${linksRead.error.message}`);
        const rows = linksRead.data;
        links = rows.length;

        const slugById = new Map<string, string>();
        if (rows.length > 0) {
          const projectsRead = await db
            .from('projects')
            .select('id, slug')
            .in(
              'id',
              rows.map((row) => row.project_id),
            );
          if (projectsRead.error)
            throw new Error(`projects read failed: ${projectsRead.error.message}`);
          for (const project of projectsRead.data) slugById.set(project.id, project.slug);
        }

        let failedItems = 0;
        for (const row of rows) {
          try {
            const mod = await curseforge.getMod(Number(row.external_id));
            const syncedAt = new Date().toISOString();
            if (mod.downloadCount !== row.downloads || mod.links.websiteUrl !== row.url) {
              const linkUpdate = await db
                .from('project_links')
                .update({
                  downloads: mod.downloadCount,
                  url: mod.links.websiteUrl,
                  synced_at: syncedAt,
                })
                .eq('project_id', row.project_id)
                .eq('platform', SOURCE);
              if (linkUpdate.error)
                throw new Error(`project_links update failed: ${linkUpdate.error.message}`);
              const projectUpdate = await db
                .from('projects')
                .update({ downloads_curseforge: mod.downloadCount })
                .eq('id', row.project_id);
              if (projectUpdate.error)
                throw new Error(`projects update failed: ${projectUpdate.error.message}`);
              items += 1;
              const slug = slugById.get(row.project_id);
              if (slug !== undefined) changedSlugs.add(slug);
            } else {
              // J-I — unchanged numbers: only `synced_at` moves.
              const touched = await db
                .from('project_links')
                .update({ synced_at: syncedAt })
                .eq('project_id', row.project_id)
                .eq('platform', SOURCE);
              if (touched.error)
                throw new Error(`project_links touch failed: ${touched.error.message}`);
            }
          } catch (error) {
            // J-P: item error keeps the old numbers and is counted, never rethrown.
            failedItems += 1;
            pushError(errors, `${row.external_id}: ${message(error)}`);
          }
        }

        // J-P: the run fails only when the list read failed or > 50 % of items failed.
        if (failedItems > rows.length / 2) {
          ok = false;
          errorText = `${String(failedItems)}/${String(rows.length)} items failed: ${errors.join('; ')}`;
        }
      } catch (error) {
        ok = false;
        errorText = message(error);
        pushError(errors, errorText);
      }

      // 04 §3.2 revalidate (through the runner, after the row is final) — `projects` once +
      // `project:<slug>` per changed row; nothing on a no-change run.
      const tags =
        changedSlugs.size > 0
          ? ['projects', ...[...changedSlugs].map((slug) => `project:${slug}`)]
          : [];

      return {
        ok,
        items,
        error: ok ? null : (errorText ?? 'failed'),
        extra: { links, errors },
        tags,
        logMeta: ok ? { links, errors: errors.length } : { errors: errors.length },
      };
    },
  });
}
