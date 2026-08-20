/**
 * tests/helpers/spies.ts — `spyRevalidateTag` · `spyRevalidatePath` · `spyFetch` · `spyLog` (05 §1.3).
 *
 * `next/cache` `revalidateTag`/`revalidatePath` are `vi.mock`ed for every `db` test file by
 * tests/helpers/setup.db.ts (recorders in tests/helpers/actionContext.ts). Calling `spyRevalidateTag()`
 * clears the recording and returns a LIVE view: `calls` keeps growing as the code under test runs.
 *   const tags = spyRevalidateTag();
 *   await callAction(…);
 *   expect(tags.calls).toEqual(['project:pixel-chameleon']);   // literal tag names (05 §1.3)
 *
 * `spyLog()` captures `lib/log.ts` output (one JSON line per call on stdout/stderr) as parsed objects;
 * non-JSON console output is ignored. Call `restore()` in `afterEach`/`afterAll` (a second `spyLog()`
 * restores the previous one first).
 *
 * `spyFetch(fixtureMap)` lands with the first adapter (S1.2, 05 §8) — still a typed stub.
 */
import { vi } from 'vitest';
import { revalidatePathCalls, revalidateTagCalls, resetCacheSpies } from './actionContext';

export type TagSpy = { calls: string[] };
export type PathSpy = { calls: string[] };
export type LogSpy = { lines: object[]; restore: () => void };
export type FixtureMap = Record<string, string>; // url (or prefix) → fixture path under tests/fixtures/
export type FetchSpy = { calls: string[]; fetch: typeof fetch };

export const spyRevalidateTag = (): TagSpy => {
  revalidateTagCalls.length = 0;
  return { calls: revalidateTagCalls };
};

export const spyRevalidatePath = (): PathSpy => {
  revalidatePathCalls.length = 0;
  return { calls: revalidatePathCalls };
};

/** Clears both revalidate recordings and the underlying `vi.fn` call lists. */
export const resetRevalidateSpies = (): void => {
  resetCacheSpies();
};

export const spyFetch: (fixtureMap: FixtureMap) => FetchSpy = () => {
  throw new Error('spyFetch: available from S1.2');
};

let activeLogSpy: LogSpy | null = null;

function parseLine(args: unknown[], into: object[]): void {
  const first = args[0];
  if (typeof first !== 'string') return;
  const text = first.trim();
  if (!text.startsWith('{')) return;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') into.push(parsed as object);
  } catch {
    // not a log line
  }
}

export const spyLog = (): LogSpy => {
  activeLogSpy?.restore();
  const lines: object[] = [];
  const outSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    parseLine(args, lines);
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    parseLine(args, lines);
  });
  const spy: LogSpy = {
    lines,
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
      if (activeLogSpy === spy) activeLogSpy = null;
    },
  };
  activeLogSpy = spy;
  return spy;
};
