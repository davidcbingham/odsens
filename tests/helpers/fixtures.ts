/**
 * tests/helpers/fixtures.ts — typed loaders over `tests/fixtures/<source>/<name>` (05 §1.2, F-1..F-5).
 * `loadFixture` returns parsed JSON; `loadFixtureText` returns raw text (xml/html); `fixturePath` resolves
 * the absolute path. Real implementations land in S1.2 with the first F-5 set (05 §8); at S0 typed stubs.
 */

export type FixtureSource =
  | 'modrinth'
  | 'curseforge'
  | 'youtube'
  | 'oembed'
  | 'resend'
  | 'discord'
  | 'kofi'
  | 'files'
  | 'images'
  | 'emails'
  | 'ui';

export const fixturePath: (source: FixtureSource, name: string) => string = () => {
  throw new Error('fixturePath: available from S1.2');
};

export const loadFixture: <T = unknown>(source: FixtureSource, name: string) => Promise<T> = () => {
  throw new Error('loadFixture: available from S1.2');
};

export const loadFixtureText: (source: FixtureSource, name: string) => Promise<string> = () => {
  throw new Error('loadFixtureText: available from S1.2');
};
