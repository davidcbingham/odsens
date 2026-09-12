'use server';
/**
 * lib/actions/projects.ts — `curateProject`, `linkProjectListing`, `unlinkProjectListing`,
 * `createExclusiveProject`, `updateExclusiveProject`, `publishProject` (04 §1.4; SC-02..SC-08,
 * SC-24; 01 INV-18; ADR-0002 C7 / A11 / C10; ADR-0013; ADR-0037 D1 / D3 / D4 / D5(c) / D5(e);
 * 05 T-ACT-34..37, T-ACT-40, T-ACT-41, T-ACT-79, T-ACT-80, T-ACT-81, T-ACT-84).
 *
 * Every action = `return runAction(name, schema, input, fn)` (never throws to the client). Order
 * inside each `fn`: auth (`requireRole('admin')` — curation, linking and exclusives are admin-only,
 * ADR-0002 C7; moderators get `forbidden`) → rate limit (the link actions only: scope
 * `project_link`, 30 / hour / user) → validation that needs I/O (project lookup, gallery HEAD
 * check, listing resolution) → writes. All writes go through the service client ONLY after the
 * role check (04 SC-06) — RLS on `project_overrides` / `project_links` is `is_admin()` writes
 * (data-model §4), enforced twice.
 *
 * `curateProject` (ADR-0002 A11): the batch `reorder` shape upserts `project_overrides.featured_order`
 * for every listed id in ONE statement (one transaction) and revalidates the `projects` tag once —
 * no per-slug tags (cards/home strip read `projects`). The per-project shape upserts the override
 * row (PK `project_id`; PostgREST merge-duplicates updates only the provided columns) and
 * revalidates `projects` + `project:<slug>`. `extra_gallery` (ADR-0037 D5(e)): an entry whose
 * `path` is already stored on the row skips the `<this project_id>` folder check (it was validated
 * when added; a folded duplicate's entries live under the old folder); a NEW entry must match
 * `galleryPathPattern`; every entry is HEAD-checked against bucket `project-media`.
 *
 * `linkProjectListing` (ADR-0037 D1 — replaces S1.2's `setProjectLink`): one action, two
 * platforms. `curseforge` keeps every S1.2 rule (digits → `getMod`, URL → `searchBySlug`;
 * `CURSEFORGE_API_KEY` unset → `upstream_error` "CurseForge key not configured"; the link row +
 * `projects.downloads_curseforge` set immediately) MINUS the "exclusive → validation" refusal: an
 * exclusive may gain a CurseForge link and loses its badge by design. `modrinth`: `ref` (URL, slug
 * or id — `parseModrinthRef`) resolves through `adapters/modrinth.getProject` (404 → `not_found`,
 * other failure → `upstream_error`). Preconditions before any write: the project exists; it is
 * `source='odsens'` (a synced row IS its listing → `validation`); no `modrinth` link to a DIFFERENT
 * listing (`conflict` "Remove the current Modrinth listing first." — replacing goes through unlink
 * so the un-adopt runs; the same id is idempotent); the listing is not linked to another project
 * (`conflict` "That listing is already linked to <title>." — the unique index
 * `project_links_platform_external_id_key` is the atomic backstop: 23505 → the same `conflict`).
 * Effects IN THIS ORDER: (a) upsert `project_links {external_id: raw.id, url:
 * modrinthListingUrl(raw.id), downloads, synced_at}`; (b) `projects.downloads_modrinth`; (c) when a
 * `projects (source='modrinth', external_id = raw.id)` row exists → RPC `fold_project(duplicate,
 * this)` (D3); (d) revalidate `projects`, `project:<slug>` and, when (c) ran, `project:<redirect
 * slug>`. The link is written FIRST so a fold failure leaves a state the sync converges from.
 * Versions arrive on the next `syncModrinth` run — this action never calls the job or `listVersions`.
 *
 * `unlinkProjectListing` (D1): `modrinth` → un-adopt FIRST (every adopted version on this project
 * carrying ≥ 1 hosted file gets `external_id = NULL`, at most one row per `version_number`: the row
 * holding a hosted `primary` file, else the newest `date_published`; rows with no hosted file keep
 * their id and follow the listing on the next sync), then delete the link row, then
 * `downloads_modrinth = 0`. `curseforge` → delete the row, `downloads_curseforge = 0`. Nothing but
 * the fold RPC deletes a synced row.
 *
 * `createExclusiveProject` / `updateExclusiveProject` refuse a slug held by `project_redirects`
 * (D4 — a folded old slug keeps resolving) with the taken-slug `conflict`. `publishProject` accepts
 * every `source` (D5(c); the icon + hosted-file preconditions are unchanged).
 *
 * SC-24: each `requireRole` call site logs `msg:'admin'` with meta keys only (no values, no bodies)
 * before returning `ok:true`. Input schemas live in `./projects.schema.ts` (a `'use server'`
 * module may export only async functions).
 */
import { revalidateTag } from 'next/cache';
import {
  CURSEFORGE_REF_MESSAGE,
  GALLERY_FOLDER_MESSAGE,
  MODRINTH_REF_MESSAGE,
  createExclusiveProjectInput,
  curateProjectInput,
  galleryPathPattern,
  linkProjectListingInput,
  publishProjectInput,
  unlinkProjectListingInput,
  updateExclusiveProjectInput,
  type CreateExclusiveProjectInput,
  type CurateProjectInput,
  type CurateProjectOverrideInput,
  type LinkPlatform,
  type LinkProjectListingInput,
  type PublishProjectInput,
  type UnlinkProjectListingInput,
  type UpdateExclusiveProjectInput,
} from '@/lib/actions/projects.schema';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { runAction, type ActionContext } from '@/lib/actions/run';
import { createCurseforge, parseRef, type CurseforgeMod } from '@/lib/adapters/curseforge';
import { AdapterError } from '@/lib/adapters/http';
import { createModrinth, parseModrinthRef, type ModrinthProject } from '@/lib/adapters/modrinth';
import { requireRole } from '@/lib/auth';
import { env } from '@/lib/env';
import { modrinthListingUrl } from '@/lib/format/project';
import { log } from '@/lib/log';
import { assertRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/types';

type Admin = ReturnType<typeof createAdminClient>;
type OverrideRow = Database['public']['Tables']['project_overrides']['Row'];
type OverridePatch = Database['public']['Tables']['project_overrides']['Update'];
type LinkRow = Database['public']['Tables']['project_links']['Row'];
type LinkInsert = Database['public']['Tables']['project_links']['Insert'];

const NOT_FOUND_PROJECT = "That project doesn't exist.";

/** 04 §1.4: the gallery bucket (S1.3 — ADR-0002 C10); stored paths carry the bucket prefix. */
const PROJECT_MEDIA_BUCKET = 'project-media';
const PROJECT_MEDIA_PREFIX = 'project-media/';

const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';

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
async function readProjectSlug(admin: Admin, projectId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`projects read failed: ${error.code}`);
  return data?.slug ?? null;
}

/** ADR-0037 D4: true when `slug` is a folded project's old slug (citext — case-insensitive). */
async function slugIsRedirect(admin: Admin, slug: string): Promise<boolean> {
  const { data, error } = await admin
    .from('project_redirects')
    .select('old_slug')
    .eq('old_slug', slug)
    .maybeSingle();
  if (error) throw new Error(`project_redirects read failed: ${error.code}`);
  return data !== null;
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

/** The `path` values of a stored `extra_gallery` jsonb (malformed entries ignored). */
function storedGalleryPaths(json: Json | null | undefined): Set<string> {
  const paths = new Set<string>();
  if (!Array.isArray(json)) return paths;
  for (const entry of json) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      const path = (entry as Record<string, Json | undefined>)['path'];
      if (typeof path === 'string') paths.add(path);
    }
  }
  return paths;
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

    if (data.extra_gallery !== undefined) {
      // ADR-0037 D5(e): entries already stored on the row skip the folder rule (validated when
      // added; a folded duplicate's live under the old folder). New entries must be in THIS
      // project's gallery folder (04 §1.4).
      const { data: stored, error: storedError } = await admin
        .from('project_overrides')
        .select('extra_gallery')
        .eq('project_id', data.project_id)
        .maybeSingle();
      if (storedError) throw new Error(`project_overrides read failed: ${storedError.code}`);
      const known = storedGalleryPaths(stored?.extra_gallery);
      const pattern = galleryPathPattern(data.project_id);
      const issues = data.extra_gallery.flatMap((entry, index) =>
        known.has(entry.path) || pattern.test(entry.path)
          ? []
          : [{ path: `extra_gallery.${String(index)}.path`, message: GALLERY_FOLDER_MESSAGE }],
      );
      if (issues.length > 0) {
        return fail('validation', GALLERY_FOLDER_MESSAGE, { field: 'extra_gallery', issues });
      }

      // 04 §1.4 HEAD check: every path (stored or new) must exist in `project-media`.
      for (const entry of data.extra_gallery) {
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
// linkProjectListing / unlinkProjectListing — ADR-0037 D1 (04 §1.4; replaces `setProjectLink`)
// ---------------------------------------------------------------------------------------------

const SYNCED_IS_ITS_LISTING = 'This project is synced from Modrinth already.';
const REMOVE_CURRENT_LISTING = 'Remove the current Modrinth listing first.';
const MODRINTH_NOT_FOUND = 'Nothing on Modrinth matches that.';
const MODRINTH_DOWN = "Modrinth didn't answer. Try again.";
const CURSEFORGE_NOT_FOUND = 'Nothing on CurseForge matches that.';
const CURSEFORGE_DOWN = "CurseForge didn't answer. Try again.";

/** The action-side view of the fold RPC's jsonb return (only the key the action reads). */
function redirectSlugOf(result: Json): string | null {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return null;
  const slug = (result as Record<string, Json | undefined>)['redirect_slug'];
  return typeof slug === 'string' ? slug : null;
}

/** The project another `project_links` row already binds `(platform, external_id)` to, if any. */
async function listingHolder(
  admin: Admin,
  platform: LinkPlatform,
  externalId: string,
  exceptProjectId: string,
): Promise<{ title: string } | null> {
  const { data, error } = await admin
    .from('project_links')
    .select('project_id, project:projects!inner(title)')
    .eq('platform', platform)
    .eq('external_id', externalId)
    .neq('project_id', exceptProjectId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`project_links read failed: ${error.code}`);
  return data === null ? null : { title: data.project.title };
}

function alreadyLinkedMessage(holder: { title: string } | null): string {
  return `That listing is already linked to ${holder?.title ?? 'another project'}.`;
}

/** The link upsert shared by both platforms; a 23505 (the D1 unique index) → `conflict`. */
async function upsertLink(
  admin: Admin,
  row: LinkInsert & { project_id: string; platform: LinkPlatform; external_id: string },
): Promise<{ link: LinkRow } | { conflict: string }> {
  const { data: link, error } = await admin
    .from('project_links')
    .upsert(row, { onConflict: 'project_id,platform' })
    .select()
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const holder = await listingHolder(admin, row.platform, row.external_id, row.project_id);
      return { conflict: alreadyLinkedMessage(holder) };
    }
    throw new Error(`project_links upsert failed: ${error.code}`);
  }
  return { link };
}

export async function linkProjectListing(
  input: LinkProjectListingInput,
): Promise<ActionResult<{ link: LinkRow }>> {
  return runAction('linkProjectListing', linkProjectListingInput, input, async (data, ctx) => {
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
    const slug = project.slug;
    const now = new Date().toISOString();

    if (data.platform === 'curseforge') {
      // ---- curseforge: the S1.2 rules, minus the exclusive refusal (ADR-0037 D1) ----
      // 04 §1.4 precondition (SC-16 degradation) — checked before any CurseForge call.
      if (env.CURSEFORGE_API_KEY === undefined) {
        return fail('upstream_error', 'CurseForge key not configured');
      }
      const parsed = parseRef(data.ref);
      // The schema already proved the grammar; a null here is unreachable but keeps the type narrow.
      if (parsed === null) return fail('validation', CURSEFORGE_REF_MESSAGE, { field: 'ref' });

      const curseforge = createCurseforge({ env });
      let mod: CurseforgeMod;
      try {
        if ('id' in parsed) {
          mod = await curseforge.getMod(parsed.id);
        } else {
          const found = await curseforge.searchBySlug(parsed.slug);
          if (found === null) return fail('not_found', CURSEFORGE_NOT_FOUND);
          mod = found;
        }
      } catch (error) {
        // AdapterError messages are already secret-redacted (SC-09/A4) but stay out of user copy.
        if (error instanceof AdapterError) {
          if (error.status === 404) return fail('not_found', CURSEFORGE_NOT_FOUND);
          return fail('upstream_error', CURSEFORGE_DOWN);
        }
        throw error;
      }
      const externalId = String(mod.id);

      // One listing links to at most one project (the D1 unique index; checked first for the title).
      const holder = await listingHolder(admin, 'curseforge', externalId, data.project_id);
      if (holder !== null) return fail('conflict', alreadyLinkedMessage(holder));

      const upserted = await upsertLink(admin, {
        project_id: data.project_id,
        platform: 'curseforge',
        external_id: externalId,
        url: mod.links.websiteUrl,
        downloads: mod.downloadCount,
        synced_at: now,
      });
      if ('conflict' in upserted) return fail('conflict', upserted.conflict);

      // 05 T-ACT-41: the combined count moves immediately, not on the next `syncCurseforge` run.
      const updated = await admin
        .from('projects')
        .update({ downloads_curseforge: mod.downloadCount })
        .eq('id', data.project_id);
      if (updated.error) throw new Error(`projects update failed: ${updated.error.code}`);

      revalidateTag('projects', 'max');
      revalidateTag(`project:${slug}`, 'max');
      logAdmin(
        'linkProjectListing',
        ctx,
        user.id,
        { type: 'project_link', id: data.project_id },
        data,
      );
      return ok({ link: upserted.link });
    }

    // ---- modrinth (ADR-0037 D1) ----
    // A `source='modrinth'` row IS its listing — nothing to link.
    if (project.source !== 'odsens') return fail('validation', SYNCED_IS_ITS_LISTING);

    const parsed = parseModrinthRef(data.ref);
    if (parsed === null) return fail('validation', MODRINTH_REF_MESSAGE, { field: 'ref' });

    const modrinth = createModrinth({ env });
    let raw: ModrinthProject;
    try {
      raw = await modrinth.getProject(parsed.ref);
    } catch (error) {
      if (error instanceof AdapterError) {
        if (error.status === 404) return fail('not_found', MODRINTH_NOT_FOUND);
        return fail('upstream_error', MODRINTH_DOWN);
      }
      throw error;
    }
    // `request<T>` is an unchecked cast (SC-09): the id becomes `project_links.external_id` and the
    // stored URL, so a 200 body without a well-formed id is an upstream failure, never a write.
    if (typeof raw.id !== 'string' || parseModrinthRef(raw.id)?.ref !== raw.id) {
      return fail('upstream_error', MODRINTH_DOWN);
    }
    const externalId = raw.id;

    // Replacing a listing goes through unlink (the un-adopt must run); the same id is idempotent.
    const { data: current, error: currentError } = await admin
      .from('project_links')
      .select('external_id')
      .eq('project_id', data.project_id)
      .eq('platform', 'modrinth')
      .maybeSingle();
    if (currentError) throw new Error(`project_links read failed: ${currentError.code}`);
    if (current !== null && current.external_id !== externalId) {
      return fail('conflict', REMOVE_CURRENT_LISTING);
    }

    const holder = await listingHolder(admin, 'modrinth', externalId, data.project_id);
    if (holder !== null) return fail('conflict', alreadyLinkedMessage(holder));

    // (a) the link — written FIRST so a fold failure leaves a state the sync converges from (D2).
    const upserted = await upsertLink(admin, {
      project_id: data.project_id,
      platform: 'modrinth',
      external_id: externalId,
      url: modrinthListingUrl(externalId),
      downloads: raw.downloads ?? 0,
      synced_at: now,
    });
    if ('conflict' in upserted) return fail('conflict', upserted.conflict);

    // (b) the count moves immediately (the T-ACT-41 precedent).
    const counted = await admin
      .from('projects')
      .update({ downloads_modrinth: raw.downloads ?? 0 })
      .eq('id', data.project_id);
    if (counted.error) throw new Error(`projects update failed: ${counted.error.code}`);

    // (c) the sync already imported this listing as its own row → fold it into this one (D3).
    const { data: duplicate, error: duplicateError } = await admin
      .from('projects')
      .select('id')
      .eq('source', 'modrinth')
      .eq('external_id', externalId)
      .maybeSingle();
    if (duplicateError) throw new Error(`projects read failed: ${duplicateError.code}`);
    let redirectSlug: string | null = null;
    if (duplicate !== null) {
      const { data: folded, error: foldError } = await admin.rpc('fold_project', {
        p_duplicate_id: duplicate.id,
        p_canonical_id: data.project_id,
      });
      if (foldError) throw new Error(`fold_project failed: ${foldError.code}`);
      redirectSlug = redirectSlugOf(folded);
    }

    // (d) revalidate — the folded slug's page too (the renamed-slug precedent).
    revalidateTag('projects', 'max');
    revalidateTag(`project:${slug}`, 'max');
    if (redirectSlug !== null) revalidateTag(`project:${redirectSlug}`, 'max');
    logAdmin(
      'linkProjectListing',
      ctx,
      user.id,
      { type: 'project_link', id: data.project_id },
      data,
    );
    return ok({ link: upserted.link });
  });
}

type AdoptedVersion = {
  id: string;
  version_number: string;
  date_published: string;
  files: { storage_path: string | null; primary: boolean }[];
};

/**
 * ADR-0037 D1 un-adopt: among this project's adopted versions (`external_id IS NOT NULL`) that
 * carry ≥ 1 hosted file, the one row per `version_number` that keeps its hosted files under an
 * exclusive identity — the row holding a hosted `primary` file, else the newest `date_published`.
 * A number that already has an `external_id IS NULL` row is skipped (the partial unique
 * `project_versions_exclusive_version_key` would refuse a second).
 */
function pickUnadoptTargets(versions: AdoptedVersion[], takenNumbers: Set<string>): string[] {
  const byNumber = new Map<string, AdoptedVersion[]>();
  for (const version of versions) {
    if (takenNumbers.has(version.version_number)) continue;
    if (!version.files.some((file) => file.storage_path !== null)) continue;
    const group = byNumber.get(version.version_number) ?? [];
    group.push(version);
    byNumber.set(version.version_number, group);
  }
  const targets: string[] = [];
  for (const group of byNumber.values()) {
    const withPrimary = group.filter((version) =>
      version.files.some((file) => file.storage_path !== null && file.primary),
    );
    const candidates = withPrimary.length > 0 ? withPrimary : group;
    candidates.sort((a, b) => b.date_published.localeCompare(a.date_published));
    const chosen = candidates[0];
    if (chosen !== undefined) targets.push(chosen.id);
  }
  return targets;
}

/** The D1 un-adopt write: `external_id = NULL` on the chosen rows (one statement). */
async function unadoptHostedVersions(admin: Admin, projectId: string): Promise<number> {
  const { data: rows, error } = await admin
    .from('project_versions')
    .select(
      'id, version_number, external_id, date_published, files:project_files(storage_path, primary)',
    )
    .eq('project_id', projectId);
  if (error) throw new Error(`project_versions read failed: ${error.code}`);
  const taken = new Set(
    rows.filter((row) => row.external_id === null).map((row) => row.version_number),
  );
  const adopted: AdoptedVersion[] = rows
    .filter((row) => row.external_id !== null)
    .map((row) => ({
      id: row.id,
      version_number: row.version_number,
      date_published: row.date_published,
      files: row.files,
    }));
  const targets = pickUnadoptTargets(adopted, taken);
  if (targets.length === 0) return 0;
  const { error: updateError } = await admin
    .from('project_versions')
    .update({ external_id: null })
    .in('id', targets);
  if (updateError) throw new Error(`project_versions update failed: ${updateError.code}`);
  return targets.length;
}

export async function unlinkProjectListing(
  input: UnlinkProjectListingInput,
): Promise<ActionResult<{ link: null }>> {
  return runAction('unlinkProjectListing', unlinkProjectListingInput, input, async (data, ctx) => {
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
    const slug = project.slug;

    if (data.platform === 'modrinth') {
      // A synced row's listing is its home (D1) — there is no link row and nothing to un-adopt.
      if (project.source !== 'odsens') return fail('validation', SYNCED_IS_ITS_LISTING);
      // Un-adopt FIRST: hosted versions keep an exclusive identity, the rest follow the listing.
      await unadoptHostedVersions(admin, data.project_id);
    }

    const deleted = await admin
      .from('project_links')
      .delete()
      .eq('project_id', data.project_id)
      .eq('platform', data.platform);
    if (deleted.error) throw new Error(`project_links delete failed: ${deleted.error.code}`);

    const zeroed = await admin
      .from('projects')
      .update(
        data.platform === 'modrinth' ? { downloads_modrinth: 0 } : { downloads_curseforge: 0 },
      )
      .eq('id', data.project_id);
    if (zeroed.error) throw new Error(`projects update failed: ${zeroed.error.code}`);

    revalidateTag('projects', 'max');
    revalidateTag(`project:${slug}`, 'max');
    logAdmin(
      'unlinkProjectListing',
      ctx,
      user.id,
      { type: 'project_link', id: data.project_id },
      data,
    );
    return ok({ link: null });
  });
}

// ---------------------------------------------------------------------------------------------
// S1.3 — exclusive projects (04 §1.4 createExclusiveProject / updateExclusiveProject /
// publishProject; ADR-0002 C7 admin-only, #38 no draft previews, #65 publish preconditions;
// ADR-0037 D4 redirect slugs, D5(c) publish for every source)
// ---------------------------------------------------------------------------------------------

type ProjectRow = Database['public']['Tables']['projects']['Row'];
type ProjectPatch = Database['public']['Tables']['projects']['Update'];

const SLUG_TAKEN = "That slug's taken.";
const NOT_EXCLUSIVE = 'Synced projects are curated, not edited.';

/** The stored row the update/publish actions check preconditions against. */
async function readProjectHead(
  admin: Admin,
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

      // ADR-0037 D4: a folded project's old slug keeps resolving — it cannot be re-taken.
      if (await slugIsRedirect(admin, data.slug)) {
        return fail('conflict', SLUG_TAKEN, { field: 'slug' });
      }

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

      const current = await readProjectHead(admin, data.id);
      if (!current.found) return fail('not_found', NOT_FOUND_PROJECT);
      if (!current.exclusive) return fail('forbidden', NOT_EXCLUSIVE);

      const oldSlug = current.row.slug;
      const slugChanges =
        data.slug !== undefined && data.slug.toLowerCase() !== oldSlug.toLowerCase();
      // 04 §1.4: slug change allowed while `status='draft'` only, else `conflict`.
      if (slugChanges && current.row.status !== 'draft') {
        return fail('conflict', 'Slugs are fixed once a project is published.', { field: 'slug' });
      }
      // ADR-0037 D4: a folded project's old slug keeps resolving — it cannot be re-taken.
      if (slugChanges && data.slug !== undefined && (await slugIsRedirect(admin, data.slug))) {
        return fail('conflict', SLUG_TAKEN, { field: 'slug' });
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

    // ADR-0037 D5(c): every `source` may be published — the preconditions below are the gate. For
    // synced rows the durable hide stays `project_overrides.hidden` (the sync re-asserts
    // `status='published'` for listed rows); the editor offers these controls on odsens rows only.
    const current = await readProjectHead(admin, data.id);
    if (!current.found) return fail('not_found', NOT_FOUND_PROJECT);

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
