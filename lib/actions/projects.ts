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
  createExclusiveProjectInput,
  curateProjectInput,
  publishProjectInput,
  setProjectLinkInput,
  updateExclusiveProjectInput,
  type CreateExclusiveProjectInput,
  type CurateProjectInput,
  type CurateProjectOverrideInput,
  type PublishProjectInput,
  type SetProjectLinkInput,
  type UpdateExclusiveProjectInput,
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

    const { data: project, error: projectError } = await admin
      .from('projects')
      .select('slug, source')
      .eq('id', data.project_id)
      .maybeSingle();
    if (projectError) throw new Error(`projects read failed: ${projectError.code}`);
    if (project === null) return fail('not_found', NOT_FOUND_PROJECT);
    // Q39 scopes CF links to SYNCED projects; a link on an exclusive would also un-earn its
    // badge everywhere the list reads derive `exclusive` from `source` alone (00 S1.3.AC8 —
    // `isExclusive` demands zero `project_links` rows).
    if (project.source === 'odsens') {
      return fail('validation', 'Exclusives live only here — no CurseForge link to add.');
    }
    const slug = project.slug;

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

// ---------------------------------------------------------------------------------------------
// S1.3 — exclusive projects (04 §1.4 createExclusiveProject / updateExclusiveProject /
// publishProject; ADR-0002 C7 admin-only, #38 no draft previews, #65 publish preconditions)
// ---------------------------------------------------------------------------------------------

type ProjectRow = Database['public']['Tables']['projects']['Row'];
type ProjectPatch = Database['public']['Tables']['projects']['Update'];

const UNIQUE_VIOLATION = '23505';
const SLUG_TAKEN = "That slug's taken.";
const NOT_EXCLUSIVE = 'Synced projects are curated, not edited.';

/** The stored exclusive row the update/publish actions check preconditions against. */
async function readExclusiveProject(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
): Promise<
  | { found: false }
  | {
      found: true;
      exclusive: boolean;
      row: Pick<ProjectRow, 'slug' | 'status' | 'icon_url' | 'published_at' | 'source'>;
    }
> {
  const { data, error } = await admin
    .from('projects')
    .select('slug, status, icon_url, published_at, source')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`projects read failed: ${error.code}`);
  if (data === null) return { found: false };
  return { found: true, exclusive: data.source === 'odsens', row: data };
}

export async function createExclusiveProject(
  input: CreateExclusiveProjectInput,
): Promise<ActionResult<{ id: string; slug: string }>> {
  return runAction(
    'createExclusiveProject',
    createExclusiveProjectInput,
    input,
    async (data, ctx) => {
      const { user } = await requireRole('admin');
      const admin = createAdminClient();

      const { data: row, error } = await admin
        .from('projects')
        .insert({
          source: 'odsens',
          external_id: null,
          slug: data.slug,
          project_type: data.project_type,
          title: data.title,
          description: data.description,
          body_md: data.body_md,
          categories: data.categories,
          loaders: data.loaders,
          game_versions: data.game_versions,
          license: data.license ?? null,
          source_url: data.source_url ?? null,
          issues_url: data.issues_url ?? null,
          discord_url: data.discord_url ?? null,
          status: 'draft',
          published_at: null,
        })
        .select('id, slug')
        .single();
      if (error) {
        // citext unique across BOTH sources (04 §1.4: "slug conflict (citext, incl. Modrinth slugs)").
        if (error.code === UNIQUE_VIOLATION) {
          return fail('conflict', SLUG_TAKEN, { field: 'slug' });
        }
        throw new Error(`projects insert failed: ${error.code}`);
      }

      // No revalidation — a draft is invisible everywhere (04 §1.4; ADR-0002 #38: no preview URLs).
      logAdmin('createExclusiveProject', ctx, user.id, { type: 'project', id: row.id }, data);
      return ok({ id: row.id, slug: row.slug });
    },
  );
}

export async function updateExclusiveProject(
  input: UpdateExclusiveProjectInput,
): Promise<ActionResult<{ id: string; slug: string }>> {
  return runAction(
    'updateExclusiveProject',
    updateExclusiveProjectInput,
    input,
    async (data, ctx) => {
      const { user } = await requireRole('admin');
      const admin = createAdminClient();

      const current = await readExclusiveProject(admin, data.id);
      if (!current.found) return fail('not_found', NOT_FOUND_PROJECT);
      if (!current.exclusive) return fail('forbidden', NOT_EXCLUSIVE);

      const oldSlug = current.row.slug;
      const slugChanges =
        data.slug !== undefined && data.slug.toLowerCase() !== oldSlug.toLowerCase();
      // 04 §1.4: slug change allowed while `status='draft'` only, else `conflict`.
      if (slugChanges && current.row.status !== 'draft') {
        return fail('conflict', 'Slugs are fixed once a project is published.', { field: 'slug' });
      }

      const patch: ProjectPatch = {};
      if (data.slug !== undefined) patch.slug = data.slug;
      if (data.title !== undefined) patch.title = data.title;
      if (data.description !== undefined) patch.description = data.description;
      if (data.body_md !== undefined) patch.body_md = data.body_md;
      if (data.project_type !== undefined) patch.project_type = data.project_type;
      if (data.categories !== undefined) patch.categories = data.categories;
      if (data.loaders !== undefined) patch.loaders = data.loaders;
      if (data.game_versions !== undefined) patch.game_versions = data.game_versions;
      if (data.license !== undefined) patch.license = data.license;
      if (data.source_url !== undefined) patch.source_url = data.source_url;
      if (data.issues_url !== undefined) patch.issues_url = data.issues_url;
      if (data.discord_url !== undefined) patch.discord_url = data.discord_url;

      const { data: row, error } = await admin
        .from('projects')
        .update(patch)
        .eq('id', data.id)
        .select('id, slug')
        .single();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          return fail('conflict', SLUG_TAKEN, { field: 'slug' });
        }
        throw new Error(`projects update failed: ${error.code}`);
      }

      revalidateTag('projects', 'max');
      revalidateTag(`project:${oldSlug}`, 'max');
      if (row.slug !== oldSlug) revalidateTag(`project:${row.slug}`, 'max');
      logAdmin('updateExclusiveProject', ctx, user.id, { type: 'project', id: data.id }, data);
      return ok({ id: row.id, slug: row.slug });
    },
  );
}

export async function publishProject(
  input: PublishProjectInput,
): Promise<ActionResult<{ id: string; status: 'draft' | 'published' | 'hidden' }>> {
  return runAction('publishProject', publishProjectInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    const admin = createAdminClient();

    const current = await readExclusiveProject(admin, data.id);
    if (!current.found) return fail('not_found', NOT_FOUND_PROJECT);
    if (!current.exclusive) return fail('forbidden', NOT_EXCLUSIVE);

    if (data.status === 'published') {
      // ADR-0002 #65: publish needs an icon AND ≥ 1 version with ≥ 1 stored file. The message
      // lists exactly what is missing (05 T-ACT-37).
      const missing: string[] = [];
      if (current.row.icon_url === null) missing.push('The project needs an icon.');

      const { data: fileRows, error: filesError } = await admin
        .from('project_files')
        .select('id, storage_path, version:project_versions!inner(project_id)')
        .eq('version.project_id', data.id)
        .not('storage_path', 'is', null)
        .limit(1);
      if (filesError) throw new Error(`project_files read failed: ${filesError.code}`);
      if (fileRows.length === 0) missing.push('Nothing to download yet.');

      if (missing.length > 0) {
        return fail('precondition_failed', missing.join(' '));
      }
    }

    const patch: ProjectPatch = { status: data.status };
    if (data.status === 'published' && current.row.published_at === null) {
      patch.published_at = new Date().toISOString();
    }
    const { error } = await admin.from('projects').update(patch).eq('id', data.id);
    if (error) throw new Error(`projects update failed: ${error.code}`);

    revalidateTag('projects', 'max');
    revalidateTag(`project:${current.row.slug}`, 'max');
    logAdmin('publishProject', ctx, user.id, { type: 'project', id: data.id }, data);
    return ok({ id: data.id, status: data.status });
  });
}
