'use server';
/**
 * lib/actions/art.ts — `createArt`, `updateArt` (04 §1.4.5 two-phase signed uploads + §1.5;
 * §5.5 scope `upload:art`; SC-18..SC-21, SC-24; 01 INV-14 / INV-51 / INV-52 / INV-53;
 * ADR-0002 C7 / C16; ADR-0048 D2 / D3 / D6 / D8 / D9; 05 T-ACT-60 / T-ACT-61 / T-ACT-73;
 * 00 S1.7 AC6 / AC7 / AC9). Oliver drops a picture on `/admin/art`, titles it, files it under a
 * kind, publishes it; the masonry shows it at its natural size.
 *
 * Every action = `return runAction(name, schema, input, fn)` (never throws to the client). Inside
 * `fn` auth comes first: `requireRole('admin')` — art is admin-only (ADR-0002 C7; a moderator
 * reads `/admin/art` and gets `forbidden` here). The service client comes after (04 SC-06) — RLS
 * on `art` is `is_admin()` for writes too (05 T-RLS-59), enforced twice. SC-24: one keys-only
 * `msg:'admin'` line before every `ok:true`, never on a failure.
 *
 * Limiter (ADR-0048 D9, `upload:art` 60 / hour / admin): every `begin` (U2 — it counts even without a
 * commit, T-ACT-73) and every metadata-only / reorder call; NOT a commit that carries a `path` —
 * that upload was counted at its `begin`.
 *
 * `createArt`
 *   `begin`   → mint the `art_id` (it travels inside the pending path `art/{art_id}/{uuid}.{ext}`,
 *              ADR-0048 D3) → `createSignedUpload` (the one `createSignedUploadUrl` site, INV-51) →
 *              `{ path, token, signed_url }`. No DB row.
 *   (browser PUTs the bytes — `UploadWell` deferred-commit mode, 03 C-17 exception 4)
 *   `commit`  → the echoed `path` must be `art/<uuid>/<uuid>.<ext>` (INV-53; anything else →
 *              `forbidden`, the object untouched — T-ACT-73) and its id must be FREE (a path
 *              naming an existing row's folder is another row's — `forbidden`) → download the
 *              bytes (`UPLOAD_MISSING` → `validation`) → `validateUpload(bytes, 'art')` (magic /
 *              size; fail → delete the object → `validation`) → `imageDimensions` (sharp;
 *              undecodable or a side > 8192 → delete → `validation`) → move to
 *              `art/{art_id}/{hash16}.{ext}` (`ext` from the SNIFFED mime) → insert the row with
 *              the server-derived `width` / `height` (23505 on `slug` → `conflict` on `slug`; the
 *              object stays at its final path). U3: a commit re-sent with that FINAL path (the
 *              admin fixed the slug) is accepted for the same id — the bytes are downloaded again
 *              to re-derive `width` / `height`, nothing is moved. `revalidateTag('art')`.
 *
 * `updateArt` — three forms (ADR-0048 D6 / D8):
 *   `begin`   → a pending path under the EXISTING id (`not_found` when there is none).
 *   `commit`  → only the keys present are written (`year: null` / `credit: null` clear). A `path`
 *              is the same parse (scoped to THIS id: `parseArtPendingPathFor` / the final form) →
 *              validate → move → `image_path` / `width` / `height` in the same update; the OLD
 *              object is deleted afterwards — only after `isOwnArtPath(id, oldPath)` says it is
 *              this row's (ADR-0048 D2; the service role could delete anything) and only when the new
 *              path differs (identical bytes hash to the same path: nothing to delete). A failed
 *              commit never touches an object it did not just validate.
 *   `reorder` → ONE transaction: RPC `reorder_art` (P0002 → `not_found`, nothing applied).
 *
 * Schemas, input types and result shapes live in `./art.schema.ts` (ADR-0013 — every helper below
 * is module-private on purpose).
 */
import { revalidateTag } from 'next/cache';
import {
  createArtInput,
  updateArtInput,
  type ArtRow,
  type CreateArtData,
  type CreateArtInput,
  type SignedUploadData,
  type UpdateArtData,
  type UpdateArtInput,
  type UpdateArtValues,
} from '@/lib/actions/art.schema';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { runAction, type ActionContext } from '@/lib/actions/run';
import { requireRole } from '@/lib/auth';
import {
  ART_BUCKET,
  UPLOAD_MISSING,
  artFinalPath,
  artPendingPath,
  contentHash16,
  createSignedUpload,
  downloadObjectBytes,
  imageDimensions,
  isOwnArtPath,
  mediaExtForMime,
  moveObject,
  parseArtFinalPath,
  parseArtPendingPath,
  removeObject,
  removeObjectQuietly,
  type ArtExt,
} from '@/lib/files';
import { log } from '@/lib/log';
import { assertRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';
import { validateUpload } from '@/lib/validation/files';

type Admin = ReturnType<typeof createAdminClient>;
type ArtUpdate = Database['public']['Tables']['art']['Update'];
type UpdateCommitValues = Extract<UpdateArtValues, { phase: 'commit' }>;
type ReorderItems = Extract<UpdateArtValues, { reorder: unknown }>['reorder'];

const NOT_YOUR_PATH = "That path isn't one of ours.";
const SLUG_TAKEN = 'That slug is already taken.';
const NOT_FOUND_ART = "That piece doesn't exist.";
const NOT_FOUND_IN_REORDER = "One of those pieces doesn't exist.";
const NOT_AN_IMAGE = "That file didn't open as an image.";
const PICK_A_TYPE = 'Pick a png, jpg or webp.';

const UNIQUE_VIOLATION = '23505';
/** `reorder_art` raises it when a listed id matches no row (migration 20260925120100). */
const NO_DATA_FOUND = 'P0002';

/** 04 §1.5: "max 8192 px per side" (the `art_width_check` / `art_height_check` CHECKs). */
const MAX_SIDE = 8192;

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

/** A `validation` failure pinned to its field. */
function fieldFailure(field: string, message: string): ActionResult<never> {
  return fail('validation', message, { field, issues: [{ path: field, message }] });
}

function tooBig(width: number, height: number): string {
  return `That's ${width}×${height}. Pictures can be up to ${MAX_SIDE} pixels a side.`;
}

async function readArt(admin: Admin, id: string): Promise<ArtRow | null> {
  const { data, error } = await admin.from('art').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`art read failed: ${error.code}`);
  return data;
}

/** What a validated image commit hands the row write. */
type CommittedImage = { imagePath: string; width: number; height: number };

/** A parsed commit `path` for ONE art id: the pending form (to validate + move) or the final form (U3). */
type ParsedCommitPath = { form: 'pending' } | { form: 'final'; hash16: string; ext: ArtExt };

/** `path` → this id's pending or final form, or null (another id, another shape) — INV-53. */
function parseCommitPathFor(artId: string, path: string): ParsedCommitPath | null {
  const pending = parseArtPendingPath(path);
  if (pending !== null) return pending.artId === artId ? { form: 'pending' } : null;
  const final = parseArtFinalPath(path);
  if (final !== null && final.artId === artId) {
    return { form: 'final', hash16: final.hash16, ext: final.ext };
  }
  return null;
}

/**
 * The commit-phase byte work for a path already proven to be `artId`'s (SC-19): download →
 * magic / size → dimensions → (pending form) move to the content-addressed final path. A failing
 * pending object is deleted (it was just proven to be this id's); a failing final object is left
 * (it is the row's image, or a stray the admin can overwrite). Returns the image facts or a failure.
 */
async function commitImage(
  artId: string,
  path: string,
  parsed: ParsedCommitPath,
): Promise<CommittedImage | ActionResult<never>> {
  const bytes = await downloadObjectBytes(ART_BUCKET, path);
  if (bytes === null) return fieldFailure('path', UPLOAD_MISSING);

  const pending = parsed.form === 'pending';
  const reject = async (message: string): Promise<ActionResult<never>> => {
    if (pending) await removeObject(ART_BUCKET, path);
    return fieldFailure('path', message);
  };

  const check = validateUpload({ name: path, size: bytes.byteLength, bytes }, 'art');
  if (!check.ok) return reject(check.message);

  const dims = await imageDimensions(bytes);
  if (dims === null) return reject(NOT_AN_IMAGE);
  if (dims.width > MAX_SIDE || dims.height > MAX_SIDE)
    return reject(tooBig(dims.width, dims.height));

  if (!pending) return { imagePath: path, width: dims.width, height: dims.height };

  const ext = mediaExtForMime(check.mime);
  if (ext === null) return reject(PICK_A_TYPE);
  const finalPath = artFinalPath(artId, contentHash16(bytes), ext);
  await moveObject(ART_BUCKET, path, finalPath);
  return { imagePath: finalPath, width: dims.width, height: dims.height };
}

/** 23505 on the insert / update is the slug's unique (the pk is checked before every write). */
function slugConflict(): ActionResult<never> {
  return fail('conflict', SLUG_TAKEN, {
    field: 'slug',
    issues: [{ path: 'slug', message: SLUG_TAKEN }],
  });
}

/** `begin` for either action: the pending path under `artId` + the signed upload URL. */
async function beginUpload(
  artId: string,
  mime: string,
): Promise<SignedUploadData | ActionResult<never>> {
  const ext = mediaExtForMime(mime);
  if (ext === null) return fieldFailure('mime', PICK_A_TYPE);
  return createSignedUpload(ART_BUCKET, artPendingPath(artId, ext));
}

// ---------------------------------------------------------------------------------------------
// createArt — 04 §1.5 (05 T-ACT-60 / T-ACT-61 / T-ACT-73)
// ---------------------------------------------------------------------------------------------

export async function createArt(input: CreateArtInput): Promise<ActionResult<CreateArtData>> {
  return runAction('createArt', createArtInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    const admin = createAdminClient();

    if (data.phase === 'begin') {
      await assertRateLimit('upload:art', user.id);
      const artId = crypto.randomUUID();
      const signed = await beginUpload(artId, data.mime);
      if ('ok' in signed) return signed;
      logAdmin('createArt', ctx, user.id, { type: 'art', id: artId }, data);
      return ok<CreateArtData>(signed);
    }

    // ---- commit ----
    // INV-53: the id comes from the path; the path must be one `begin` could have minted (or the
    // final path a previous commit of the SAME id moved to), and the id must not be a row yet.
    const pending = parseArtPendingPath(data.path);
    const final = pending === null ? parseArtFinalPath(data.path) : null;
    const artId = pending?.artId ?? final?.artId;
    if (artId === undefined) return fail('forbidden', NOT_YOUR_PATH);
    if ((await readArt(admin, artId)) !== null) return fail('forbidden', NOT_YOUR_PATH);

    const image = await commitImage(
      artId,
      data.path,
      pending !== null || final === null
        ? { form: 'pending' }
        : { form: 'final', hash16: final.hash16, ext: final.ext },
    );
    if ('ok' in image) return image;

    const { data: row, error } = await admin
      .from('art')
      .insert({
        id: artId,
        slug: data.slug,
        title: data.title,
        kind: data.kind,
        image_path: image.imagePath,
        width: image.width,
        height: image.height,
        year: data.year ?? null,
        credit: data.credit ?? null,
        downloadable: data.downloadable,
        status: data.status,
        sort_order: data.sort_order,
      })
      .select()
      .single();
    if (error) {
      // The object stays at its final path: a corrected re-submit sends that path back (U3).
      if (error.code === UNIQUE_VIOLATION) return slugConflict();
      throw new Error(`art insert failed: ${error.code}`);
    }

    revalidateTag('art', 'max');
    logAdmin('createArt', ctx, user.id, { type: 'art', id: row.id }, data);
    return ok<CreateArtData>({ art: row });
  });
}

// ---------------------------------------------------------------------------------------------
// updateArt — 04 §1.5 (05 T-ACT-60)
// ---------------------------------------------------------------------------------------------

/** What one applied form hands back to the action's single revalidate + audit + `ok` tail. */
type Applied = {
  data: UpdateArtData;
  target: { type: string; id: string | null };
  /** The keys the audit line lists. */
  audited: object;
};

/** `{reorder}`: one RPC = one transaction; an unknown id → P0002 → `not_found`, nothing applied. */
async function applyReorder(
  admin: Admin,
  reorder: ReorderItems,
): Promise<Applied | ActionResult<never>> {
  const { data: reordered, error } = await admin.rpc('reorder_art', { p_items: reorder });
  if (error) {
    if (error.code === NO_DATA_FOUND) return fail('not_found', NOT_FOUND_IN_REORDER);
    throw new Error(`reorder_art failed: ${error.code}`);
  }
  return { data: { reordered }, target: { type: 'art', id: null }, audited: { reorder } };
}

/** `commit`: the stored row decides `not_found`; a `path` replaces the image and deletes the old object. */
async function applyCommit(
  admin: Admin,
  values: UpdateCommitValues,
  ctx: ActionContext,
): Promise<Applied | ActionResult<never>> {
  const { id, path } = values;
  const stored = await readArt(admin, id);
  if (stored === null) return fail('not_found', NOT_FOUND_ART);

  let image: CommittedImage | null = null;
  if (path !== undefined) {
    // INV-53: the path must be THIS row's pending (or final) form — refused before Storage is touched.
    const parsed = parseCommitPathFor(id, path);
    if (parsed === null) return fail('forbidden', NOT_YOUR_PATH);
    const committed = await commitImage(id, path, parsed);
    if ('ok' in committed) return committed;
    image = committed;
  }

  // Only the provided keys land in the update — an absent one keeps its stored value, `null`
  // clears `year` / `credit`. The schema strips unknown keys (`width` / `height` are never input).
  const typed: ArtUpdate = {
    slug: values.slug,
    title: values.title,
    kind: values.kind,
    year: values.year,
    credit: values.credit,
    downloadable: values.downloadable,
    status: values.status,
    sort_order: values.sort_order,
  };
  const columns: ArtUpdate = Object.fromEntries(
    Object.entries(typed).filter(([, value]) => value !== undefined),
  );
  if (image !== null) {
    columns.image_path = image.imagePath;
    columns.width = image.width;
    columns.height = image.height;
  }

  const { data: row, error } = await admin
    .from('art')
    .update(columns)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) {
    // The new object (if any) stays at its final path for the corrected re-submit (U3).
    if (error.code === UNIQUE_VIOLATION) return slugConflict();
    throw new Error(`art update failed: ${error.code}`);
  }
  // Nothing deletes a piece but the admin (01 INV-24) — only a row removed by hand mid-call.
  if (row === null) return fail('not_found', NOT_FOUND_ART);

  // The old image goes only now (the row no longer points at it), only when it is a different
  // object, and only after the ownership re-check with THIS row's id (ADR-0048 D2).
  if (image !== null && stored.image_path !== image.imagePath) {
    if (isOwnArtPath(id, stored.image_path)) {
      await removeObjectQuietly(ART_BUCKET, stored.image_path, { action: 'updateArt', id: ctx.id });
    } else {
      log.warn({
        action: 'updateArt',
        id: ctx.id,
        msg: 'art_path_not_own',
        meta: { art_id: id },
      });
    }
  }

  return {
    data: { art: row },
    target: { type: 'art', id },
    audited: { id, ...columns, ...(path === undefined ? {} : { path }) },
  };
}

export async function updateArt(input: UpdateArtInput): Promise<ActionResult<UpdateArtData>> {
  return runAction('updateArt', updateArtInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    const admin = createAdminClient();

    if ('reorder' in data) {
      await assertRateLimit('upload:art', user.id);
      const applied = await applyReorder(admin, data.reorder);
      if ('ok' in applied) return applied;
      revalidateTag('art', 'max');
      logAdmin('updateArt', ctx, user.id, applied.target, applied.audited);
      return ok(applied.data);
    }

    if (data.phase === 'begin') {
      await assertRateLimit('upload:art', user.id);
      if ((await readArt(admin, data.id)) === null) return fail('not_found', NOT_FOUND_ART);
      const signed = await beginUpload(data.id, data.mime);
      if ('ok' in signed) return signed;
      logAdmin('updateArt', ctx, user.id, { type: 'art', id: data.id }, data);
      return ok<UpdateArtData>(signed);
    }

    // ---- commit ---- (a commit that carries a path was counted at its begin — ADR-0048 D9)
    if (data.path === undefined) await assertRateLimit('upload:art', user.id);
    const applied = await applyCommit(admin, data, ctx);
    // A failure: nothing was written, so nothing is revalidated and nothing is audited.
    if ('ok' in applied) return applied;

    revalidateTag('art', 'max');
    logAdmin('updateArt', ctx, user.id, applied.target, applied.audited);
    return ok(applied.data);
  });
}
