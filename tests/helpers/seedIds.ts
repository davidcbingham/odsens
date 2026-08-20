/**
 * tests/helpers/seedIds.ts — the fixed seed UUIDs from docs/build/05-test-plan.md §3, mirrored so tests
 * reference rows by constant. Scheme: `00000000-0000-4000-8000-00000000<gg><nn>` (the last block is
 * 12 hex chars — 8 zeros + group + index — so it is a valid v4-shaped uuid); groups
 * `00`=users, `01`=projects, `02`=comments, `03`=mentions, `04`=versions, `05`=files, `06`=skins, `07`=art.
 * The rows themselves arrive with their slices (SEED-3 users in S1.1, SEED-4.. later); the constants
 * are stable from S0.
 */
export type SeedGroup =
  'users' | 'projects' | 'comments' | 'mentions' | 'versions' | 'files' | 'skins' | 'art';

export const SEED_GROUP_CODE: Readonly<Record<SeedGroup, string>> = {
  users: '00',
  projects: '01',
  comments: '02',
  mentions: '03',
  versions: '04',
  files: '05',
  skins: '06',
  art: '07',
};

const SEED_UUID_PREFIX = '00000000-0000-4000-8000-00000000';

/** Builds a seed uuid for `group` index `n` (1..99), e.g. seedId('projects', 1) → …0101. */
export function seedId(group: SeedGroup, n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 99) {
    throw new Error(`seedId: n must be an integer 0..99, got ${String(n)}`);
  }
  return `${SEED_UUID_PREFIX}${SEED_GROUP_CODE[group]}${String(n).padStart(2, '0')}`;
}

/** SEED-3 — auth.users / profiles (S1.1). Handles per 05 §3. */
export const SEED_USERS = {
  oddsense: seedId('users', 1), // admin, handle `oddsense`, comment_count 1 (CREATOR)
  seed_mod: seedId('users', 2), // moderator
  seed_user: seedId('users', 3), // user, comment_count 2
  seed_user2: seedId('users', 4), // user, comment_count 0 (first-time commenter)
  seed_banned: seedId('users', 5), // user, is_banned true
  seed_newbie: seedId('users', 6), // handle NULL (onboarding incomplete)
} as const;

/** SEED-4 — projects (S1.2/S1.3). */
export const SEED_PROJECTS = {
  metalPipeMace: seedId('projects', 1), // modrinth, resourcepack, slug metal-pipe-mace
  pixelChameleon: seedId('projects', 2), // modrinth, mod, slug pixel-chameleon (Home hero)
  seedExclusivePack: seedId('projects', 3), // odsens, datapack, slug seed-exclusive-pack
} as const;

/** SEED-9 — comments on project …0102 (S1.4). */
export const SEED_COMMENTS = {
  published: seedId('comments', 1), // by seed_user
  creatorReply: seedId('comments', 2), // by oddsense, parent …0201
  held: seedId('comments', 3), // by seed_user2
  hidden: seedId('comments', 4), // by seed_banned
  deleted: seedId('comments', 5), // by seed_user, 2 days ago
} as const;

/** SEED-10 — mentions (S1.8). */
export const SEED_MENTIONS = {
  youtube: seedId('mentions', 1),
  tiktok: seedId('mentions', 2),
} as const;

/** SEED-5 — project_versions (S1.2/S1.3). */
export const SEED_VERSIONS = {
  exclusive_1_0_0: seedId('versions', 1), // …0103 1.0.0 (release, exclusive)
  mace_1_1_0: seedId('versions', 2), // …0101 1.1.0
  mace_1_0_0: seedId('versions', 3), // …0101 1.0.0
  chameleon_2_0_0_beta_1: seedId('versions', 4), // …0102 2.0.0-beta.1 (beta, 2 files)
} as const;

/** SEED-5 — project_files with fixed ids (S1.2/S1.3). */
export const SEED_FILES = {
  exclusiveZip: seedId('files', 1), // seed-exclusive-pack-1.0.0.zip
} as const;

/** SEED-7 — skins (S1.7). */
export const SEED_SKINS = {
  skinA: seedId('skins', 1), // classic, slug seed-skin-a
  skinB: seedId('skins', 2), // slim, exclusive, slug seed-skin-b
} as const;

/** SEED-8 — art (S1.7). */
export const SEED_ART = {
  avatar: seedId('art', 1), // kind avatar, slug seed-art-avatar
  thumb: seedId('art', 2), // kind thumbnail, slug seed-art-thumb
} as const;
