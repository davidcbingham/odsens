/**
 * tests/helpers/time.ts — `freezeAt(iso)`, `advance(ms)` (05 §1.3, FLK-3). `vi.useFakeTimers` for the app
 * clock; DB `now()` is not faked — tests needing DB time set timestamps via `service` instead.
 * Real implementation lands in S1.4 (05 §8); at S0 these are typed stubs.
 */

export const freezeAt: (iso: string) => void = () => {
  throw new Error('freezeAt: available from S1.4');
};

export const advance: (ms: number) => void = () => {
  throw new Error('advance: available from S1.4');
};
