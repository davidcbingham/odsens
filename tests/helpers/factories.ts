/**
 * tests/helpers/factories.ts — row factories (05 §1.3): insert via the service client, return ids;
 * every factory-created row is tagged (`t_` prefix) and removed by `cleanupFactories()` (call it from
 * `afterEach` / `afterAll`).
 *
 * S1.1: `makeUser` + `cleanupFactories`. S1.2: `makeProject` / `makeVersion` / `makeFile` /
 * `makeSyncRun` (05 §8 row S1.2). Later content factories (`makeComment`…) stay stubs until their slice.
 *
 *   const id = await makeUser({ role: 'moderator' });          // handle `t_<8 hex>`, not banned
 *   const newbie = await makeUser({ handle: null });           // onboarding incomplete
 *   const banned = await makeUser({ banned: true, handle: null });
 *   asUser(id) / callActionAs(action, input, { profileId: id }) act as that user
 *   (email `t_<id>@localhost.test`, password `seed-password`).
 *
 *   const draft = await makeProject({ source: 'odsens', status: 'draft' }); // slug `t_<8 hex>`
 *   const versionId = await makeVersion({ project_id: draft });             // parents are explicit
 *   const fileId = await makeFile({ version_id: versionId });
 *   const runId = await makeSyncRun({ source: 'modrinth' });
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
export type VersionOverrides = FactoryOverrides & {
  /** Required — create the parent with `makeProject` first. */
  project_id?: string;
  version_type?: 'release' | 'beta' | 'alpha';
};
export type FileOverrides = FactoryOverrides & {
  /** Required — create the parent with `makeVersion` first. */
  version_id?: string;
};
export type SyncRunOverrides = FactoryOverrides & {
  /** The 7 registry values (sync_runs_source_check). */
  source?: 'modrinth' | 'curseforge' | 'youtube' | 'mentions' | 'stats' | 'notify' | 'skins';
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

// ---- S1.2 content factories ------------------------------------------------------------------
// Ids created here are tracked per table and removed by `cleanupFactories` (child rows of a factory
// project also fall to its FK cascade; the explicit deletes cover versions/files hung on seed parents).

const createdProjects: string[] = [];
const createdVersions: string[] = [];
const createdFiles: string[] = [];
const createdSyncRuns: string[] = [];

/** Strips `undefined` so overrides merge over the defaults without erasing them. */
function defined(overrides: FactoryOverrides): Record<string, Json> {
  const row: Record<string, Json> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) row[key] = value;
  }
  return row;
}

const shortTag = (id: string): string => id.replace(/-/g, '').slice(0, 8);

async function insertContentRow(
  factory: string,
  table: string,
  row: Record<string, Json>,
  track: string[],
  id: string,
): Promise<string> {
  const { error } = await loose(asRole('service')).from(table).insert(row).select('id');
  if (error) throw new Error(`${factory}: ${table} insert failed: ${error.message}`);
  track.push(id);
  return id;
}

export const makeProject: Factory<ProjectOverrides> = async (overrides = {}) => {
  const id = randomUUID();
  const tag = shortTag(id);
  const row: Record<string, Json> = {
    id,
    source: 'odsens',
    slug: `t_${tag}`,
    project_type: 'mod',
    title: `t_${tag}`,
    description: 't_ factory project',
    body_md: 't_ factory project body',
    categories: [],
    loaders: [],
    game_versions: [],
    status: 'published',
    ...defined(overrides),
  };
  return insertContentRow('makeProject', 'projects', row, createdProjects, id);
};

export const makeVersion: Factory<VersionOverrides> = async (overrides = {}) => {
  if (typeof overrides.project_id !== 'string') {
    throw new Error('makeVersion: pass project_id (create the parent with makeProject first)');
  }
  const id = randomUUID();
  const row: Record<string, Json> = {
    id,
    version_number: `t_${shortTag(id)}`,
    game_versions: [],
    loaders: [],
    version_type: 'release',
    date_published: new Date().toISOString(),
    ...defined(overrides),
  };
  return insertContentRow('makeVersion', 'project_versions', row, createdVersions, id);
};

export const makeFile: Factory<FileOverrides> = async (overrides = {}) => {
  if (typeof overrides.version_id !== 'string') {
    throw new Error('makeFile: pass version_id (create the parent with makeVersion first)');
  }
  const id = randomUUID();
  const row: Record<string, Json> = {
    id,
    filename: `t_${shortTag(id)}.zip`,
    size_bytes: 1024,
    ...defined(overrides),
  };
  return insertContentRow('makeFile', 'project_files', row, createdFiles, id);
};

export const makeComment: Factory = notYet('makeComment');
export const makeMention: Factory = notYet('makeMention');
export const makeVideo: Factory = notYet('makeVideo');
export const makeSkin: Factory = notYet('makeSkin');
export const makeArt: Factory = notYet('makeArt');

export const makeSyncRun: Factory<SyncRunOverrides> = async (overrides = {}) => {
  const id = randomUUID();
  const row: Record<string, Json> = {
    id,
    source: 'modrinth',
    ...defined(overrides),
  };
  return insertContentRow('makeSyncRun', 'sync_runs', row, createdSyncRuns, id);
};

/**
 * Removes every row created by the factories in the current test file: content rows child-first
 * (files → versions → projects → sync_runs; links/overrides a test hung on a factory project fall to
 * its FK cascade), then avatar objects under `avatars/<id>/`, then the auth user (profiles cascade).
 * Safe to call when a test already deleted a row — 0 affected rows is a no-op, user "not found" is
 * ignored.
 */
export const cleanupFactories: () => Promise<void> = async () => {
  const service = asRole('service');
  const contentTables: [table: string, ids: string[]][] = [
    ['project_files', createdFiles],
    ['project_versions', createdVersions],
    ['projects', createdProjects],
    ['sync_runs', createdSyncRuns],
  ];
  for (const [table, tracked] of contentTables) {
    const ids = tracked.splice(0, tracked.length);
    if (ids.length === 0) continue;
    const { error } = await loose(service).from(table).delete().in('id', ids);
    if (error) throw new Error(`cleanupFactories: ${table} delete failed: ${error.message}`);
  }
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
