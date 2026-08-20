/**
 * tests/helpers/callAction.ts — `callAction(action, input, { role, headers? })` (05 §1.3).
 * Invokes a Server Action module function directly with a mocked `lib/supabase/server.ts` session
 * for the role; returns the action's `ActionResult<T>` (04 SC-03 / ADR-0002 C14). Never goes through HTTP.
 * Real implementation lands in S1.1 (05 §8); at S0 this is a typed stub.
 */
import type { ActionResult } from '@/lib/actions/result';

export type ActionRole = 'anon' | 'user' | 'banned' | 'mod' | 'admin' | 'nohandle' | 'user0';

export type CallActionOptions = { role: ActionRole; headers?: Record<string, string> };

export type CallAction = <TInput, TData>(
  action: (input: TInput) => Promise<ActionResult<TData>>,
  input: TInput,
  options: CallActionOptions,
) => Promise<ActionResult<TData>>;

export const callAction: CallAction = () => {
  throw new Error('callAction: available from S1.1');
};
