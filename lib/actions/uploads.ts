'use server';
/**
 * lib/actions/uploads.ts — `uploadProjectMedia`, `uploadProjectFile` (04 §1.4.5 two-phase
 * signed-upload pattern + the two §1.4 contracts; SC-18..SC-21, SC-24; 01 INV-51/52/53;
 * ADR-0002 C7 / C10 / C16; 05 T-ACT-38 / T-ACT-39 / T-ACT-73).
 *
 * Both actions are ONE name with a discriminated `phase` (04 §1.4.5):
 *   `begin`  — role check → rate limit (U2: a `begin` counts even without a commit) → declared
 *              size/extension check (schema) → server-generated path (uuid placeholder segment for
 *              media; the final `{version_id}/{filename}` path for files) → signed upload URL via
 *              `lib/files.ts` `createSignedUpload` (the one `createSignedUploadUrl` site, INV-51).
 *              No DB row is written.
 *   (browser PUTs the file to the signed URL — `UploadWell`, 03 C-17 exception 4)
 *   `commit` — role check → the echoed `path` must parse against the caller's target ids (INV-53;
 *              anything else → `forbidden` and the object is NOT touched, T-ACT-73) → download the
 *              object → re-validate magic bytes / actual size / dimensions (SC-19; `validateUpload`)
 *              → on failure DELETE the object and fail → on success move media to its `{hash16}`
 *              path, write the DB row(s), revalidate.
 *
 * Idempotency (U3 — content-based for media, ADR-0027): media commits dedupe on the
 * content-addressed final path (a re-PUT + re-commit of the same bytes returns the existing entry,
 * no duplicate row; a bare commit retry AFTER a successful commit finds the pending object moved
 * and answers `validation` "never arrived" — the client re-sends the bytes, which converges).
 * File commits are path-idempotent per the 04 letter: same `(version_id, filename)` + same sha512
 * → the existing row (`ok`), different bytes under the same name → `conflict` (04 §1.4 "filename
 * unique within version"), checked BEFORE the version-metadata upsert.
 *
 * Admin-only for every kind and source (ADR-0002 C7); `uploadProjectFile` and media `kind='icon'`
 * additionally require `source='odsens'` (synced icons/files belong to Modrinth — 04 §1.4);
 * media `kind='gallery'` on a synced project appends to `project_overrides.extra_gallery`
 * (ADR-0002 C10). SC-24: keys-only `msg:'admin'` line before every `ok:true`.
 */
import { revalidateTag } from 'next/cache';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { runAction, type ActionContext } from '@/lib/actions/run';
import {
  uploadProjectFileInput,
  uploadProjectMediaInput,
  type UploadProjectFileInput,
  type UploadProjectMediaInput,
} from '@/lib/actions/uploads.schema';
import { requireRole } from '@/lib/auth';
import {
  PROJECT_FILES_BUCKET,
  PROJECT_MEDIA_BUCKET,
  UPLOAD_MISSING,
  contentHash16,
  createSignedUpload,
  downloadObjectBytes,
  imageDimensions,
  mediaExtForMime,
  moveObject,
  parseProjectFilePath,
  parseProjectMediaPendingPath,
  projectFilePath,
  projectMediaFinalPath,
  projectMediaPendingPath,
  removeObject,
  removeObjectQuietly,
} from '@/lib/files';
import { sha512Hex } from '@/lib/hash';
import { log } from '@/lib/log';
import { assertRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';
import { sanitizeFilename, validateUpload } from '@/lib/validation/files';

type Admin = ReturnType<typeof createAdminClient>;

const NOT_FOUND_PROJECT = "That project doesn't exist.";
const NOT_YOUR_PATH = "That path isn't this project's.";
const NOT_EXCLUSIVE_FILES = 'Synced projects keep their files on Modrinth.';
const NOT_EXCLUSIVE_ICON = 'Synced projects keep their icon on Modrinth.';
const FILENAME_TAKEN = 'A file with that name already exists in this version.';
const VERSION_TAKEN = 'That version number already exists.';

const UNIQUE_VIOLATION = '23505';

/** SC-24: keys-only audit line (same shape as lib/actions/projects.ts). */
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

type ProjectHead = { slug: string; source: 'modrinth' | 'odsens'; gallery: Json };

async function readProjectHead(admin: Admin, projectId: string): Promise<ProjectHead | null> {
  const { data, error } = await admin
    .from('projects')
    .select('slug, source, gallery')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`projects read failed: ${error.code}`);
  return data;
}

/** Tolerant read of a jsonb gallery array's highest `ordering` (malformed entries ignored). */
function nextOrdering(json: Json): number {
  if (!Array.isArray(json)) return 1;
  let max = 0;
  for (const entry of json) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      const ordering = (entry as Record<string, Json | undefined>)['ordering'];
      if (typeof ordering === 'number' && Number.isFinite(ordering)) {
        max = Math.max(max, ordering);
      }
    }
  }
  return max + 1;
}

/** The entry in a gallery jsonb whose url/path equals `path`, if any (U3 dedupe). */
function findGalleryEntry(json: Json, key: 'url' | 'path', path: string): Json | null {
  if (!Array.isArray(json)) return null;
  for (const entry of json) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      if ((entry as Record<string, Json | undefined>)[key] === path) return entry;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// uploadProjectMedia — bucket `project-media` (public-read); icon | gallery (04 §1.4)
// ---------------------------------------------------------------------------------------------

type UploadProjectMediaData =
  { path: string; token: string; signed_url: string } | { path: string; entry: Json };

export async function uploadProjectMedia(
  input: UploadProjectMediaInput,
): Promise<ActionResult<UploadProjectMediaData>> {
  return runAction('uploadProjectMedia', uploadProjectMediaInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    const admin = createAdminClient();

    const project = await readProjectHead(admin, data.project_id);
    if (project === null) return fail('not_found', NOT_FOUND_PROJECT);
    // Icons are sync-owned on Modrinth rows (04 §1.4: `source='odsens'` only; modrinth → forbidden).
    if (data.kind === 'icon' && project.source !== 'odsens') {
      return fail('forbidden', NOT_EXCLUSIVE_ICON);
    }

    if (data.phase === 'begin') {
      await assertRateLimit('upload:project-media', user.id);
      const ext = mediaExtForMime(data.mime);
      if (ext === null) return fail('validation', 'Pick a png, jpg or webp.');
      const path = projectMediaPendingPath(data.project_id, data.kind, ext);
      const signed = await createSignedUpload(PROJECT_MEDIA_BUCKET, path);
      logAdmin('uploadProjectMedia', ctx, user.id, { type: 'project', id: data.project_id }, data);
      return ok<UploadProjectMediaData>(signed);
    }

    // ---- commit ----
    // INV-53: the echoed path must be a pending path of THIS project and THIS kind.
    const parsed = parseProjectMediaPendingPath(data.project_id, data.path);
    if (parsed === null || parsed.kind !== data.kind) {
      return fail('forbidden', NOT_YOUR_PATH);
    }

    const bytes = await downloadObjectBytes(PROJECT_MEDIA_BUCKET, data.path);
    if (bytes === null) return fail('validation', UPLOAD_MISSING);

    const check = validateUpload(
      { name: `upload.${parsed.ext}`, size: bytes.byteLength, bytes },
      'project-media',
    );
    if (!check.ok) {
      await removeObject(PROJECT_MEDIA_BUCKET, data.path);
      return fail('validation', check.message);
    }

    const dims = await imageDimensions(bytes);
    if (dims === null) {
      await removeObject(PROJECT_MEDIA_BUCKET, data.path);
      return fail('validation', "That file didn't open as an image.");
    }
    if (data.kind === 'icon') {
      // 04 §1.4: icons are square, 64..1024 px.
      if (dims.width !== dims.height || dims.width < 64 || dims.width > 1024) {
        await removeObject(PROJECT_MEDIA_BUCKET, data.path);
        return fail(
          'validation',
          `That's ${dims.width}×${dims.height}. Icons are square, 64 to 1024 pixels.`,
        );
      }
    } else {
      // 04 §1.4: gallery images are ≤ 4096×4096 and ≥ 320 px wide.
      if (dims.width > 4096 || dims.height > 4096 || dims.width < 320) {
        await removeObject(PROJECT_MEDIA_BUCKET, data.path);
        return fail(
          'validation',
          `That's ${dims.width}×${dims.height}. Gallery images are 320 to 4096 pixels wide, 4096 tall.`,
        );
      }
    }

    const ext = mediaExtForMime(check.mime);
    if (ext === null) {
      await removeObject(PROJECT_MEDIA_BUCKET, data.path);
      return fail('validation', 'Pick a png, jpg or webp.');
    }
    const finalPath = projectMediaFinalPath(data.project_id, data.kind, contentHash16(bytes), ext);
    await moveObject(PROJECT_MEDIA_BUCKET, data.path, finalPath);

    if (data.kind === 'icon') {
      const { error } = await admin
        .from('projects')
        .update({ icon_url: finalPath })
        .eq('id', data.project_id);
      if (error) throw new Error(`projects update failed: ${error.code}`);
      revalidateTag('projects', 'max');
      revalidateTag(`project:${project.slug}`, 'max');
      logAdmin('uploadProjectMedia', ctx, user.id, { type: 'project', id: data.project_id }, data);
      return ok<UploadProjectMediaData>({ path: finalPath, entry: { url: finalPath } });
    }

    if (project.source === 'odsens') {
      // Exclusive gallery lives on `projects.gallery` (U3: same final path → the existing entry).
      const existing = findGalleryEntry(project.gallery, 'url', finalPath);
      if (existing !== null) {
        logAdmin(
          'uploadProjectMedia',
          ctx,
          user.id,
          { type: 'project', id: data.project_id },
          data,
        );
        return ok<UploadProjectMediaData>({ path: finalPath, entry: existing });
      }
      const entry: Json = {
        url: finalPath,
        title: data.title ?? null,
        description: data.description ?? null,
        ordering: nextOrdering(project.gallery),
        featured: false,
      };
      const gallery = Array.isArray(project.gallery) ? [...project.gallery, entry] : [entry];
      const { error } = await admin.from('projects').update({ gallery }).eq('id', data.project_id);
      if (error) throw new Error(`projects update failed: ${error.code}`);
      revalidateTag('projects', 'max');
      revalidateTag(`project:${project.slug}`, 'max');
      logAdmin('uploadProjectMedia', ctx, user.id, { type: 'project', id: data.project_id }, data);
      return ok<UploadProjectMediaData>({ path: finalPath, entry });
    }

    // Synced project gallery extras live on `project_overrides.extra_gallery` (ADR-0002 C10).
    const { data: override, error: overrideError } = await admin
      .from('project_overrides')
      .select('extra_gallery')
      .eq('project_id', data.project_id)
      .maybeSingle();
    if (overrideError) throw new Error(`project_overrides read failed: ${overrideError.code}`);
    const currentExtra: Json = override?.extra_gallery ?? [];

    const existing = findGalleryEntry(currentExtra, 'path', finalPath);
    if (existing !== null) {
      logAdmin('uploadProjectMedia', ctx, user.id, { type: 'project', id: data.project_id }, data);
      return ok<UploadProjectMediaData>({ path: finalPath, entry: existing });
    }
    const entry: Json = {
      path: finalPath,
      title: data.title ?? null,
      description: data.description ?? null,
      ordering: nextOrdering(currentExtra),
    };
    const extra = Array.isArray(currentExtra) ? [...currentExtra, entry] : [entry];
    const { error } = await admin
      .from('project_overrides')
      .upsert({ project_id: data.project_id, extra_gallery: extra }, { onConflict: 'project_id' });
    if (error) throw new Error(`project_overrides upsert failed: ${error.code}`);

    revalidateTag('projects', 'max');
    revalidateTag(`project:${project.slug}`, 'max');
    logAdmin('uploadProjectMedia', ctx, user.id, { type: 'project', id: data.project_id }, data);
    return ok<UploadProjectMediaData>({ path: finalPath, entry });
  });
}

// ---------------------------------------------------------------------------------------------
// uploadProjectFile — bucket `project-files` (private); versions + files (04 §1.4)
// ---------------------------------------------------------------------------------------------

type UploadProjectFileData =
  | { path: string; token: string; signed_url: string }
  | {
      version_id: string;
      file: { id: string; filename: string; size_bytes: number; sha512: string };
    };

export async function uploadProjectFile(
  input: UploadProjectFileInput,
): Promise<ActionResult<UploadProjectFileData>> {
  return runAction('uploadProjectFile', uploadProjectFileInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    const admin = createAdminClient();

    const project = await readProjectHead(admin, data.project_id);
    if (project === null) return fail('not_found', NOT_FOUND_PROJECT);
    if (project.source !== 'odsens') return fail('forbidden', NOT_EXCLUSIVE_FILES);

    if (data.phase === 'begin') {
      await assertRateLimit('upload:project-files', user.id);
      // Existing exclusive version for (project_id, version_number) — or a fresh uuid the path
      // reserves; the version row itself is upserted only at commit (04 §1.4).
      const { data: version, error } = await admin
        .from('project_versions')
        .select('id')
        .eq('project_id', data.project_id)
        .eq('version_number', data.version_number)
        .is('external_id', null)
        .maybeSingle();
      if (error) throw new Error(`project_versions read failed: ${error.code}`);
      const versionId = version?.id ?? crypto.randomUUID();

      const filename = sanitizeFilename(data.filename);
      const path = projectFilePath(data.project_id, versionId, filename);
      const signed = await createSignedUpload(PROJECT_FILES_BUCKET, path);
      logAdmin('uploadProjectFile', ctx, user.id, { type: 'project', id: data.project_id }, data);
      return ok<UploadProjectFileData>(signed);
    }

    // ---- commit ----
    const parsed = parseProjectFilePath(data.project_id, data.path);
    if (parsed === null) return fail('forbidden', NOT_YOUR_PATH);

    // The embedded version id must be free or belong to THIS project (a crafted path could name
    // another project's version — INV-53).
    const { data: versionRow, error: versionReadError } = await admin
      .from('project_versions')
      .select('id, project_id, external_id')
      .eq('id', parsed.versionId)
      .maybeSingle();
    if (versionReadError) throw new Error(`project_versions read failed: ${versionReadError.code}`);
    if (versionRow !== null) {
      if (versionRow.project_id !== data.project_id) return fail('forbidden', NOT_YOUR_PATH);
      if (versionRow.external_id !== null) return fail('forbidden', NOT_YOUR_PATH);
    }

    const bytes = await downloadObjectBytes(PROJECT_FILES_BUCKET, data.path);
    if (bytes === null) return fail('validation', UPLOAD_MISSING);

    const check = validateUpload(
      { name: parsed.filename, size: bytes.byteLength, bytes },
      'project-file',
    );
    if (!check.ok) {
      await removeObject(PROJECT_FILES_BUCKET, data.path);
      return fail('validation', check.message);
    }
    const sha512 = sha512Hex(bytes);

    // Existing files of this version — U3 idempotency + filename uniqueness run BEFORE the
    // version-metadata upsert (04 §1.4 lists the filename check under Validation; §1.4.5
    // sequences validation → write, so a `conflict` return must leave the version untouched).
    // A null versionRow has no files yet; the arrays stay empty.
    type SiblingRow = {
      id: string;
      filename: string;
      sha512: string | null;
      size_bytes: number;
      primary: boolean;
    };
    let siblings: SiblingRow[] = [];
    if (versionRow !== null) {
      const { data: rows, error: siblingsError } = await admin
        .from('project_files')
        .select('id, filename, sha512, size_bytes, primary')
        .eq('version_id', versionRow.id);
      if (siblingsError) throw new Error(`project_files read failed: ${siblingsError.code}`);
      siblings = rows;

      const existing = siblings.find((row) => row.filename === parsed.filename);
      if (existing !== undefined) {
        if (existing.sha512 === sha512) {
          // Same bytes re-committed — the existing row, no duplicate, no metadata rewrite (U3).
          logAdmin(
            'uploadProjectFile',
            ctx,
            user.id,
            { type: 'project', id: data.project_id },
            data,
          );
          return ok<UploadProjectFileData>({
            version_id: versionRow.id,
            file: {
              id: existing.id,
              filename: existing.filename,
              size_bytes: existing.size_bytes,
              sha512,
            },
          });
        }
        return fail('conflict', FILENAME_TAKEN, { field: 'filename' });
      }
    }

    // Upsert the version (external_id null — exclusive) under the ADR-0026 partial unique.
    let versionId: string;
    if (versionRow === null) {
      const inserted = await admin
        .from('project_versions')
        .insert({
          id: parsed.versionId,
          project_id: data.project_id,
          external_id: null,
          version_number: data.version.version_number,
          name: data.version.name ?? null,
          changelog_md: data.version.changelog_md ?? null,
          game_versions: data.version.game_versions,
          loaders: data.version.loaders,
          version_type: data.version.version_type,
          date_published: data.version.date_published ?? new Date().toISOString(),
          downloads: 0,
        })
        .select('id')
        .single();
      if (inserted.error) {
        if (inserted.error.code === UNIQUE_VIOLATION) {
          return fail('conflict', VERSION_TAKEN, { field: 'version_number' });
        }
        throw new Error(`project_versions insert failed: ${inserted.error.code}`);
      }
      versionId = inserted.data.id;
    } else {
      versionId = versionRow.id;
      const updated = await admin
        .from('project_versions')
        .update({
          version_number: data.version.version_number,
          name: data.version.name ?? null,
          changelog_md: data.version.changelog_md ?? null,
          game_versions: data.version.game_versions,
          loaders: data.version.loaders,
          version_type: data.version.version_type,
          ...(data.version.date_published !== undefined
            ? { date_published: data.version.date_published }
            : {}),
        })
        .eq('id', versionId);
      if (updated.error) {
        if (updated.error.code === UNIQUE_VIOLATION) {
          return fail('conflict', VERSION_TAKEN, { field: 'version_number' });
        }
        throw new Error(`project_versions update failed: ${updated.error.code}`);
      }
    }

    // Primary rule (04 §1.4): `primary:true` demotes siblings; a version's first file is primary.
    const hasPrimary = siblings.some((row) => row.primary);
    const makePrimary = data.primary === true || !hasPrimary;
    if (data.primary === true && hasPrimary) {
      const cleared = await admin
        .from('project_files')
        .update({ primary: false })
        .eq('version_id', versionId)
        .eq('primary', true);
      if (cleared.error) throw new Error(`project_files update failed: ${cleared.error.code}`);
    }

    const { data: fileRow, error: fileError } = await admin
      .from('project_files')
      .insert({
        version_id: versionId,
        filename: parsed.filename,
        size_bytes: bytes.byteLength,
        sha512,
        url: null,
        storage_path: data.path,
        primary: makePrimary,
        download_count: 0,
      })
      .select('id')
      .single();
    if (fileError) {
      // The stored object outlives a failed row write only until the U1 cleanup (S1.9) — but a
      // clean failure here should not strand it when we can help it.
      await removeObjectQuietly(PROJECT_FILES_BUCKET, data.path, {
        action: 'uploadProjectFile',
        id: ctx.id,
      });
      throw new Error(`project_files insert failed: ${fileError.code}`);
    }

    revalidateTag('projects', 'max');
    revalidateTag(`project:${project.slug}`, 'max');
    logAdmin('uploadProjectFile', ctx, user.id, { type: 'project', id: data.project_id }, data);
    return ok<UploadProjectFileData>({
      version_id: versionId,
      file: {
        id: fileRow.id,
        filename: parsed.filename,
        size_bytes: bytes.byteLength,
        sha512,
      },
    });
  });
}
