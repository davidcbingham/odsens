'use server';
/**
 * lib/actions/skins.ts — `createSkin`, `updateSkin` (04 §1.5, §3.8, §5.5; SC-18 (the texture
 * travels inline, ≤ 64 KB), SC-19, SC-21, SC-24; 01 INV-14 / INV-52 / INV-53; ADR-0002 C7;
 * ADR-0047 (the renderer); ADR-0048 D2 / D6 / D8 / D7 / D9; 05 T-ACT-56..59; 00 S1.7 AC1 / AC9).
 * Oliver drops a 64×64 PNG on `/admin/skins`, names it, publishes it; the site renders the bust.
 *
 * Every action = `return runAction(name, schema, input, fn)` (never throws to the client). Inside
 * `fn` auth comes first: `requireRole('admin')` — skins are admin-only (ADR-0002 C7; a moderator
 * reads `/admin/skins` and gets `forbidden` here). Then the limiter (`upload:skins`, 60 / hour /
 * admin — ADR-0048 D9: on EVERY call, patch and reorder included), then the service client (04 SC-06) —
 * RLS on `skins` is `is_admin()` for writes too (05 T-RLS-54), enforced twice. SC-24: one keys-only
 * `msg:'admin'` line before every `ok:true`, never on a failure.
 *
 * Texture rule (ADR-0048 D7, in this order): bytes → `pngDimensions` → a PNG that is not exactly 64×64 →
 * `validation` on `texture` with the VERBATIM "Skins need to be 64×64." (04 §1.5; T-ACT-58 /
 * T-E2E-38) → then `validateUpload(file, 'skin')` for the magic bytes + the 64 KB cap (its own
 * copy: "That's a .jpg. Allowed: .png", "That's 100 KB. The limit is 64.", "That's not a readable
 * PNG. Skins are 64×64.").
 *
 * `createSkin` — mints the id, INSERTS the row first (`texture_path = skins/<id>/texture.png`,
 *   the one value the CHECK `skins_texture_path_own` admits; a slug already taken → 23505 →
 *   `conflict` on `slug` with NO object written — the constraint is the atomic answer), then
 *   uploads the texture (`upsert: true`, `image/png`, cache-control 1 y — the path is fixed per
 *   skin), then AWAITS `renderSkinBust(id)` (04 §3.8): a render failure is not a failure of the
 *   save — the row stays, `render_bust_path` stays NULL, the answer is `ok` with
 *   `bust_rendered: false` and the card renders the live fallback. An upload failure after the
 *   insert removes the row again (no skin without its texture — 04 §1.5 "`texture` required") and
 *   answers `storage_error`. Revalidates `skins` once (02 RP-22).
 *
 * `updateSkin` — either form (ADR-0048 D6 / D8):
 *   `{ id, …patch }`  only the keys present are written (`description_md: null` clears). Unknown
 *                     `id` → `not_found`; a taken `slug` → `conflict`. A `texture` is validated as
 *                     above, uploaded to the SAME path (`upsert`), `render_bust_path` is cleared in
 *                     the same update, then `renderSkinBust` runs and the row is re-read. The
 *                     answer's `bust_rendered` = the row now carries a cached bust (so a metadata-
 *                     only patch on a never-rendered skin also says `false` — the form's line
 *                     "The 3D preview will render later" stays true).
 *   `{ reorder }`     ONE transaction: RPC `reorder_skins` (service role only). An id that matches
 *                     no row raises P0002 → `not_found`, nothing applied. Only `sort_order` moves.
 *
 * Ownership (ADR-0048 D2): every Storage write here targets a path DERIVED from the row id
 * (`skinTexturePath(id)`), never a path read from input, and nothing in this module deletes an
 * object (a replaced texture overwrites its own path, the bust overwrites its own) — so there is
 * no delete to guard; `isOwnSkinPath` (lib/files.ts) exists for whoever adds one.
 *
 * Schemas, input types and result shapes live in `./skins.schema.ts` (ADR-0013 — every helper
 * below is module-private on purpose).
 */
import { revalidateTag } from 'next/cache';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { runAction, type ActionContext } from '@/lib/actions/run';
import {
  createSkinInput,
  updateSkinInput,
  type CreateSkinData,
  type CreateSkinInput,
  type SkinRow,
  type UpdateSkinData,
  type UpdateSkinInput,
  type UpdateSkinValues,
} from '@/lib/actions/skins.schema';
import { requireRole } from '@/lib/auth';
import {
  SKINS_BUCKET,
  StorageError,
  UPLOAD_SAVE_FAILED,
  objectPathInBucket,
  skinTexturePath,
} from '@/lib/files';
import { renderSkinBust } from '@/lib/jobs/renderSkinBust';
import { log } from '@/lib/log';
import { assertRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';
import { pngDimensions, validateUpload } from '@/lib/validation/files';

type Admin = ReturnType<typeof createAdminClient>;
type SkinUpdate = Database['public']['Tables']['skins']['Update'];
type SkinPatchValues = Extract<UpdateSkinValues, { id: string }>;
type ReorderItems = Extract<UpdateSkinValues, { reorder: unknown }>['reorder'];

/** 04 §1.5 — verbatim (T-ACT-58 / T-E2E-38). */
const NOT_64 = 'Skins need to be 64×64.';
const SLUG_TAKEN = 'That slug is already taken.';
const NOT_FOUND_SKIN = "That skin doesn't exist.";
const NOT_FOUND_IN_REORDER = "One of those skins doesn't exist.";

const UNIQUE_VIOLATION = '23505';
/** `reorder_skins` raises it when a listed id matches no row (migration 20260925120100). */
const NO_DATA_FOUND = 'P0002';

/** One year: the texture path is fixed per skin; a replacement is the same URL with new bytes. */
const CACHE_CONTROL_S = '31536000';

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

/** A `validation` failure pinned to its field (the schema cannot see bytes). */
function fieldFailure(field: string, message: string): ActionResult<never> {
  return fail('validation', message, { field, issues: [{ path: field, message }] });
}

/**
 * ADR-0048 D7: a PNG whose IHDR is not 64×64 gets the verbatim copy first; everything else (a JPEG named
 * .png, a PNG with no IHDR, the 64 KB cap) is `validateUpload`'s own copy — the type and size words
 * the `UploadWell` pre-check prints.
 */
async function readTexture(file: File): Promise<Uint8Array | ActionResult<never>> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const dims = pngDimensions(bytes);
  if (dims !== null && (dims.width !== 64 || dims.height !== 64)) {
    return fieldFailure('texture', NOT_64);
  }
  const check = validateUpload({ name: file.name, size: file.size, bytes }, 'skin');
  if (!check.ok) return fieldFailure('texture', check.message);
  return bytes;
}

/** `skins/<id>/texture.png` (`upsert`) — the path is derived from the id, never from input (ADR-0048 D2). */
async function uploadTexture(admin: Admin, skinId: string, bytes: Uint8Array): Promise<void> {
  const objectPath = objectPathInBucket(SKINS_BUCKET, skinTexturePath(skinId));
  if (objectPath === null) throw new StorageError('storage_error', UPLOAD_SAVE_FAILED);
  const { error } = await admin.storage.from(SKINS_BUCKET).upload(objectPath, bytes, {
    contentType: 'image/png',
    upsert: true,
    cacheControl: CACHE_CONTROL_S,
  });
  if (error) throw new StorageError('storage_error', UPLOAD_SAVE_FAILED);
}

async function readSkin(admin: Admin, id: string): Promise<SkinRow | null> {
  const { data, error } = await admin.from('skins').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`skins read failed: ${error.code}`);
  return data;
}

/** The job, then the row as it stands (the job wrote `render_bust_path`, or left it NULL). */
async function renderAndReread(
  admin: Admin,
  id: string,
): Promise<{ skin: SkinRow; bust_rendered: boolean }> {
  await renderSkinBust(id, { db: admin });
  const skin = await readSkin(admin, id);
  // Nothing deletes a skin but the admin (01 INV-24) — only a row removed by hand mid-call.
  if (skin === null) throw new Error('skins read failed: row vanished after render');
  return { skin, bust_rendered: skin.render_bust_path !== null };
}

// ---------------------------------------------------------------------------------------------
// createSkin — 04 §1.5 (05 T-ACT-57 / T-ACT-58)
// ---------------------------------------------------------------------------------------------

export async function createSkin(
  input: CreateSkinInput | FormData,
): Promise<ActionResult<CreateSkinData>> {
  return runAction('createSkin', createSkinInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    await assertRateLimit('upload:skins', user.id);
    const admin = createAdminClient();

    const texture = await readTexture(data.texture);
    if (!(texture instanceof Uint8Array)) return texture;

    const id = crypto.randomUUID();
    const { error } = await admin.from('skins').insert({
      id,
      slug: data.slug,
      name: data.name,
      description_md: data.description_md ?? null,
      texture_path: skinTexturePath(id),
      model: data.model,
      render_bust_path: null,
      is_exclusive: data.is_exclusive,
      status: data.status,
      sort_order: data.sort_order,
    });
    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return fail('conflict', SLUG_TAKEN, {
          field: 'slug',
          issues: [{ path: 'slug', message: SLUG_TAKEN }],
        });
      }
      throw new Error(`skins insert failed: ${error.code}`);
    }

    try {
      await uploadTexture(admin, id, texture);
    } catch (uploadError) {
      // A skin without its texture is not a skin: the row goes with the failed upload.
      const { error: removeError } = await admin.from('skins').delete().eq('id', id);
      if (removeError) {
        log.warn({ action: 'createSkin', id: ctx.id, msg: 'orphan_row', meta: { skin_id: id } });
      }
      throw uploadError;
    }

    const result = await renderAndReread(admin, id);
    revalidateTag('skins', 'max');
    logAdmin('createSkin', ctx, user.id, { type: 'skin', id }, data);
    return ok<CreateSkinData>(result);
  });
}

// ---------------------------------------------------------------------------------------------
// updateSkin — 04 §1.5 (05 T-ACT-57 / T-ACT-59)
// ---------------------------------------------------------------------------------------------

/** What one applied form hands back to the action's single revalidate + audit + `ok` tail. */
type Applied = {
  data: UpdateSkinData;
  target: { type: string; id: string | null };
  /** The keys the audit line lists. */
  audited: object;
};

/** `{reorder}`: one RPC = one transaction; an unknown id → P0002 → `not_found`, nothing applied. */
async function applyReorder(
  admin: Admin,
  reorder: ReorderItems,
): Promise<Applied | ActionResult<never>> {
  const { data: reordered, error } = await admin.rpc('reorder_skins', { p_items: reorder });
  if (error) {
    if (error.code === NO_DATA_FOUND) return fail('not_found', NOT_FOUND_IN_REORDER);
    throw new Error(`reorder_skins failed: ${error.code}`);
  }
  return {
    data: { reordered },
    target: { type: 'skins', id: null },
    audited: { reorder },
  };
}

/** `{id, …patch}`: the stored row decides `not_found`; a texture replaces in place and re-renders. */
async function applyPatch(
  admin: Admin,
  values: SkinPatchValues,
): Promise<Applied | ActionResult<never>> {
  const { id, texture, ...patch } = values;
  const stored = await readSkin(admin, id);
  if (stored === null) return fail('not_found', NOT_FOUND_SKIN);

  let bytes: Uint8Array | null = null;
  if (texture !== undefined) {
    const read = await readTexture(texture);
    if (!(read instanceof Uint8Array)) return read;
    bytes = read;
  }

  // Only the provided keys land in the update — an absent one keeps its stored value, `null`
  // clears the description. The schema strips unknown keys; the annotation pins every key to
  // its column type. A new texture clears the cached bust in the same statement.
  const typed: SkinUpdate = patch;
  const columns: SkinUpdate = Object.fromEntries(
    Object.entries(typed).filter(([, value]) => value !== undefined),
  );
  if (bytes !== null) columns.render_bust_path = null;

  const { data: row, error } = await admin
    .from('skins')
    .update(columns)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return fail('conflict', SLUG_TAKEN, {
        field: 'slug',
        issues: [{ path: 'slug', message: SLUG_TAKEN }],
      });
    }
    throw new Error(`skins update failed: ${error.code}`);
  }
  // Nothing deletes a skin but the admin (01 INV-24) — only a row removed by hand mid-call.
  if (row === null) return fail('not_found', NOT_FOUND_SKIN);

  let data: UpdateSkinData = { skin: row, bust_rendered: row.render_bust_path !== null };
  if (bytes !== null) {
    await uploadTexture(admin, id, bytes);
    data = await renderAndReread(admin, id);
  }

  return {
    data,
    target: { type: 'skin', id },
    audited: { id, ...columns, ...(texture === undefined ? {} : { texture }) },
  };
}

export async function updateSkin(
  input: UpdateSkinInput | FormData,
): Promise<ActionResult<UpdateSkinData>> {
  return runAction('updateSkin', updateSkinInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    await assertRateLimit('upload:skins', user.id);
    const admin = createAdminClient();

    const applied =
      'reorder' in data ? await applyReorder(admin, data.reorder) : await applyPatch(admin, data);
    // A failure: nothing was written, so nothing is revalidated and nothing is audited.
    if ('ok' in applied) return applied;

    revalidateTag('skins', 'max');
    logAdmin('updateSkin', ctx, user.id, applied.target, applied.audited);
    return ok(applied.data);
  });
}
