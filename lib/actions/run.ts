/**
 * lib/actions/run.ts — `runAction(...)`: the one wrapper every Server Action returns through
 * (04 SC-02 / SC-03 / SC-15; 01 INV-18 / INV-19; ADR-0013).
 *
 *   export async function postComment(input) {
 *     return runAction('postComment', postCommentInput, input, async (data, ctx) => { …; return ok(row); });
 *   }
 *
 * 1. `FormData` → plain object (`formDataToObject`): strings stay strings, `File` values are kept,
 *    empty file inputs (size 0, whatever the name) are dropped; booleans arrive as `'true'`/`'false'`
 *    strings — schemas use `z.preprocess` / `z.coerce` where they need a boolean.
 * 2. `schema.safeParse` → on failure `fail('validation', 'Check the form.', { field, issues })` with
 *    plain-language issues (`{ path, message }`), never zod internals.
 * 3. `fn(input, { id })` inside try/catch: a thrown error whose `code` is an `ActionErrorCode`
 *    (`AuthError`, `RateLimitError`, `AvatarError`, …) → `fail(code, message)`; a thrown `ZodError` →
 *    `validation`; anything else → ONE `log.error({ action, id, msg:'unhandled' })` line and
 *    `fail('internal', 'Something broke.')`. Actions never throw to the client.
 *
 * `ctx.id` is the request id for this call (`crypto.randomUUID()`, 04 SC-15) — pass it to every
 * `log.*` call inside `fn` so one action's lines correlate.
 */
import 'server-only';
import { z } from 'zod';
import {
  ERROR_STATUS,
  fail,
  type ActionErrorCode,
  type ActionResult,
  type Issue,
} from '@/lib/actions/result';
import { log } from '@/lib/log';

export type ActionContext = { id: string };

export const VALIDATION_MESSAGE = 'Check the form.';
export const INTERNAL_MESSAGE = 'Something broke.';

/** `FormData` → object. Multi-valued keys keep the last value (our forms have none). */
export function formDataToObject(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith('$ACTION')) continue; // React's internal action fields, never user input
    if (typeof value !== 'string') {
      // An untouched <input type=file> arrives as a 0-byte File. Node-built FormData keeps name '',
      // but the browser → Next (busboy) path re-wraps it as `File { name: 'blob', size: 0 }`
      // (filename '' is falsy → `append(key, blob, undefined)`), so match on size alone.
      if (value.size === 0) continue;
      out[key] = value;
      continue;
    }
    out[key] = value;
  }
  return out;
}

type CodedError = Error & { code: ActionErrorCode };

/** True when `error` carries a `code` that is a member of the 04 §7 union. */
export function isCodedError(error: unknown): error is CodedError {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && Object.hasOwn(ERROR_STATUS, code);
}

/** Plain-words issue text: a schema's own message is kept verbatim; zod's generic ones are replaced. */
function plainMessage(issue: z.core.$ZodIssue): string {
  if (!issue.message.startsWith('Invalid input')) return issue.message;
  // zod 4 fills `issue.input` only under `reportInput: true`, so "missing" is read off the generic text.
  if (issue.code === 'invalid_type' && issue.message.endsWith('received undefined')) {
    return 'Required.';
  }
  return 'Check this field.';
}

/** zod issues → `{ path, message }[]` with dotted paths and plain messages. */
export function toIssues(error: z.ZodError): Issue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((segment) => String(segment)).join('.'),
    message: plainMessage(issue),
  }));
}

function validationFailure<T>(error: z.ZodError): ActionResult<T> {
  const issues = toIssues(error);
  const field = issues[0]?.path;
  return fail<T>('validation', VALIDATION_MESSAGE, {
    ...(field ? { field } : {}),
    issues,
  });
}

export async function runAction<TIn, TOut>(
  name: string,
  schema: z.ZodType<TIn>,
  raw: unknown,
  fn: (input: TIn, ctx: ActionContext) => Promise<ActionResult<TOut>>,
): Promise<ActionResult<TOut>> {
  const id = crypto.randomUUID();
  const value = raw instanceof FormData ? formDataToObject(raw) : raw;

  const parsed = schema.safeParse(value);
  if (!parsed.success) return validationFailure<TOut>(parsed.error);

  try {
    return await fn(parsed.data, { id });
  } catch (error) {
    if (error instanceof z.ZodError) return validationFailure<TOut>(error);
    if (isCodedError(error)) return fail<TOut>(error.code, error.message);
    log.error({
      action: name,
      id,
      msg: 'unhandled',
      meta: { name: error instanceof Error ? error.name : typeof error },
    });
    return fail<TOut>('internal', INTERNAL_MESSAGE);
  }
}
