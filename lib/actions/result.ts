/**
 * lib/actions/result.ts — the one result shape for Server Actions and route-handler error JSON
 * (04 SC-03, 04 §7, 01 INV-19/INV-44, ADR-0002 C14). No 'use server' directive here (01 INV-04).
 */

/** Exhaustive error code union — 04 §7 verbatim (05 uses these names). */
export type ActionErrorCode =
  | 'unauthenticated'
  | 'unauthorized'
  | 'onboarding_required'
  | 'forbidden'
  | 'banned'
  | 'not_found'
  | 'validation'
  | 'too_many_links'
  | 'comments_closed'
  | 'edit_window_expired'
  | 'handle_taken'
  | 'handle_reserved'
  | 'conflict'
  | 'precondition_failed'
  | 'rate_limited'
  | 'upstream_error'
  | 'storage_error'
  | 'job_failed'
  | 'internal';

export type Issue = { path: string; message: string };

export type ActionError = {
  code: ActionErrorCode;
  message: string;
  field?: string;
  issues?: Issue[];
};

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: ActionError };

/** HTTP status per 04 §7 for route handlers returning `{ok:false, error}` JSON. */
export const ERROR_STATUS: Record<ActionErrorCode, number> = {
  unauthenticated: 401,
  unauthorized: 401,
  onboarding_required: 403,
  forbidden: 403,
  banned: 403,
  not_found: 404,
  validation: 400,
  too_many_links: 400,
  comments_closed: 409,
  edit_window_expired: 409,
  handle_taken: 409,
  handle_reserved: 409,
  conflict: 409,
  precondition_failed: 409,
  rate_limited: 429,
  upstream_error: 502,
  storage_error: 500,
  job_failed: 500,
  internal: 500,
};

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  code: ActionErrorCode,
  message: string,
  extra?: { field?: string; issues?: Issue[] },
): ActionResult<T> {
  return { ok: false, error: { code, message, ...extra } };
}
