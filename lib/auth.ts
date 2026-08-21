/**
 * lib/auth.ts — the one auth seam (01 INV-32; 04 SC-04; 02 RP-19 / RP-20; ADR-0002 A15; ADR-0013; ADR-0014; ADR-0019).
 *
 * Function exports are exactly `getUser`, `getViewer`, `getProfile`, `requireUser`, `requireOnboarded`,
 * `requireRole`, `safeNext` (+ the types `Role`, `Profile`, `OnboardedProfile`, `Viewer` and the class
 * `AuthError`, a value export since ADR-0013 so `runAction` can map `code`). Only this module and
 * `proxy.ts` call `auth.getUser()`; the raw session is never read anywhere (ADR-0002 A15). Callers
 * receive `{ id }` and the own `profiles` row only — no Google identity field ever leaves this file
 * (01 INV-32).
 *
 * `safeNext` lives in the pure module `lib/validation/next.ts` (client-importable) and is re-exported
 * here so 04 SC-04's export set is unchanged (T-UNIT-44 imports it from this file).
 *
 * Banned accounts (ADR-0019; 04 SC-05): `requireUser()` and `requireOnboarded()` throw
 * `AuthError('banned')` when the caller's own `profiles.is_banned` is true — checked right after the
 * session and before `onboarding_required`, so every account action answers `banned` for a banned
 * caller (04 §1.1). `requireUser()` therefore costs one own-row PK read under RLS (it used to read the
 * session only); `getUser()` / `getViewer()` / `getProfile()` are unchanged. The proxy (02 §3 M4b) keeps
 * a banned browser on `/banned`; this is the server-side half.
 */
import 'server-only';
import type { ActionErrorCode } from '@/lib/actions/result';
import { createServerClient } from '@/lib/supabase/server';

export { safeNext } from '@/lib/validation/next';

export type Role = 'user' | 'moderator' | 'admin';

export type Profile = {
  id: string;
  handle: string | null;
  avatar_path: string | null;
  role: Role;
  is_banned: boolean;
  /** ISO time of the last rename, or null — `/profile` derives its 7-day line from it (ADR-0014). */
  handle_changed_at: string | null;
};

/** A profile past onboarding: `handle` is narrowed to `string` (what `requireOnboarded` returns). */
export type OnboardedProfile = Profile & { handle: string };

export type Viewer = { user: { id: string }; profile: Profile | null };

/** Thrown by the `require*` helpers; `runAction` maps `code` onto `ActionResult` (04 SC-03 / §7). */
export class AuthError extends Error {
  readonly code: ActionErrorCode;

  constructor(code: ActionErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

const PROFILE_COLUMNS = 'id, handle, avatar_path, role, is_banned, handle_changed_at' as const;

type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

/**
 * Own-row read under RLS (`auth.uid() = id`) — the only `from('profiles')` site on the server seam.
 * Pages (`getViewer` / `getProfile`) read it leniently: a failed read renders as "no profile". The
 * `require*` helpers read it strictly — a failed read must not pass as "not banned" / "no handle",
 * so they throw a plain Error, which `runAction` maps to `internal` with one log line (04 SC-03).
 */
async function readOwnProfile(
  supabase: ServerClient,
  userId: string,
  mode: 'lenient' | 'strict' = 'lenient',
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    if (mode === 'strict') throw new Error(`profiles read failed: ${error.code}`);
    return null;
  }
  if (!data) return null;
  return {
    id: data.id,
    handle: data.handle,
    avatar_path: data.avatar_path,
    role: data.role,
    is_banned: data.is_banned,
    handle_changed_at: data.handle_changed_at,
  };
}

async function resolveUser(supabase: ServerClient): Promise<{ id: string } | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

// ---------------------------------------------------------------------------------------------
// Session-backed helpers (dynamic routes, Server Actions, admin layout).
// ---------------------------------------------------------------------------------------------

/** The signed-in user's id, or `null` for anon. Verified server-side (never trusts the cookie alone). */
export async function getUser(): Promise<{ id: string } | null> {
  const supabase = await createServerClient();
  return resolveUser(supabase);
}

/** The caller's own `profiles` row (`id, handle, avatar_path, role, is_banned, handle_changed_at`), or `null`. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createServerClient();
  const user = await resolveUser(supabase);
  if (!user) return null;
  return readOwnProfile(supabase, user.id);
}

/** The one call pages and actions use to know who is asking (04 SC-04). `null` for anon. */
export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createServerClient();
  const user = await resolveUser(supabase);
  if (!user) return null;
  const profile = await readOwnProfile(supabase, user.id);
  return { user, profile };
}

/** 04 §7 `banned` copy for the account actions (ADR-0019); the comments UI keeps its own line. */
const BANNED_MESSAGE = 'This account is banned.';

/** ADR-0019: a banned caller fails every `require*` check before anything else is looked at. */
function assertNotBanned(profile: Profile | null): void {
  if (profile?.is_banned) throw new AuthError('banned', BANNED_MESSAGE);
}

/**
 * Throws `unauthenticated` for anon and `banned` when the caller's own row has `is_banned` (one
 * own-row PK read — ADR-0019). Still returns `{ id }` only (04 SC-04 shape unchanged).
 */
export async function requireUser(): Promise<{ id: string }> {
  const supabase = await createServerClient();
  const user = await resolveUser(supabase);
  if (!user) throw new AuthError('unauthenticated', 'Sign in first.');
  assertNotBanned(await readOwnProfile(supabase, user.id, 'strict'));
  return user;
}

/**
 * Throws `unauthenticated` for anon, `banned` for a banned account (ADR-0019 — before the handle is
 * looked at), then `onboarding_required` while the handle is still null.
 */
export async function requireOnboarded(): Promise<{
  user: { id: string };
  profile: OnboardedProfile;
}> {
  const supabase = await createServerClient();
  const user = await resolveUser(supabase);
  if (!user) throw new AuthError('unauthenticated', 'Sign in first.');
  const profile = await readOwnProfile(supabase, user.id, 'strict');
  assertNotBanned(profile);
  if (!profile || profile.handle === null) {
    throw new AuthError('onboarding_required', 'Pick a handle first.');
  }
  return { user, profile: { ...profile, handle: profile.handle } };
}

const ROLE_RANK: Record<Role, number> = { user: 0, moderator: 1, admin: 2 };

/**
 * Role order `user < moderator < admin` (04 SC-04). Throws `unauthenticated` for anon and
 * `forbidden` when there is no profile row or its role ranks below `role`. Every admin / moderator
 * action calls this server-side even though RLS also enforces it (defence in depth, 01 INV-18).
 */
export async function requireRole(
  role: 'moderator' | 'admin',
): Promise<{ user: { id: string }; profile: Profile }> {
  const viewer = await getViewer();
  if (!viewer) throw new AuthError('unauthenticated', 'Sign in first.');
  const { user, profile } = viewer;
  if (!profile || ROLE_RANK[profile.role] < ROLE_RANK[role]) {
    throw new AuthError('forbidden', 'Not allowed.');
  }
  return { user, profile };
}
