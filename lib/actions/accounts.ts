'use server';
/**
 * lib/actions/accounts.ts — `checkHandle`, `completeOnboarding`, `updateProfile`, `deleteAccount`
 * (04 §1.1; SC-02..SC-08; 01 INV-45..50; ADR-0002 #27 / #28 / #63; ADR-0013).
 *
 * Every action = `return runAction(name, schema, input, fn)` (never throws to the client). Order inside
 * each `fn`: auth (`requireUser` / `requireOnboarded`) → rate limit (`assertRateLimit`, records a hit)
 * → validation that needs I/O (RPC `check_handle` on the user's cookie client — `authenticated` grant)
 * → pure work (avatar re-encode) → writes. Renames, `handle_changed_at` and `avatar_path` go through
 * the service-role client ONLY after the auth check (04 SC-06; `profiles_guard` blocks a JWT user from
 * renaming a non-null handle). The first handle (null → value) is the user's own RLS write.
 *
 * Avatar objects (01 INV-53; ADR-0015 addendum): every Storage delete passes the CALLER's id —
 * `deleteAvatar(user.id, path)` / `deleteAvatarQuietly(user.id, path, …)` refuse a path outside
 * `avatars/{user.id}/` — and every `avatar_path` written here is asserted to be one this action generated
 * for that user (`isOwnAvatarPath`). The DB CHECK `profiles_avatar_path_own` mirrors both.
 *
 * Input schemas live in `./accounts.schema.ts` (a `'use server'` module may export only async
 * functions). No `revalidateTag` here — accounts touch no ISR tag (05 T-ACT-3).
 */
import {
  checkHandleInput,
  completeOnboardingInput,
  deleteAccountInput,
  updateProfileInput,
  type CheckHandleInput,
  type CompleteOnboardingInput,
  type DeleteAccountInput,
  type UpdateProfileInput,
} from '@/lib/actions/accounts.schema';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { runAction } from '@/lib/actions/run';
import { getProfile, requireOnboarded, requireUser } from '@/lib/auth';
import {
  AvatarError,
  deleteAvatar,
  deleteAvatarQuietly,
  isOwnAvatarPath,
  reencodeAvatar,
  uploadAvatar,
} from '@/lib/files';
import { formatDay } from '@/lib/format/date';
import { log } from '@/lib/log';
import { assertRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerClient } from '@/lib/supabase/server';
import { validateUpload } from '@/lib/validation/files';
import {
  HANDLE_RESERVED,
  HANDLE_TAKEN,
  REASON_CHARSET,
  handleReason,
} from '@/lib/validation/handle';

type HandleStatus = 'available' | 'taken' | 'reserved' | 'invalid';

const HANDLE_STATUSES: readonly HandleStatus[] = ['available', 'taken', 'reserved', 'invalid'];
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const UNIQUE_VIOLATION = '23505';

type ProfileData = { handle: string; avatar_path: string | null };

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

/** RPC `check_handle` on the caller's cookie client (security definer; `authenticated` may execute). */
async function checkHandleRpc(handle: string): Promise<HandleStatus> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('check_handle', { p_handle: handle });
  if (error) throw new Error(`check_handle failed: ${error.code}`);
  if (typeof data === 'string' && (HANDLE_STATUSES as readonly string[]).includes(data)) {
    return data as HandleStatus;
  }
  throw new Error('check_handle returned an unexpected value');
}

/** Maps a non-available RPC status onto the 04 §7 code + DESIGN.md §11.1 copy. */
function handleFailure<T>(
  status: Exclude<HandleStatus, 'available'>,
  handle: string,
): ActionResult<T> {
  switch (status) {
    case 'taken':
      return fail<T>('handle_taken', HANDLE_TAKEN, { field: 'handle' });
    case 'reserved':
      return fail<T>('handle_reserved', HANDLE_RESERVED, { field: 'handle' });
    case 'invalid': {
      const message = handleReason(handle) ?? REASON_CHARSET;
      return fail<T>('validation', message, {
        field: 'handle',
        issues: [{ path: 'handle', message }],
      });
    }
  }
}

type PreparedAvatar = { ok: true; bytes: Buffer } | { ok: false; message: string };

/** Magic-byte/size gate + re-encode. Validation problems come back as a message, not a throw. */
async function prepareAvatar(file: File): Promise<PreparedAvatar> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateUpload({ name: file.name, size: file.size, bytes }, 'avatar');
  if (!check.ok) return { ok: false, message: check.message };
  try {
    const encoded = await reencodeAvatar(bytes);
    return { ok: true, bytes: encoded.bytes };
  } catch (error) {
    if (error instanceof AvatarError && error.code === 'validation') {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}

function avatarFailure<T>(message: string): ActionResult<T> {
  return fail<T>('validation', message, {
    field: 'avatar',
    issues: [{ path: 'avatar', message }],
  });
}

/**
 * Guard before every `avatar_path` write: the value must be a path this action generated for `profileId`
 * (`uploadAvatar` always returns one). Anything else is a programming error → thrown → `internal`.
 */
function assertOwnAvatarPath(profileId: string, path: string): void {
  if (!isOwnAvatarPath(profileId, path)) {
    throw new Error('avatar_path outside the caller folder was about to be written');
  }
}

// ---------------------------------------------------------------------------------------------
// checkHandle — 04 §1.1 (thin wrapper; HandleField calls it debounced)
// ---------------------------------------------------------------------------------------------

export async function checkHandle(
  input: CheckHandleInput,
): Promise<ActionResult<{ status: HandleStatus }>> {
  return runAction('checkHandle', checkHandleInput, input, async ({ handle }) => {
    const user = await requireUser();
    await assertRateLimit('check_handle', user.id);
    const status = await checkHandleRpc(handle);
    return ok({ status });
  });
}

// ---------------------------------------------------------------------------------------------
// completeOnboarding — 04 §1.1
// ---------------------------------------------------------------------------------------------

export async function completeOnboarding(
  input: FormData | CompleteOnboardingInput,
): Promise<ActionResult<ProfileData>> {
  return runAction('completeOnboarding', completeOnboardingInput, input, async (data, ctx) => {
    const user = await requireUser();
    const profile = await getProfile();
    if (!profile) throw new Error('profiles row missing for signed-in user');
    if (profile.handle !== null) return fail('conflict', 'You already have a handle.');

    await assertRateLimit('onboarding', user.id);

    const status = await checkHandleRpc(data.handle);
    if (status !== 'available') return handleFailure(status, data.handle);

    const prepared = data.avatar ? await prepareAvatar(data.avatar) : null;
    if (prepared && !prepared.ok) return avatarFailure(prepared.message);

    // Storage first (service role): a failed upload leaves the account un-onboarded and retryable.
    const avatarPath = prepared?.ok ? await uploadAvatar(user.id, prepared.bytes) : null;

    // First handle = the user's own RLS write (null → value; `profiles_guard` allows it).
    const supabase = await createServerClient();
    const { data: row, error } = await supabase
      .from('profiles')
      .update({ handle: data.handle })
      .eq('id', user.id)
      .is('handle', null)
      .select('handle')
      .maybeSingle();
    const cleanup = { action: 'completeOnboarding', id: ctx.id };
    if (error) {
      if (avatarPath) await deleteAvatarQuietly(user.id, avatarPath, cleanup);
      if (error.code === UNIQUE_VIOLATION) return handleFailure('taken', data.handle);
      throw new Error(`profiles update failed: ${error.code}`);
    }
    if (!row) {
      if (avatarPath) await deleteAvatarQuietly(user.id, avatarPath, cleanup);
      return fail('conflict', 'You already have a handle.');
    }

    if (avatarPath) {
      assertOwnAvatarPath(user.id, avatarPath);
      const admin = createAdminClient();
      const { error: avatarError } = await admin
        .from('profiles')
        .update({ avatar_path: avatarPath })
        .eq('id', user.id);
      if (avatarError) throw new Error(`avatar_path update failed: ${avatarError.code}`);
    }

    log.info({
      action: 'completeOnboarding',
      id: ctx.id,
      msg: 'onboarded',
      meta: { profile_id: user.id, handle: data.handle, avatar: avatarPath !== null },
    });
    return ok({ handle: data.handle, avatar_path: avatarPath });
  });
}

// ---------------------------------------------------------------------------------------------
// updateProfile — 04 §1.1 (rename 1 / 7 days via profiles.handle_changed_at; avatar via scope)
// ---------------------------------------------------------------------------------------------

export async function updateProfile(
  input: FormData | UpdateProfileInput,
): Promise<ActionResult<ProfileData>> {
  return runAction('updateProfile', updateProfileInput, input, async (data, ctx) => {
    const { user, profile } = await requireOnboarded();
    const admin = createAdminClient();

    const wantsRename =
      data.handle !== undefined && data.handle.toLowerCase() !== profile.handle.toLowerCase();

    // --- checks first, writes after (a failed avatar must not leave a half-applied rename) ---
    if (wantsRename && data.handle !== undefined) {
      const { data: row, error } = await admin
        .from('profiles')
        .select('handle_changed_at')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw new Error(`handle_changed_at read failed: ${error.code}`);
      const changedAt = row?.handle_changed_at ? new Date(row.handle_changed_at).getTime() : null;
      if (changedAt !== null && Date.now() - changedAt < SEVEN_DAYS_MS) {
        const again = formatDay(new Date(changedAt + SEVEN_DAYS_MS));
        return fail('rate_limited', `You can change it again on ${again}.`, { field: 'handle' });
      }
      const status = await checkHandleRpc(data.handle);
      if (status !== 'available') return handleFailure(status, data.handle);
    }

    let prepared: PreparedAvatar | null = null;
    if (data.avatar) {
      await assertRateLimit('avatar', user.id);
      prepared = await prepareAvatar(data.avatar);
      if (!prepared.ok) return avatarFailure(prepared.message);
    }

    // --- writes (service role; auth already checked) ---
    let handle = profile.handle;
    let avatarPath = profile.avatar_path;

    if (wantsRename && data.handle !== undefined) {
      const { error } = await admin
        .from('profiles')
        .update({ handle: data.handle, handle_changed_at: new Date().toISOString() })
        .eq('id', user.id);
      if (error) {
        if (error.code === UNIQUE_VIOLATION) return handleFailure('taken', data.handle);
        throw new Error(`rename failed: ${error.code}`);
      }
      handle = data.handle;
      log.info({
        action: 'updateProfile',
        id: ctx.id,
        msg: 'renamed',
        meta: { profile_id: user.id, handle },
      });
    }

    if (prepared?.ok) {
      const path = await uploadAvatar(user.id, prepared.bytes);
      assertOwnAvatarPath(user.id, path);
      const { error } = await admin
        .from('profiles')
        .update({ avatar_path: path })
        .eq('id', user.id);
      if (error) throw new Error(`avatar_path update failed: ${error.code}`);
      const previous = avatarPath;
      avatarPath = path;
      // Old object goes only after the new one exists and the row points at it — and only if it is
      // really the caller's (a foreign path is skipped + logged, never deleted).
      if (previous && previous !== path) {
        await deleteAvatarQuietly(user.id, previous, { action: 'updateProfile', id: ctx.id });
      }
    } else if (data.removeAvatar === true && avatarPath !== null) {
      // Throws `validation` ("That picture isn't yours.") for a path outside the caller's folder and
      // `storage_error` on a Storage failure — in both cases nothing has changed.
      await deleteAvatar(user.id, avatarPath);
      const { error } = await admin
        .from('profiles')
        .update({ avatar_path: null })
        .eq('id', user.id);
      if (error) throw new Error(`avatar_path clear failed: ${error.code}`);
      avatarPath = null;
    }

    return ok({ handle, avatar_path: avatarPath });
  });
}

// ---------------------------------------------------------------------------------------------
// deleteAccount — 04 §1.1 (ADR-0002 #28)
// ---------------------------------------------------------------------------------------------

export async function deleteAccount(
  input: DeleteAccountInput,
): Promise<ActionResult<{ deleted: true }>> {
  return runAction('deleteAccount', deleteAccountInput, input, async (_data, ctx) => {
    const { user, profile } = await requireOnboarded();
    await assertRateLimit('delete_account', user.id);

    // S1.4: `comments where author_id = me` → status 'deleted'; `comment_likes` / `comment_reports`
    // by me deleted; `revalidateTag('project:<slug>')` per distinct target — those tables do not exist yet.

    if (profile.avatar_path) {
      await deleteAvatarQuietly(user.id, profile.avatar_path, {
        action: 'deleteAccount',
        id: ctx.id,
      });
    }

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`deleteUser failed: ${error.status ?? 'unknown'}`);

    // The auth user is gone; clear this browser's session cookies without a server round-trip.
    const supabase = await createServerClient();
    await supabase.auth.signOut({ scope: 'local' });

    log.info({
      action: 'deleteAccount',
      id: ctx.id,
      msg: 'deleted',
      meta: { profile_id: user.id },
    });
    return ok({ deleted: true as const });
  });
}
