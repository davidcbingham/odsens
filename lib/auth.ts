/**
 * lib/auth.ts — the one auth seam (01 INV-32; 04 SC-04; 02 RP-19 / RP-20; ADR-0002 A15).
 *
 * Exports exactly `getUser`, `getViewer`, `getProfile`, `requireUser`, `requireOnboarded`,
 * `requireRole`, `safeNext` (+ the types `AuthError`, `Role`, `Profile`, `Viewer`). Only this module
 * and `middleware.ts` call `auth.getUser()`; the raw session is never read anywhere (ADR-0002 A15).
 * Callers receive `{ id }` and the own `profiles` row only — no Google identity field ever leaves
 * this file (01 INV-32).
 *
 * `safeNext` is pure (no Next / Supabase dependency) so T-UNIT-44 can import it directly.
 */
import 'server-only';
import type { ActionErrorCode } from '@/lib/actions/result';
import { createServerClient } from '@/lib/supabase/server';

export type Role = 'user' | 'moderator' | 'admin';

export type Profile = {
  id: string;
  handle: string | null;
  avatar_path: string | null;
  role: Role;
  is_banned: boolean;
};

export type Viewer = { user: { id: string }; profile: Profile | null };

/** Thrown by the `require*` helpers; actions map `code` onto `ActionResult` (04 SC-03 / §7). */
// Internal on purpose: 04 SC-04 / 01 INV-32 fix the export set to the seven names below. The
// `require*` helpers throw it; S1.1 (first consumer) decides how actions surface `code` (SC-03).
class AuthError extends Error {
  readonly code: ActionErrorCode;

  constructor(code: ActionErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------
// safeNext (02 RP-20; T-UNIT-44) — pure, no runtime dependency on next/headers or Supabase.
// ---------------------------------------------------------------------------------------------

/** Same-origin app paths that must never be a post-sign-in destination. */
const BLOCKED_PREFIXES = ['/api', '/auth', '/admin'] as const;

const CODE_SPACE = 0x20;
const CODE_BACKSLASH = 0x5c;
const CODE_DEL = 0x7f;

/**
 * True when `value` carries an ASCII control character (CR / LF / TAB / NUL …), DEL or a backslash.
 * Browsers strip tabs and newlines before URL parsing, so a tab after the slash would otherwise let
 * `/<tab>/evil` become `//evil`; CR / LF would allow header injection in a `Location` header.
 */
function hasForbiddenChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < CODE_SPACE || code === CODE_DEL || code === CODE_BACKSLASH) return true;
  }
  return false;
}

/**
 * Validates a `next` query value as an in-app path. Returns it unchanged when it is a string that
 * starts with `/`, does not start with `//` or `/\`, carries no backslash / control character, and
 * does not target `/api`, `/auth` or `/admin` (exact, or followed by `/`, `?`, `#`). Otherwise `/`.
 */
export function safeNext(next: string | null | undefined): string {
  if (typeof next !== 'string' || next === '') return '/';
  if (!next.startsWith('/')) return '/';
  if (next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (hasForbiddenChar(next)) return '/';
  for (const prefix of BLOCKED_PREFIXES) {
    if (next === prefix) return '/';
    if (next.startsWith(prefix)) {
      const boundary = next.charAt(prefix.length);
      if (boundary === '/' || boundary === '?' || boundary === '#') return '/';
    }
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Session-backed helpers (dynamic routes, Server Actions, admin layout).
// ---------------------------------------------------------------------------------------------

/** The signed-in user's id, or `null` for anon. Verified server-side (never trusts the cookie alone). */
export async function getUser(): Promise<{ id: string } | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id };
}

/** The caller's own `profiles` row (`id, handle, avatar_path, role, is_banned`), or `null`. */
export async function getProfile(): Promise<Profile | null> {
  // S1.1 wires the own-row read (the profiles table does not exist yet)
  return null;
}

/** The one call pages and actions use to know who is asking (04 SC-04). `null` for anon. */
export async function getViewer(): Promise<Viewer | null> {
  const user = await getUser();
  if (!user) return null;
  const profile = await getProfile();
  return { user, profile };
}

/** Throws `AuthError('unauthenticated')` for anon. */
export async function requireUser(): Promise<{ id: string }> {
  const user = await getUser();
  if (!user) throw new AuthError('unauthenticated', 'Sign in first.');
  return user;
}

/** Throws `unauthenticated` for anon and `onboarding_required` while the handle is still null. */
export async function requireOnboarded(): Promise<{ user: { id: string }; profile: Profile }> {
  const user = await requireUser();
  const profile = await getProfile();
  if (!profile || profile.handle === null) {
    throw new AuthError('onboarding_required', 'Pick a handle first.');
  }
  return { user, profile };
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
  const user = await requireUser();
  const profile = await getProfile();
  if (!profile || ROLE_RANK[profile.role] < ROLE_RANK[role]) {
    throw new AuthError('forbidden', 'Not allowed.');
  }
  return { user, profile };
}
