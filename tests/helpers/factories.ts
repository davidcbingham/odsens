/**
 * tests/helpers/factories.ts — row factories (05 §1.3): insert via the service client, return ids;
 * every factory-created row is tagged (`t_` prefix) and removed by `cleanupFactories()` (call it from
 * `afterEach` / `afterAll`).
 *
 * S1.1: `makeUser` + `cleanupFactories` are real. Content factories (`makeProject`…) land in S1.2 (05 §8).
 *
 *   const id = await makeUser({ role: 'moderator' });          // handle `t_<8 hex>`, not banned
 *   const newbie = await makeUser({ handle: null });           // onboarding incomplete
 *   const banned = await makeUser({ banned: true, handle: null });
 *   asUser(id) / callActionAs(action, input, { profileId: id }) act as that user
 *   (email `t_<id>@localhost.test`, password `seed-password`).
 */
import { randomUUID } from 'node:crypto';
import {
  asRole,
  factoryEmail,
  forgetSession,
  loose,
  registerUserEmail,
  SEED_PASSWORD,
} from './asRole';
import { forgetSessionCookies } from './sessionCookies';
import { listObjects, removeObjects } from './storage';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type FactoryOverrides = Record<string, Json | undefined>;

export type ProjectOverrides = FactoryOverrides & {
  source?: 'modrinth' | 'curseforge' | 'odsens';
  status?: 'draft' | 'published' | 'hidden';
};
export type UserOverrides = FactoryOverrides & {
  role?: 'user' | 'moderator' | 'admin';
  banned?: boolean;
  /** `undefined` → `t_<8 hex>`; `null` → handle stays NULL (onboarding incomplete). */
  handle?: string | null;
  comment_count?: number;
  handle_changed_at?: string | null;
  avatar_path?: string | null;
  banned_reason?: string | null;
  email_hash?: string | null;
};

type Factory<O extends FactoryOverrides = FactoryOverrides> = (overrides?: O) => Promise<string>;

function notYet<O extends FactoryOverrides>(name: string): Factory<O> {
  return () => {
    throw new Error(`${name}: available from S1.2`);
  };
}

const createdUsers: string[] = [];

/** Profile ids created by `makeUser` in this file so far (read-only view). */
export function createdUserIds(): readonly string[] {
  return createdUsers;
}

const PROFILE_PASSTHROUGH = [
  'comment_count',
  'handle_changed_at',
  'avatar_path',
  'banned_reason',
  'email_hash',
] as const;

export const makeUser: Factory<UserOverrides> = async (overrides = {}) => {
  const service = asRole('service');
  const id = randomUUID();
  const email = factoryEmail(id);
  const { data, error } = await service.auth.admin.createUser({
    id,
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`makeUser: auth.admin.createUser failed: ${error?.message ?? 'no user'}`);
  }
  createdUsers.push(data.user.id);
  registerUserEmail(data.user.id, email);

  const patch: Record<string, Json> = {
    role: overrides.role ?? 'user',
    is_banned: overrides.banned ?? false,
    handle:
      overrides.handle === undefined ? `t_${id.replace(/-/g, '').slice(0, 8)}` : overrides.handle,
  };
  for (const key of PROFILE_PASSTHROUGH) {
    const value = overrides[key];
    if (value !== undefined) patch[key] = value as Json;
  }

  // `handle_new_user` (AFTER INSERT on auth.users) creates the profile row in the same transaction as
  // createUser; a short retry covers any read-after-write lag on the REST side.
  let updated = 0;
  for (let attempt = 0; attempt < 5 && updated === 0; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 100));
    const result = await loose(service)
      .from('profiles')
      .update(patch)
      .eq('id', data.user.id)
      .select('id');
    if (result.error) throw new Error(`makeUser: profiles update failed: ${result.error.message}`);
    updated = result.data?.length ?? 0;
  }
  if (updated === 0) {
    throw new Error(
      `makeUser: no profiles row for ${data.user.id} — is the handle_new_user trigger in place?`,
    );
  }
  return data.user.id;
};

export const makeProject: Factory<ProjectOverrides> = notYet('makeProject');
export const makeVersion: Factory = notYet('makeVersion');
export const makeFile: Factory = notYet('makeFile');
export const makeComment: Factory = notYet('makeComment');
export const makeMention: Factory = notYet('makeMention');
export const makeVideo: Factory = notYet('makeVideo');
export const makeSkin: Factory = notYet('makeSkin');
export const makeArt: Factory = notYet('makeArt');
export const makeSyncRun: Factory = notYet('makeSyncRun');

/**
 * Removes every row created by the factories in the current test file: avatar objects under
 * `avatars/<id>/`, then the auth user (profiles cascade). Safe to call when a test already deleted the
 * user (e.g. `deleteAccount`) — "not found" is ignored.
 */
export const cleanupFactories: () => Promise<void> = async () => {
  const service = asRole('service');
  const ids = createdUsers.splice(0, createdUsers.length);
  const storageFailures: string[] = [];
  for (const id of ids) {
    try {
      const objects = await listObjects('avatars', id);
      await removeObjects('avatars', objects);
    } catch (error) {
      // Only a missing bucket (partial schema) is benign; anything else would leak objects (H-1) and
      // is reported below — after the users are deleted, so a storage hiccup never leaks users too.
      const message = error instanceof Error ? error.message : String(error);
      if (!/bucket not found/i.test(message)) storageFailures.push(`${id}: ${message}`);
    }
    const { error } = await service.auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message) && error.status !== 404) {
      throw new Error(`cleanupFactories: deleteUser(${id}) failed: ${error.message}`);
    }
    forgetSession(factoryEmail(id));
    forgetSessionCookies(factoryEmail(id));
  }
  if (storageFailures.length > 0) {
    throw new Error(
      `cleanupFactories: avatar object cleanup failed (05 H-1) — ${storageFailures.join('; ')}`,
    );
  }
};
