/**
 * tests/helpers/factories.ts — row factories (05 §1.3): insert via the service client, return ids;
 * every factory-created row is tagged (`created_by` / slug prefix `t_`) and removed by `afterEach` cleanup.
 * Real implementations land in S1.2 (05 §8); at S0 these are typed stubs.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type FactoryOverrides = Record<string, Json | undefined>;

export type ProjectOverrides = FactoryOverrides & {
  source?: 'modrinth' | 'curseforge' | 'odsens';
  status?: 'draft' | 'published' | 'hidden';
};
export type UserOverrides = FactoryOverrides & {
  role?: 'user' | 'moderator' | 'admin';
  banned?: boolean;
  handle?: string | null;
};

type Factory<O extends FactoryOverrides = FactoryOverrides> = (overrides?: O) => Promise<string>;

function notYet<O extends FactoryOverrides>(name: string): Factory<O> {
  return () => {
    throw new Error(`${name}: available from S1.2`);
  };
}

export const makeProject: Factory<ProjectOverrides> = notYet('makeProject');
export const makeVersion: Factory = notYet('makeVersion');
export const makeFile: Factory = notYet('makeFile');
export const makeComment: Factory = notYet('makeComment');
export const makeUser: Factory<UserOverrides> = notYet('makeUser');
export const makeMention: Factory = notYet('makeMention');
export const makeVideo: Factory = notYet('makeVideo');
export const makeSkin: Factory = notYet('makeSkin');
export const makeArt: Factory = notYet('makeArt');
export const makeSyncRun: Factory = notYet('makeSyncRun');

/** Removes every row created by the factories in the current test (called from `afterEach`). */
export const cleanupFactories: () => Promise<void> = () => {
  throw new Error('cleanupFactories: available from S1.2');
};
