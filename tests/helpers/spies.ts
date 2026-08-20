/**
 * tests/helpers/spies.ts — `spyRevalidateTag` · `spyRevalidatePath` · `spyFetch` · `spyLog` (05 §1.3).
 * `next/cache` `revalidateTag`/`revalidatePath` are `vi.mock`ed in every `db` test; `spyLog` captures
 * `lib/log.ts` output lines. Real implementations land in S1.1 (05 §8); at S0 these are typed stubs.
 */

export type TagSpy = { calls: string[] };
export type PathSpy = { calls: string[] };
export type LogSpy = { lines: object[] };
export type FixtureMap = Record<string, string>; // url (or prefix) → fixture path under tests/fixtures/
export type FetchSpy = { calls: string[]; fetch: typeof fetch };

export const spyRevalidateTag = (): TagSpy => {
  throw new Error('spyRevalidateTag: available from S1.1');
};

export const spyRevalidatePath = (): PathSpy => {
  throw new Error('spyRevalidatePath: available from S1.1');
};

export const spyFetch: (fixtureMap: FixtureMap) => FetchSpy = () => {
  throw new Error('spyFetch: available from S1.1');
};

export const spyLog = (): LogSpy => {
  throw new Error('spyLog: available from S1.1');
};
