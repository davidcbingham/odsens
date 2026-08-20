/**
 * tests/helpers/actionResult.ts — narrowing assertions over `ActionResult<T>` (04 SC-03; 05 T-ACT-0).
 *
 *   const data = expectOk(res);                 // fails loudly with the error payload when `ok:false`
 *   const error = expectFail(res, 'validation'); // asserts `ok:false` + `error.code`, returns the error
 *
 * Both check the 04 SC-03 shape (`{ok:true, data}` | `{ok:false, error:{code, message, field?, issues?}}`)
 * on every call, so every T-ACT row re-proves T-ACT-0 (1) for free.
 */
import { expect } from 'vitest';
import {
  ERROR_STATUS,
  type ActionError,
  type ActionErrorCode,
  type ActionResult,
} from '@/lib/actions/result';

const ERROR_KEYS: ReadonlySet<string> = new Set(['code', 'message', 'field', 'issues']);

/** Every `ActionErrorCode` (04 §7 union) — `ERROR_STATUS` is keyed by the full union. */
export const ACTION_ERROR_CODES: ReadonlySet<string> = new Set(Object.keys(ERROR_STATUS));

/** Asserts the SC-03 envelope (either arm) without caring which arm it is. */
export function expectResultShape<T>(res: ActionResult<T>): void {
  expect(typeof res).toBe('object');
  if (res.ok) {
    expect(Object.keys(res).sort()).toEqual(['data', 'ok']);
    return;
  }
  expect(Object.keys(res).sort()).toEqual(['error', 'ok']);
  const error: ActionError = res.error;
  expect(ACTION_ERROR_CODES.has(error.code), `unknown error code "${error.code}"`).toBe(true);
  expect(typeof error.message).toBe('string');
  expect(error.message.length).toBeGreaterThan(0);
  for (const key of Object.keys(error)) {
    expect(ERROR_KEYS.has(key), `unexpected error key "${key}"`).toBe(true);
  }
  if (error.issues !== undefined) {
    for (const issue of error.issues) {
      expect(Object.keys(issue).sort()).toEqual(['message', 'path']);
      expect(typeof issue.path).toBe('string');
      expect(typeof issue.message).toBe('string');
    }
  }
}

export function expectOk<T>(res: ActionResult<T>): T {
  expectResultShape(res);
  if (!res.ok) {
    throw new Error(`expected ok:true, got ${res.error.code}: ${JSON.stringify(res.error)}`);
  }
  return res.data;
}

export function expectFail<T>(res: ActionResult<T>, code: ActionErrorCode): ActionError {
  expectResultShape(res);
  if (res.ok) {
    throw new Error(`expected ok:false (${code}), got ok:true: ${JSON.stringify(res.data)}`);
  }
  expect(res.error.code).toBe(code);
  return res.error;
}
