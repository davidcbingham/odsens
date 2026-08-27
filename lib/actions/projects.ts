'use server';
/**
 * lib/actions/projects.ts — `curateProject`, `setProjectLink` (04 §1.4; SC-02..SC-08, SC-24;
 * 01 INV-18; ADR-0002 C7 / A11 / C10; ADR-0013; 05 T-ACT-40 / T-ACT-41).
 *
 * Every action = `return runAction(name, schema, input, fn)` (never throws to the client). Order
 * inside each `fn`: auth (`requireRole('admin')` — curation is admin-only, ADR-0002 C7; moderators
 * get `forbidden`) → rate limit (`setProjectLink` only: scope `project_link`, 30 / hour / user) →
 * validation that needs I/O (project lookup, gallery HEAD check, CurseForge resolution) → writes.
 * All writes go through the service client ONLY after the role check (04 SC-06) — RLS on
 * `project_overrides` / `project_links` is `is_admin()` writes (data-model §4), enforced twice.
 *
 * `curateProject` (ADR-0002 A11): the batch `reorder` shape upserts `project_overrides.featured_order`
 * for every listed id in ONE statement (one transaction) and revalidates the `projects` tag once —
 * no per-slug tags (cards/home strip read `projects`). The per-project shape upserts the override
 * row (PK `project_id`; PostgREST merge-duplicates updates only the provided columns) and
 * revalidates `projects` + `project:<slug>`. `extra_gallery` paths are prefix-checked in the schema
 * and HEAD-checked against bucket `project-media` here — the bucket lands in S1.3 (ADR-0002 C10:
 * S1.2 gallery = Modrinth URLs only), so in S1.2 every entry fails closed as `validation`.
 *
 * `setProjectLink` (Q39 manual entry): digits ref → `getMod(id)`; URL ref → `searchBySlug(slug)`;
 * upserts `project_links` AND sets `projects.downloads_curseforge` immediately (05 T-ACT-41);
 * `ref: null` deletes the row and zeroes the count. `CURSEFORGE_API_KEY` unset → `upstream_error`
 * "CurseForge key not configured" (04 §1.4 precondition; SC-16 degradation).
 *
 * SC-24: each `requireRole` call site logs `msg:'admin'` with meta keys only (no values, no bodies)
 * before returning `ok:true`. Input schemas live in `./projects.schema.ts` (a `'use server'` module
 * may export only async functions).
 */
import { revalidateTag } from 'next/cache';
import {
  curateProjectInput,
  setProjectLinkInput,
  type CurateProjectInput,
  type CurateProjectOverrideInput,
  type SetProjectLinkInput,
} from '@/lib/actions/projects.schema';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { runAction, type ActionContext } from '@/lib/actions/run';
import { createCurseforge, parseRef, type CurseforgeMod } from '@/lib/adapters/curseforge';
import { AdapterError } from '@/lib/adapters/http';
import { requireRole } from '@/lib/auth';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { assertRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';

type OverrideRow = Database['public']['Tables']['project_overrides']['Row'];
type OverridePatch = Database['public']['Tables']['project_overrides']['Update'];
type LinkRow = Database['public']['Tables']['project_links']['Row'];

const NOT_FOUND_PROJECT = "That project doesn't exist.";

/** 04 §1.4: the gallery bucket (S1.3 — ADR-0002 C10); stored paths carry the bucket prefix. */
const PROJECT_MEDIA_BUCKET = 'project-media';
const PROJECT_MEDIA_PREFIX = 'project-media/';

const FOREIGN_KEY_VIOLATION = '23503';

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

/** SC-24: keys-only audit line, logged before every `ok:true` return of a `requireRole` action. */
function logAdmin(
  action: string,
  ctx: ActionContext,
  actorId: string,
  target: { type: string; id: string | null },
  input: object,
): void {
  log.info({
    action,
    id: ctx.id,
    msg: 'admin',
    meta: {
      actor_profile_id: actorId,
      target_type: target.type,
      target_id: target.id,
      fields: Object.keys(input),
    },
  });
}

/** The project's slug (for the `project:<slug>` tag), or null when the row does not exist. */
async function readProjectSlug(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`projects read failed: ${error.code}`);
  return data?.slug ?? null;
}

// ---------------------------------------------------------------------------------------------
// curateProject — 04 §1.4 (per-project override upsert / batch reorder — ADR-0002 A11)
// ---------------------------------------------------------------------------------------------

type CurateProjectData = { override: OverrideRow } | { reordered: number };

/** Only the provided fields land in the upsert payload — absent ones keep their stored values. */
function overridePatch(data: CurateProjectOverrideInput): OverridePatch {
  const patch: OverridePatch = {};
  if (data.featured !== undefined) patch.featured = data.featured;
  if (data.featured_order !== undefined) patch.featured_order = data.featured_order;
  if (data.hidden !== undefined) patch.hidden = data.hidden;
  if (data.title_override !== undefined) patch.title_override = data.title_override;
  if (data.description_override !== undefined)
    patch.description_override = data.description_override;
  if (data.extra_gallery !== undefined) patch.extra_gallery = data.extra_gallery;
  if (data.notes_md !== undefined) patch.notes_md = data.notes_md;
  if (data.comments_enabled !== undefined) patch.comments_enabled = data.comments_enabled;
  return patch;
}

export async function curateProject(
  input: CurateProjectInput,
): Promise<ActionResult<CurateProjectData>> {
  return runAction('curateProject', curateProjectInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    const admin = createAdminClient();

    if ('reorder' in data) {
      // Batch (ADR-0002 A11): one upsert statement = one transaction; unknown ids hit the FK.
      const rows = data.reorder.map(({ project_id, featured_order }) => ({
        project_id,
        featured_order,
      }));
      const { error } = await admin
        .from('project_overrides')
        .upsert(rows, { onConflict: 'project_id' });
      if (error) {
        if (error.code === FOREIGN_KEY_VIOLATION) return fail('not_found', NOT_FOUND_PROJECT);
        throw new Error(`project_overrides reorder failed: ${error.code}`);
      }
      // ONE revalidate — no per-slug tags (cards/home strip read the `projects` tag).
      revalidateTag('projects', 'max');
      logAdmin('curateProject', ctx, user.id, { type: 'projects', id: null }, data);
      return ok<CurateProjectData>({ reordered: data.reorder.length });
    }

    const slug = await readProjectSlug(admin, data.project_id);
    if (slug === null) return fail('not_found', NOT_FOUND_PROJECT);

    // 04 §1.4 HEAD check: every (prefix-valid) path must exist in `project-media`. The bucket lands
    // in S1.3 (ADR-0002 C10), so until then any entry fails closed as `validation`.
    for (const entry of data.extra_gallery ?? []) {
      const objectPath = entry.path.slice(PROJECT_MEDIA_PREFIX.length);
      const { data: exists, error } = await admin.storage
        .from(PROJECT_MEDIA_BUCKET)
        .exists(objectPath);
      if (error !== null || exists !== true) {
        const message = "That image hasn't been uploaded.";
        return fail('validation', message, {
          field: 'extra_gallery',
          issues: [{ path: 'extra_gallery', message }],
        });
      }
    }

    const { data: override, error } = await admin
      .from('project_overrides')
      .upsert({ project_id: data.project_id, ...overridePatch(data) }, { onConflict: 'project_id' })
      .select()
      .single();
    if (error) throw new Error(`project_overrides upsert failed: ${error.code}`);

    revalidateTag('projects', 'max');
    revalidateTag(`project:${slug}`, 'max');
    logAdmin('curateProject', ctx, user.id, { type: 'project', id: data.project_id }, data);
    return ok<CurateProjectData>({ override });
  });
}

// ---------------------------------------------------------------------------------------------
// setProjectLink — 04 §1.4 (manual CurseForge id/URL — Q39; `null` removes the link)
// ---------------------------------------------------------------------------------------------

export async function setProjectLink(
  input: SetProjectLinkInput,
): Promise<ActionResult<{ link: LinkRow | null }>> {
  return runAction('setProjectLink', setProjectLinkInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    await assertRateLimit('project_link', user.id, 30, '1 hour');
    const admin = createAdminClient();

    const slug = await readProjectSlug(admin, data.project_id);
    if (slug === null) return fail('not_found', NOT_FOUND_PROJECT);

    if (data.ref === null) {
      // 04 §1.4: `null` removes the link and zeroes the combined-count contribution.
      const deleted = await admin
        .from('project_links')
        .delete()
        .eq('project_id', data.project_id)
        .eq('platform', 'curseforge');
      if (deleted.error) throw new Error(`project_links delete failed: ${deleted.error.code}`);
      const zeroed = await admin
        .from('projects')
        .update({ downloads_curseforge: 0 })
        .eq('id', data.project_id);
      if (zeroed.error) throw new Error(`projects update failed: ${zeroed.error.code}`);

      revalidateTag('projects', 'max');
      revalidateTag(`project:${slug}`, 'max');
      logAdmin('setProjectLink', ctx, user.id, { type: 'project_link', id: data.project_id }, data);
      return ok({ link: null });
    }

    // 04 §1.4 precondition (SC-16 degradation) — checked before any CurseForge call.
    if (env.CURSEFORGE_API_KEY === undefined) {
      return fail('upstream_error', 'CurseForge key not configured');
    }

    const parsed = parseRef(data.ref);
    // The schema already proved the grammar; a null here is unreachable but keeps the type narrow.
    if (parsed === null) {
      return fail('validation', 'Use a CurseForge id or project URL.', { field: 'ref' });
    }

    const curseforge = createCurseforge({ env });
    let mod: CurseforgeMod;
    try {
      if ('id' in parsed) {
        mod = await curseforge.getMod(parsed.id);
      } else {
        const found = await curseforge.searchBySlug(parsed.slug);
        if (found === null) return fail('not_found', 'Nothing on CurseForge matches that.');
        mod = found;
      }
    } catch (error) {
      // AdapterError messages are already secret-redacted (SC-09/A4) but stay out of user copy.
      if (error instanceof AdapterError) {
        if (error.status === 404) return fail('not_found', 'Nothing on CurseForge matches that.');
        return fail('upstream_error', "CurseForge didn't answer. Try again.");
      }
      throw error;
    }

    const { data: link, error } = await admin
      .from('project_links')
      .upsert(
        {
          project_id: data.project_id,
          platform: 'curseforge',
          external_id: String(mod.id),
          url: mod.links.websiteUrl,
          downloads: mod.downloadCount,
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'project_id,platform' },
      )
      .select()
      .single();
    if (error) throw new Error(`project_links upsert failed: ${error.code}`);

    // 05 T-ACT-41: the combined count moves immediately, not on the next `syncCurseforge` run.
    const updated = await admin
      .from('projects')
      .update({ downloads_curseforge: mod.downloadCount })
      .eq('id', data.project_id);
    if (updated.error) throw new Error(`projects update failed: ${updated.error.code}`);

    revalidateTag('projects', 'max');
    revalidateTag(`project:${slug}`, 'max');
    logAdmin('setProjectLink', ctx, user.id, { type: 'project_link', id: data.project_id }, data);
    return ok({ link });
  });
}
