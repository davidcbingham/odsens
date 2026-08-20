/**
 * lib/validation/next.ts — `safeNext(next)`: the one validator for a post-sign-in destination
 * (02 RP-20; 01 INV-32; 04 §2.1 A1; 05 T-UNIT-44). Pure — no Next / Supabase dependency — so it is
 * importable from `proxy.ts`, route handlers, pages AND the client island `GoogleSignInButton`
 * (which cannot import the server-only `lib/auth.ts`). `lib/auth.ts` re-exports it so 04 SC-04's
 * export set is unchanged (ADR-0013 / S1.1 brief §2.3).
 */

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
