/**
 * tests/helpers/factories.ts — row factories (05 §1.3): insert via the service client, return ids;
 * every factory-created row is tagged (`t_` prefix) and removed by `cleanupFactories()` (call it from
 * `afterEach` / `afterAll`).
 *
 * S1.1: `makeUser` + `cleanupFactories`. S1.2: `makeProject` / `makeVersion` / `makeFile` /
 * `makeSyncRun` (05 §8 row S1.2). S1.4: `makeComment` (+ `restoreSeedCommentCounts`, `trackComment`,
 * `purgeNotificationEvents`). S1.5: `makeNotificationEvent` / `makeRecipient` (+ `trackNotificationEvent`,
 * `trackRecipient`, `purgeNotificationRecipients`; `purgeNotificationEvents` now empties the recipients
 * queue first). S1.6: `makeVideo` (05 §8 row S1.6). S1.8: `makeMention` (05 §8 row S1.8). Later
 * content factories (`makeSkin`, `makeArt`) stay stubs until their slice.
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
 *   const videoId = await makeVideo({ hidden: true });          // youtube_id `t_<8 hex>0` (11 chars)
 *   const mentionId = await makeMention({ status: 'draft' });   // youtube, external_id `t_<8 hex>0`
 *   const eventId = await makeNotificationEvent({ kind: 'comment.held' }); // subject = SEED-9 …0201
 *   const rowId = await makeRecipient({ event_id: eventId, channel: 'discord', status: 'skipped', address: null });
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
import { SEED_COMMENTS, SEED_PROJECTS, SEED_USERS } from './seedIds';
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
export type CommentOverrides = FactoryOverrides & {
  target_type?: 'project' | 'skin' | 'art' | 'video';
  /** Default: seed project …0102 (pixel-chameleon). */
  target_id?: string;
  /** Default: `seed_user` (…0003). A published insert bumps the author's `comment_count` (trigger). */
  author_id?: string;
  parent_id?: string | null;
  status?: 'published' | 'held' | 'hidden' | 'deleted';
  body?: string;
  created_at?: string;
  moderated_by?: string | null;
  moderated_at?: string | null;
  edited_at?: string | null;
};
/** S1.6 — `videos` columns (supabase/migrations/20260918120000_videos.sql). */
export type VideoOverrides = FactoryOverrides & {
  /** Default `t_<8 hex>0` — exactly 11 chars of `[A-Za-z0-9_-]` (`videos_youtube_id_format`). */
  youtube_id?: string;
  title?: string;
  description?: string | null;
  thumbnail_url?: string;
  /** Default `2026-01-01T12:00:00Z` — older than every SEED-11 row, so a factory video never takes the hero / Home 2-up. */
  published_at?: string;
  duration_seconds?: number | null;
  /** The effective flag every reader filters on; default false. */
  is_short?: boolean;
  /** Admin override (ADR-0043 D1); default NULL = the 04 §5.3 heuristic applies. */
  is_short_override?: boolean | null;
  view_count?: number | null;
  like_count?: number | null;
  synced_at?: string | null;
  hidden?: boolean;
};
/** S1.8 — `mentions` columns (supabase/migrations/20260919120000_mentions.sql). */
export type MentionOverrides = FactoryOverrides & {
  /** Default NULL = "About OddSense generally" (data-model §2.3b); pass a project id to hang it on one. */
  project_id?: string | null;
  /** Default `youtube`. For another platform also pass `external_id: null` (or a platform-native id) and a `url`. */
  platform?: 'youtube' | 'tiktok' | 'twitch' | 'reddit' | 'article' | 'other';
  /** Default `https://www.youtube.com/watch?v=<external_id>` — unique per row (`mentions_url_key`), https (`mentions_url_format`). */
  url?: string;
  /** Default `t_<8 hex>0` — 11 chars of `[A-Za-z0-9_-]` (`mentions_youtube_external_id_format`). */
  external_id?: string | null;
  title?: string;
  creator_name?: string;
  creator_url?: string | null;
  thumbnail_url?: string | null;
  /** Default `2026-01-01T12:00:00Z` — older than both SEED-10 rows, so a factory mention sorts last on "newest first". */
  published_at?: string | null;
  view_count?: number | null;
  /** Default `published` (visible, like `makeProject` / `makeVideo`); `suggested` rows usually also pass `source: 'auto'`. */
  status?: 'draft' | 'suggested' | 'published' | 'hidden';
  source?: 'manual' | 'auto';
  /** Default false — a factory mention never joins the Home strip unless the test features it. */
  featured?: boolean;
  sort_order?: number;
  /** Default: the seed admin (…0001), as `createMention` stamps it (04 §1.6); `null` for an auto row. */
  created_by?: string | null;
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
/** S1.5 — the permanent event catalog (`notification_events_kind_catalog`, docs/notifications.md). */
export type NotificationKind =
  | 'comment.new'
  | 'comment.held'
  | 'comment.reported'
  | 'comment.reply'
  | 'comment.approved'
  | 'sync.failed'
  | 'sync.stale'
  | 'mention.suggested'
  | 'order.new'
  | 'tip.new'
  | 'workroom.post'
  | 'workroom.file'
  | 'workroom.comment';
export type NotificationEventOverrides = FactoryOverrides & {
  /** Default `comment.new`. */
  kind?: NotificationKind;
  /** Default: `seed_user` (…0003); `null` for a job-emitted event (`sync.*`). */
  actor_id?: string | null;
  /** Default `comment` / SEED-9 `…0201` (the published seed comment). */
  subject_type?: string;
  subject_id?: string;
  /** Default: the 04 SC-22 shape `{comment_id, author: {profile_id, handle}}` — never an email. */
  payload?: Json;
  created_at?: string;
};
export type RecipientOverrides = FactoryOverrides & {
  /** Required — create the parent with `makeNotificationEvent` first. */
  event_id?: string;
  /** Default `email`. */
  channel?: 'email' | 'discord' | 'inapp' | 'push';
  /**
   * Default: a `t_<8 hex>@localhost.test` address for `email`, a `https://discord.com/api/webhooks/…`
   * URL for `discord` (F-3: no other addresses in tests); pass `null` for a `skipped` row.
   */
  address?: string | null;
  status?: 'pending' | 'sent' | 'failed' | 'skipped';
  attempts?: number;
  profile_id?: string | null;
  error?: string | null;
  sent_at?: string | null;
  created_at?: string;
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
  // An `id` override must ALSO be the tracked id, or cleanup deletes a phantom row and the
  // factory project leaks past the run (found by S1.3's publishProject suite, 2026-08-27).
  const id = typeof overrides.id === 'string' ? overrides.id : randomUUID();
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
  const id = typeof overrides.id === 'string' ? overrides.id : randomUUID();
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
  const id = typeof overrides.id === 'string' ? overrides.id : randomUUID();
  const row: Record<string, Json> = {
    id,
    filename: `t_${shortTag(id)}.zip`,
    size_bytes: 1024,
    ...defined(overrides),
  };
  return insertContentRow('makeFile', 'project_files', row, createdFiles, id);
};

const createdComments: string[] = [];

/**
 * S1.4: a comment row through the service client (the status trigger keeps the given status for
 * service writes; the `comment_count` trigger bumps the author on a published insert —
 * `cleanupFactories` re-asserts the SEED-3 counts so seed users keep their documented values).
 */
export const makeComment: Factory<CommentOverrides> = async (overrides = {}) => {
  const id = typeof overrides.id === 'string' ? overrides.id : randomUUID();
  const row: Record<string, Json> = {
    id,
    target_type: 'project',
    target_id: SEED_PROJECTS.pixelChameleon,
    author_id: SEED_USERS.seed_user,
    body: `t_${shortTag(id)} factory comment`,
    status: 'published',
    ...defined(overrides),
  };
  return insertContentRow('makeComment', 'comments', row, createdComments, id);
};

/**
 * S1.4: adopts a comment row created OUTSIDE the factories (by `postComment` in an action test) into
 * the cleanup list, so it leaves with the file like a `makeComment` row would (05 H-1). Tracking an id
 * that never lands is harmless — the delete affects 0 rows.
 */
export function trackComment(id: string): void {
  createdComments.push(id);
}

// ---- S1.5 notification factories -------------------------------------------------------------
// `notification_events` rows are the 04 SC-22 shape `emit()` writes; `notification_recipients` rows
// are what `notifyFanOut` creates (04 §3.6 F2). Both are service-only writers (05 T-RLS-91/95), so
// the factories go through `service` like every other; recipients are removed before their events
// in `cleanupFactories` (the FK cascades anyway — explicit so the order reads).

const createdNotificationEvents: string[] = [];
const createdRecipients: string[] = [];

export const makeNotificationEvent: Factory<NotificationEventOverrides> = async (
  overrides = {},
) => {
  const id = typeof overrides.id === 'string' ? overrides.id : randomUUID();
  const row: Record<string, Json> = {
    id,
    kind: 'comment.new',
    actor_id: SEED_USERS.seed_user,
    subject_type: 'comment',
    subject_id: SEED_COMMENTS.published,
    payload: {
      comment_id: SEED_COMMENTS.published,
      author: { profile_id: SEED_USERS.seed_user, handle: 'seed_user' },
    },
    ...defined(overrides),
  };
  return insertContentRow(
    'makeNotificationEvent',
    'notification_events',
    row,
    createdNotificationEvents,
    id,
  );
};

export const makeRecipient: Factory<RecipientOverrides> = async (overrides = {}) => {
  if (typeof overrides.event_id !== 'string') {
    throw new Error(
      'makeRecipient: pass event_id (create the parent with makeNotificationEvent first)',
    );
  }
  const id = typeof overrides.id === 'string' ? overrides.id : randomUUID();
  const tag = shortTag(id);
  const channel = overrides.channel ?? 'email';
  const row: Record<string, Json> = {
    id,
    channel,
    address:
      channel === 'discord'
        ? `https://discord.com/api/webhooks/123/t_${tag}`
        : `t_${tag}@localhost.test`,
    status: 'pending',
    attempts: 0,
    ...defined(overrides),
  };
  return insertContentRow('makeRecipient', 'notification_recipients', row, createdRecipients, id);
};

/** S1.5: adopts an event row created outside the factories (an `emit()` in an action or job test). */
export function trackNotificationEvent(id: string): void {
  createdNotificationEvents.push(id);
}

/** S1.5: adopts a recipient row created outside the factories (a `notifyFanOut` run). */
export function trackRecipient(id: string): void {
  createdRecipients.push(id);
}

/**
 * S1.5: empties `notification_recipients` (SEED-12: the seed keeps it at 0 rows). Service-only
 * writer (05 T-RLS-95). Forgets every tracked recipient id (the rows are gone).
 */
export async function purgeNotificationRecipients(): Promise<void> {
  const { error } = await loose(asRole('service'))
    .from('notification_recipients')
    .delete()
    .not('id', 'is', null);
  if (error) throw new Error(`purgeNotificationRecipients: ${error.message}`);
  createdRecipients.splice(0, createdRecipients.length);
}

/**
 * S1.4: empties `notification_events` (SEED-12: the seed keeps it at 0 rows). Action tests call it in
 * `afterAll` so the events they caused (`comment.new` …) never reach the next file. Service-only
 * table (05 T-RLS-91). S1.5: the recipients queue is emptied first (its rows cascade with the
 * events anyway — explicit so the order reads).
 */
export async function purgeNotificationEvents(): Promise<void> {
  await purgeNotificationRecipients();
  const { error } = await loose(asRole('service'))
    .from('notification_events')
    .delete()
    .not('id', 'is', null);
  if (error) throw new Error(`purgeNotificationEvents: ${error.message}`);
  createdNotificationEvents.splice(0, createdNotificationEvents.length);
}

/** SEED-3 `comment_count` values (05 §3) — restored after factory comments touched them. */
const SEED_COMMENT_COUNTS: ReadonlyArray<[string, number]> = [
  [SEED_USERS.oddsense, 1],
  [SEED_USERS.seed_mod, 0],
  [SEED_USERS.seed_user, 2],
  [SEED_USERS.seed_user2, 0],
  [SEED_USERS.seed_banned, 1],
  [SEED_USERS.seed_newbie, 0],
];

export async function restoreSeedCommentCounts(): Promise<void> {
  const service = loose(asRole('service'));
  for (const [id, comment_count] of SEED_COMMENT_COUNTS) {
    const { error } = await service.from('profiles').update({ comment_count }).eq('id', id);
    if (error) throw new Error(`restoreSeedCommentCounts: ${error.message}`);
  }
}

const createdVideos: string[] = [];

/** Older than every SEED-11 row: a factory video sorts last unless the test dates it. */
const FACTORY_VIDEO_PUBLISHED_AT = '2026-01-01T12:00:00.000Z';

/**
 * The default `youtube_id` `makeVideo` gives the row with this `id`: `t_<8 hex>0` — the `t_` tag
 * (05 §1.3) padded to the 11 chars `videos_youtube_id_format` / `updateVideoInput` (04 §1.8) require.
 */
export function factoryYoutubeId(id: string): string {
  return `t_${shortTag(id)}0`;
}

/**
 * S1.6: a `videos` row through the service client — a visible 300 s long video with the Data-API
 * fields set (pass `null`s for the RSS-only shape, 04 §3.3) and no `is_short_override`
 * (ADR-0043 D1). Returns the row `id`; its `youtube_id` is `factoryYoutubeId(id)` unless overridden.
 */
export const makeVideo: Factory<VideoOverrides> = async (overrides = {}) => {
  const id = typeof overrides.id === 'string' ? overrides.id : randomUUID();
  const tag = shortTag(id);
  const youtubeId = factoryYoutubeId(id);
  const row: Record<string, Json> = {
    id,
    youtube_id: youtubeId,
    title: `t_${tag}`,
    description: 't_ factory video',
    thumbnail_url: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    published_at: FACTORY_VIDEO_PUBLISHED_AT,
    duration_seconds: 300,
    is_short: false,
    view_count: 0,
    like_count: 0,
    hidden: false,
    ...defined(overrides),
  };
  return insertContentRow('makeVideo', 'videos', row, createdVideos, id);
};

const createdMentions: string[] = [];

/** Older than both SEED-10 rows: a factory mention sorts last on "newest first" unless the test dates it. */
const FACTORY_MENTION_PUBLISHED_AT = '2026-01-01T12:00:00.000Z';

/**
 * S1.8: a `mentions` row through the service client — a published, un-featured YouTube mention
 * "about OddSense generally" (`project_id` NULL) with 0 views, created by the seed admin. Its
 * `external_id` is `factoryYoutubeId(id)` and its `url` the canonical watch form of that id (both
 * unique per row — the `t_` tag rides the video id because the url must be https, 05 §1.3). For a
 * non-YouTube row pass `platform`, `url` and `external_id: null`. Returns the row `id`.
 */
export const makeMention: Factory<MentionOverrides> = async (overrides = {}) => {
  const id = typeof overrides.id === 'string' ? overrides.id : randomUUID();
  const tag = shortTag(id);
  const externalId = factoryYoutubeId(id);
  const row: Record<string, Json> = {
    id,
    project_id: null,
    platform: 'youtube',
    url: `https://www.youtube.com/watch?v=${externalId}`,
    external_id: externalId,
    title: `t_${tag}`,
    creator_name: `t_${tag}`,
    creator_url: `https://www.youtube.com/@t_${tag}`,
    thumbnail_url: `https://i.ytimg.com/vi/${externalId}/hqdefault.jpg`,
    published_at: FACTORY_MENTION_PUBLISHED_AT,
    view_count: 0,
    status: 'published',
    source: 'manual',
    featured: false,
    sort_order: 0,
    created_by: SEED_USERS.oddsense,
    ...defined(overrides),
  };
  return insertContentRow('makeMention', 'mentions', row, createdMentions, id);
};

/**
 * S1.8: adopts a mention row created OUTSIDE the factories (by `createMention` in an action test)
 * into the cleanup list, so it leaves with the file like a `makeMention` row would (05 H-1).
 */
export function trackMention(id: string): void {
  createdMentions.push(id);
}

export const makeSkin: Factory = notYet('makeSkin');
export const makeArt: Factory = notYet('makeArt');

export const makeSyncRun: Factory<SyncRunOverrides> = async (overrides = {}) => {
  const id = typeof overrides.id === 'string' ? overrides.id : randomUUID();
  const row: Record<string, Json> = {
    id,
    source: 'modrinth',
    ...defined(overrides),
  };
  return insertContentRow('makeSyncRun', 'sync_runs', row, createdSyncRuns, id);
};

/** Ids per `delete … in (…)` request — the filter rides the URL (see `cleanupFactories`). */
const CLEANUP_CHUNK = 100;

/**
 * Removes every row created by the factories in the current test file: content rows child-first
 * (recipients → events → comments → files → versions → mentions → projects → sync_runs → videos;
 * links/overrides a test hung on a factory project fall to its FK cascade — a mention does not, its
 * FK is `on delete set null`, hence its own entry before `projects`), then avatar objects under
 * `avatars/<id>/`, then the auth user (profiles cascade; `mentions.created_by` is set null).
 * Safe to call when a test already deleted a row — 0 affected rows is a no-op, user "not found" is
 * ignored. Deletes go out `CLEANUP_CHUNK` ids at a time: the `in.(…)` filter rides the request URL,
 * and ~230 tracked uuids in one filter answered "URI too long" — which threw on that table and
 * leaked every table after it (S1.8, `updateMention` reorder legs).
 */
export const cleanupFactories: () => Promise<void> = async () => {
  const service = asRole('service');
  const touchedComments = createdComments.length > 0;
  const contentTables: [table: string, ids: string[]][] = [
    ['notification_recipients', createdRecipients],
    ['notification_events', createdNotificationEvents],
    ['comments', createdComments],
    ['project_files', createdFiles],
    ['project_versions', createdVersions],
    ['mentions', createdMentions],
    ['projects', createdProjects],
    ['sync_runs', createdSyncRuns],
    ['videos', createdVideos],
  ];
  for (const [table, tracked] of contentTables) {
    const ids = tracked.splice(0, tracked.length);
    if (ids.length === 0) continue;
    for (let start = 0; start < ids.length; start += CLEANUP_CHUNK) {
      const chunk = ids.slice(start, start + CLEANUP_CHUNK);
      const { error } = await loose(service).from(table).delete().in('id', chunk);
      if (error) throw new Error(`cleanupFactories: ${table} delete failed: ${error.message}`);
    }
  }
  if (touchedComments) await restoreSeedCommentCounts();
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
