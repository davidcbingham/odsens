'use server';
/**
 * lib/actions/videos.ts — `updateVideo` (04 §1.8; SC-01..SC-07, SC-15, SC-24; 01 INV-18;
 * ADR-0002 #20 / C7; ADR-0013; ADR-0043 D1 / D11; 05 T-ACT-68, T-ACT-69). The one video mutation:
 * Oliver hides / shows a video and overrides the Shorts rule from the videos list on the `/admin`
 * dashboard — there is no `/admin/videos` route (01 INV-75; 00 §5 00-O-5).
 *
 * The action = `return runAction(name, schema, input, fn)` (never throws to the client). Order
 * inside `fn`: auth (`requireRole('admin')` — videos are admin-only, ADR-0002 C7; moderators get
 * `forbidden`) → the row read (unknown `youtube_id` → `not_found`) → ONE update. The write goes
 * through the service client ONLY after the role check (04 SC-06) — RLS on `videos` is `is_admin()`
 * writes too (05 T-RLS-50..52), enforced twice. No rate limit, no `emit` (04 §1.0 row: "—").
 *
 * Only the keys present in the input are written (an absent key keeps its stored value):
 * - `hidden` → `videos.hidden`. `syncYoutube` never writes it (04 §3.3 step 4; 05 T-ACT-53).
 * - `is_short` (ADR-0043 D1 — the override needs its own column, `videos.is_short_override`;
 *   `is_short` stays the effective flag every reader filters on): `true` / `false` writes BOTH
 *   `is_short_override` and `is_short`; `null` clears the override and recomputes `is_short` from
 *   the STORED `duration_seconds` / `title` / `description` with the adapter's `isShort` (04 §5.3 —
 *   the one implementation, never re-written here), so the row reads exactly what the next sync
 *   would compute. `syncYoutube` never writes the override and computes
 *   `is_short = override ?? isShort(v)`.
 *
 * Returns the effective state `{youtube_id, hidden, is_short}` (04 §1.8 Returns). Revalidates the
 * `videos` tag once (02 §5 matrix: tag only, never a path — SC-07; `/videos` and the Home Latest
 * videos row share that tag). SC-24: the `requireRole` call site logs `msg:'admin'` with meta keys
 * only (no values) before `ok:true`. The input schema lives in `./videos.schema.ts` (a
 * `'use server'` module may export only async functions).
 */
import { revalidateTag } from 'next/cache';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { runAction, type ActionContext } from '@/lib/actions/run';
import { updateVideoInput, type UpdateVideoInput } from '@/lib/actions/videos.schema';
import { isShort } from '@/lib/adapters/youtube';
import { requireRole } from '@/lib/auth';
import { log } from '@/lib/log';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';

type VideoPatch = Database['public']['Tables']['videos']['Update'];

const NOT_FOUND_VIDEO = "That video doesn't exist.";

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

export type UpdateVideoData = { youtube_id: string; hidden: boolean; is_short: boolean };

export async function updateVideo(input: UpdateVideoInput): Promise<ActionResult<UpdateVideoData>> {
  return runAction('updateVideo', updateVideoInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    const admin = createAdminClient();

    // 04 §1.8 Preconditions: the row exists. The same read carries the fields the heuristic needs.
    const { data: stored, error: readError } = await admin
      .from('videos')
      .select('youtube_id, title, description, duration_seconds')
      .eq('youtube_id', data.youtube_id)
      .maybeSingle();
    if (readError) throw new Error(`videos read failed: ${readError.code}`);
    if (stored === null) return fail('not_found', NOT_FOUND_VIDEO);

    // Only the provided keys land in the patch — absent ones keep their stored values.
    const patch: VideoPatch = {};
    if (data.hidden !== undefined) patch.hidden = data.hidden;
    if (data.is_short !== undefined) {
      // ADR-0043 D1: an explicit boolean IS the override; `null` hands the row back to 04 §5.3.
      patch.is_short_override = data.is_short;
      patch.is_short = data.is_short ?? isShort(stored);
    }

    const { data: row, error } = await admin
      .from('videos')
      .update(patch)
      .eq('youtube_id', data.youtube_id)
      .select('youtube_id, hidden, is_short')
      .maybeSingle();
    if (error) throw new Error(`videos update failed: ${error.code}`);
    // Nothing deletes a video (04 J-D), so this is only a row removed by hand mid-call.
    if (row === null) return fail('not_found', NOT_FOUND_VIDEO);

    revalidateTag('videos', 'max');
    logAdmin('updateVideo', ctx, user.id, { type: 'video', id: row.youtube_id }, data);
    return ok<UpdateVideoData>({
      youtube_id: row.youtube_id,
      hidden: row.hidden,
      is_short: row.is_short,
    });
  });
}
