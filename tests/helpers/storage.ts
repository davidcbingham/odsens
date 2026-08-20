/**
 * tests/helpers/storage.ts — `uploadFixture(bucket, path, fixtureFile)` · `putSigned(signedUrl, token, fixtureFile)`
 * (05 §1.3, SEED-13). Used by e2e/db global setup to place `tests/fixtures/files/*` and `images/*` behind seed
 * rows; `putSigned` performs the browser step of the two-phase upload (04 §1.4.5).
 * Real implementations land in S1.3 (05 §8); at S0 these are typed stubs.
 */

export type Bucket = 'project-files' | 'project-media' | 'skins' | 'art' | 'avatars';

export const uploadFixture: (
  bucket: Bucket,
  path: string,
  fixtureFile: string,
) => Promise<void> = () => {
  throw new Error('uploadFixture: available from S1.3');
};

export const putSigned: (
  signedUrl: string,
  token: string,
  fixtureFile: string,
) => Promise<Response> = () => {
  throw new Error('putSigned: available from S1.3');
};
