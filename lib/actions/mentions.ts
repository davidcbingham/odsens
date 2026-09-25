'use server';
/**
 * lib/actions/mentions.ts — `fetchMentionPreview`, `createMention`, `updateMention` (04 §1.6, §5.4,
 * §5.5; SC-01..SC-07, SC-15, SC-24, SC-25; 01 INV-18 / INV-40 / INV-69; ADR-0002 C7 / #33;
 * ADR-0013; ADR-0045; 05 T-ACT-62..64, T-ACT-69). Oliver pastes a link on `/admin/mentions`, reads
 * what the server could find out about it, assigns it to a project (or to "About OddSense
 * generally") and publishes; later he features, hides, reassigns and reorders what is on the list.
 *
 * Every action = `return runAction(name, schema, input, fn)` (never throws to the client). Inside
 * `fn` auth comes first: `requireRole('admin')` — mentions are admin-only (ADR-0002 C7; moderators
 * read `/admin/mentions` and get `forbidden` here). Writes go through the service client ONLY after
 * that check (04 SC-06) — RLS on `mentions` is `is_admin()` for writes too (05 T-RLS-103..105),
 * enforced twice. SC-24: one keys-only `msg:'admin'` line before every `ok:true`, never on a failure.
 *
 * `fetchMentionPreview` — the 04 §5.4 chain. NOTHING is stored and nothing is revalidated.
 *   limiter  `mention_preview`, 30 / minute / admin (04 §5.5) — before DNS and before any request.
 *   step 1   `oembed.assertPublicHost(url)` on the pasted link, for EVERY platform: a host that is
 *            not public (or a resolver that fails) ends the call — nothing below ever runs for it.
 *            What the guard hands back is the normalised https URL every later step uses.
 *   step 2   YouTube: `youtube.oembed` (keyless) → title, creator, creator link, thumbnail.
 *   step 3   YouTube + `YOUTUBE_API_KEY` + a readable video id: `youtube.getVideoMeta(id)` (ADR-0045
 *            — one id, strict id match, 1 unit) → views + date, and any field step 2 left empty.
 *            A failure in 2 or 3 is not the end: the chain goes on with what it has.
 *   step 4   every other platform — and YouTube only when 2 AND 3 produced no title:
 *            `oembed.fetchOpenGraph` (its own guard on every redirect hop, no retry, ≤ 1 MB, HTML only).
 *   step 5   normalise: trimmed, title ≤ 200, creator ≤ 80, `creator_url` / `thumbnail_url` https and
 *            ≤ 512 else `null` (so the preview always round-trips into `createMentionInput`),
 *            `canonical_url` through `canonicalMentionUrl`. A YouTube thumbnail is an
 *            `https://i.ytimg.com/` URL the adapter returned, else the `hqdefault` literal built
 *            from the id (01 INV-54). `source` = the highest step that answered: `data_api` when
 *            step 3 returned the video, else `oembed`, else `og` (ADR-0045; 05 T-ACT-62).
 *   Every `AdapterError` that ends the chain — an SSRF refusal, DNS, a timeout, a 4xx/5xx, a page
 *   that is not HTML or has no title — reaches the client as the ONE `upstream_error` message and
 *   never says why (the guard is no oracle); the reason stays server-side as a `warn` line carrying
 *   the step and the adapter's error code only — never the URL. Anything that is not an
 *   `AdapterError` is a bug and travels on to `runAction` (→ `internal`). An `AdapterError` must
 *   never escape `fn`: its `code` can be `not_found`, which IS an action code, and its message
 *   names the upstream URL.
 *
 * `createMention` — stores the CANONICAL link (`canonicalMentionUrl`: `utm_*` / `si` / `feature`
 *   dropped, any YouTube form → `https://www.youtube.com/watch?v=<id>`), unique on that string
 *   (`mentions_url_key`, 23505 → `conflict` on `url` — the constraint is the atomic answer, there is
 *   no racy pre-read). `project_id` is `null` or an existing project (else `validation` on
 *   `project_id`; a project removed mid-call surfaces as the same answer through 23503).
 *   `source:'manual'`, `created_by` = the acting admin (set by hand: `auth.uid()` is NULL under the
 *   service client). For `platform:'youtube'` the video id read from the link is the `external_id`
 *   (the player, the thumbnail and `refreshMentions` all key on it — a caller's value is only used
 *   when the link carries none) and the stored thumbnail follows the step-5 rule above. Revalidates
 *   `mentions` + the attached project's `project:<slug>` — never `projects` (02 §5; 05 T-ACT-63).
 *
 * `updateMention` — either form (ADR-0045):
 *   `{id, patch}`  only the keys present are written (`null` clears an optional one). Unknown `id` →
 *                  `not_found`; unknown `patch.project_id` → `validation` on `project_id`; a YouTube
 *                  row must keep an 11-char `external_id` — checked against the STORED half when the
 *                  patch carries only one of `platform` / `external_id` (the schema can only see
 *                  both) → `validation` on `external_id`. Revalidates `mentions` + the project it
 *                  left and the project it joined, each once.
 *   `{reorder}`    ONE transaction: RPC `reorder_mentions` (service role only). An id that matches
 *                  no row raises P0002 → `not_found`, nothing applied. Revalidates `mentions` once —
 *                  `sort_order` only orders the Home strip (02 §2.1), so no per-project tag.
 *   `suggested` is unreachable from both schemas; a suggested row goes live only by an explicit
 *   `patch.status = 'published'` (04 §1.6 — never automatic).
 *
 * Schemas, input types and result shapes live in `./mentions.schema.ts` (a `'use server'` module may
 * export only async functions — every helper below is module-private on purpose: an exported async
 * function here would be a public endpoint).
 */
import { revalidateTag } from 'next/cache';
import {
  createMentionInput,
  fetchMentionPreviewInput,
  NOT_A_YOUTUBE_ID,
  updateMentionInput,
  type CreateMentionData,
  type CreateMentionInput,
  type FetchMentionPreviewInput,
  type MentionPreviewData,
  type UpdateMentionData,
  type UpdateMentionInput,
  type UpdateMentionValues,
} from '@/lib/actions/mentions.schema';
import { fail, ok, type ActionResult } from '@/lib/actions/result';
import { runAction, type ActionContext } from '@/lib/actions/run';
import { YOUTUBE_ID_RE } from '@/lib/actions/videos.schema';
import { AdapterError } from '@/lib/adapters/http';
import {
  createOembed,
  detectPlatform,
  type DetectedPlatform,
  type OpenGraph,
} from '@/lib/adapters/oembed';
import {
  createYoutube,
  videoIdFromUrl,
  type VideoMeta,
  type YoutubeOembed,
} from '@/lib/adapters/youtube';
import { requireRole } from '@/lib/auth';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { mentionThumbnail } from '@/lib/mentions';
import { assertRateLimit } from '@/lib/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/types';
import { canonicalMentionUrl } from '@/lib/validation/mention-url';

type Admin = ReturnType<typeof createAdminClient>;
type MentionUpdate = Database['public']['Tables']['mentions']['Update'];
type MentionPatchValues = Extract<UpdateMentionValues, { id: string }>['patch'];
type ReorderItems = Extract<UpdateMentionValues, { reorder: unknown }>['reorder'];

/** 04 §1.6 `fetchMentionPreview` Returns — verbatim, and the same words whatever went wrong. */
const UNREADABLE = "Couldn't read that page. You can fill the fields by hand.";
const DUPLICATE_LINK = 'That link is already on the list.';
const UNKNOWN_PROJECT = "That project doesn't exist.";
const NOT_FOUND_MENTION = "That mention doesn't exist.";
const NOT_FOUND_IN_REORDER = "One of those mentions doesn't exist.";

const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
/** `reorder_mentions` raises it when a listed id matches no row (migration 20260919120100). */
const NO_DATA_FOUND = 'P0002';

/** 04 §5.4 step 5 lengths; `URL_MAX` is the 04 §1.4 shared `URL` bound `createMentionInput` re-checks. */
const TITLE_MAX = 200;
const CREATOR_MAX = 80;
const URL_MAX = 512;
/** 01 INV-54: the one image host a YouTube mention's thumbnail may live on. */
const YTIMG_PREFIX = 'https://i.ytimg.com/';

// ---------------------------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------------------------

/** SC-24: keys-only audit line, logged before every `ok:true` return of a `requireRole` action. */
function logAdmin(
  action: string,
  ctx: ActionContext,
  actorId: string,
  target: { type: string; id: string | null },
  input: object,
): void {
  log.info({
    action,
    id: ctx.id,
    msg: 'admin',
    meta: {
      actor_profile_id: actorId,
      target_type: target.type,
      target_id: target.id,
      fields: Object.keys(input),
    },
  });
}

/** A `validation` failure the schema could not see (it needs a stored row), pinned to its field. */
function fieldFailure(field: string, message: string): ActionResult<never> {
  return fail('validation', message, { field, issues: [{ path: field, message }] });
}

/** The project's slug (for the `project:<slug>` tag), or null when the row does not exist. */
async function readProjectSlug(admin: Admin, projectId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('projects')
    .select('slug')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`projects read failed: ${error.code}`);
  return data?.slug ?? null;
}

/** 02 §5: `mentions` always, plus each affected `project:<slug>` once — never `projects`, never a path. */
function revalidateMentions(slugs: readonly (string | null)[]): void {
  revalidateTag('mentions', 'max');
  for (const slug of new Set(slugs)) {
    if (slug !== null) revalidateTag(`project:${slug}`, 'max');
  }
}

/**
 * ADR-0045 D7 / 01 INV-54: the first offered URL that lives on `i.ytimg.com`, else the `hqdefault` literal
 * built from the id (`mentionThumbnail` — the one place that literal is spelled), else `null`.
 */
function youtubeThumbnail(
  externalId: string | null,
  ...offered: (string | null | undefined)[]
): string | null {
  const kept = offered.find(
    (url) => typeof url === 'string' && url.startsWith(YTIMG_PREFIX) && url.length <= URL_MAX,
  );
  return kept ?? mentionThumbnail({ platform: 'youtube', externalId });
}

// ---------------------------------------------------------------------------------------------
// fetchMentionPreview — 04 §1.6, §5.4 (05 T-ACT-62)
// ---------------------------------------------------------------------------------------------

/** Trimmed and capped at `max` UTF-16 units without splitting a surrogate pair; nothing left → `null`. */
function clip(value: string | null | undefined, max: number): string | null {
  const text = (value ?? '').trim();
  if (text === '') return null;
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max).trimEnd();
}

/** An `https://` URL of at most 512 characters — what `createMentionInput` will accept back — else `null`. */
function httpsUrlOrNull(value: string | null | undefined): string | null {
  const url = (value ?? '').trim();
  if (!url.startsWith('https://') || url.length > URL_MAX) return null;
  return URL.canParse(url) ? url : null;
}

/**
 * One OPTIONAL step of the chain (2 and 3): a typed upstream failure means "nothing from here" and
 * the chain goes on. Anything else is a bug and travels on to `runAction`.
 */
async function orNothing<T>(step: () => Promise<T>): Promise<T | null> {
  try {
    return await step();
  } catch (error) {
    if (error instanceof AdapterError) return null;
    throw error;
  }
}

/**
 * The end of the chain (steps 1 and 4): the one generic answer, whatever the reason — an SSRF
 * refusal must not read differently from a timeout. The reason is logged by code only; the adapter's
 * message names a URL and stays out of every line.
 */
function unreadable(
  ctx: ActionContext,
  step: 'host' | 'page',
  reason: Pick<AdapterError, 'code' | 'status'>,
): ActionResult<MentionPreviewData> {
  log.warn({
    action: 'fetchMentionPreview',
    id: ctx.id,
    msg: 'unreadable',
    meta: { step, code: reason.code, status: reason.status },
  });
  return fail('upstream_error', UNREADABLE);
}

/** Steps 2 + 3 folded (step 2 wins, step 3 fills the gaps and adds views + date); no title → `null`. */
function youtubePreview(
  target: string,
  videoId: string | null,
  embed: YoutubeOembed | null,
  meta: VideoMeta | null,
): MentionPreviewData | null {
  const title = clip(embed?.title, TITLE_MAX) ?? clip(meta?.title, TITLE_MAX);
  if (title === null) return null;
  return {
    platform: 'youtube',
    external_id: videoId,
    canonical_url: canonicalMentionUrl(target),
    title,
    creator_name: clip(embed?.creator_name, CREATOR_MAX) ?? clip(meta?.channel_title, CREATOR_MAX),
    creator_url: httpsUrlOrNull(embed?.creator_url) ?? httpsUrlOrNull(meta?.channel_url),
    thumbnail_url: youtubeThumbnail(videoId, embed?.thumbnail_url, meta?.thumbnail_url),
    published_at: meta?.published_at ?? null,
    view_count: meta?.view_count ?? null,
    source: meta === null ? 'oembed' : 'data_api',
  };
}

/**
 * Step 4's fields; no title → `null` (the adapter answers a title-less page with a typed
 * `parse_error` already — this is the same rule, held here too). `og:site_name` is only a first
 * guess at the creator — the admin edits it (04 §5.4). A YouTube link that ended up here keeps its
 * watch-form address and its `i.ytimg.com` thumbnail.
 */
function pagePreview(
  platform: DetectedPlatform,
  target: string,
  videoId: string | null,
  page: OpenGraph,
): MentionPreviewData | null {
  const title = clip(page.title, TITLE_MAX);
  if (title === null) return null;
  return {
    platform,
    external_id: videoId,
    canonical_url: canonicalMentionUrl(videoId === null ? page.canonical : target),
    title,
    creator_name: clip(page.site_name, CREATOR_MAX),
    creator_url: null,
    thumbnail_url:
      platform === 'youtube' ? youtubeThumbnail(videoId, page.image) : httpsUrlOrNull(page.image),
    published_at: page.published_at,
    view_count: null,
    source: 'og',
  };
}

export async function fetchMentionPreview(
  input: FetchMentionPreviewInput,
): Promise<ActionResult<MentionPreviewData>> {
  return runAction('fetchMentionPreview', fetchMentionPreviewInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    // Before DNS and before any request: a caller over the limit costs nobody else anything.
    await assertRateLimit('mention_preview', user.id, 30, '1 minute');

    // SC-25: built from `lib/env.ts` once per call, no transport passed in. The page reader has no
    // base override of any kind (ADR-0045) — only the adapter-owned YouTube endpoints move in tests.
    const oembed = createOembed({ env });
    const youtube = createYoutube({ env });

    // Step 1 — always, whatever the platform.
    let target: string;
    try {
      target = (await oembed.assertPublicHost(data.url)).href;
    } catch (error) {
      if (error instanceof AdapterError) return unreadable(ctx, 'host', error);
      throw error;
    }

    const platform = detectPlatform(target);
    const videoId = platform === 'youtube' ? videoIdFromUrl(target) : null;

    // Steps 2 + 3 — YouTube only; the pasted link is only ever an encoded query value / an 11-char id.
    let preview: MentionPreviewData | null = null;
    if (platform === 'youtube') {
      const embed = await orNothing(() => youtube.oembed(target));
      const meta =
        youtube.hasKey && videoId !== null
          ? await orNothing(() => youtube.getVideoMeta(videoId))
          : null;
      preview = youtubePreview(target, videoId, embed, meta);
    }

    // Step 4 — every other platform; YouTube only when 2 AND 3 gave nothing.
    if (preview === null) {
      let page: OpenGraph;
      try {
        page = await oembed.fetchOpenGraph(target);
      } catch (error) {
        if (error instanceof AdapterError) return unreadable(ctx, 'page', error);
        throw error;
      }
      preview = pagePreview(platform, target, videoId, page);
      if (preview === null) return unreadable(ctx, 'page', { code: 'parse_error', status: 200 });
    }

    logAdmin('fetchMentionPreview', ctx, user.id, { type: 'mention_preview', id: null }, data);
    return ok(preview);
  });
}

// ---------------------------------------------------------------------------------------------
// createMention — 04 §1.6 (05 T-ACT-63)
// ---------------------------------------------------------------------------------------------

export async function createMention(
  input: CreateMentionInput,
): Promise<ActionResult<CreateMentionData>> {
  return runAction('createMention', createMentionInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    const admin = createAdminClient();

    // 04 §1.6 Preconditions: the canonical form is what is stored and what is unique.
    const url = canonicalMentionUrl(data.url);

    // `project_id` is NULL ("About OddSense generally") or an existing project; its slug is the tag.
    let slug: string | null = null;
    if (data.project_id !== null) {
      slug = await readProjectSlug(admin, data.project_id);
      if (slug === null) return fieldFailure('project_id', UNKNOWN_PROJECT);
    }

    let externalId = data.external_id ?? null;
    let thumbnailUrl = data.thumbnail_url ?? null;
    if (data.platform === 'youtube') {
      // The link's own video id is the truth: the inline player, the thumbnail and
      // `refreshMentions` all key on `external_id`, so it can never name another video.
      externalId = videoIdFromUrl(url) ?? externalId;
      thumbnailUrl = youtubeThumbnail(externalId, thumbnailUrl);
    }

    const { data: row, error } = await admin
      .from('mentions')
      .insert({
        url,
        project_id: data.project_id,
        platform: data.platform,
        external_id: externalId,
        title: data.title,
        creator_name: data.creator_name,
        creator_url: data.creator_url ?? null,
        thumbnail_url: thumbnailUrl,
        published_at: data.published_at ?? null,
        view_count: data.view_count ?? null,
        status: data.status,
        featured: data.featured,
        // Absent → the column default (0).
        ...(data.sort_order === undefined ? {} : { sort_order: data.sort_order }),
        source: 'manual',
        // `auth.uid()` is NULL under the service client — the actor is stamped by hand.
        created_by: user.id,
      })
      .select()
      .single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        return fail('conflict', DUPLICATE_LINK, {
          field: 'url',
          issues: [{ path: 'url', message: DUPLICATE_LINK }],
        });
      }
      // The project went away between the read above and the insert.
      if (error.code === FOREIGN_KEY_VIOLATION && data.project_id !== null) {
        return fieldFailure('project_id', UNKNOWN_PROJECT);
      }
      throw new Error(`mentions insert failed: ${error.code}`);
    }

    revalidateMentions([slug]);
    logAdmin('createMention', ctx, user.id, { type: 'mention', id: row.id }, data);
    return ok<CreateMentionData>({ mention: row });
  });
}

// ---------------------------------------------------------------------------------------------
// updateMention — 04 §1.6 (05 T-ACT-64)
// ---------------------------------------------------------------------------------------------

/** What one applied form hands back to the action's single revalidate + audit + `ok` tail. */
type Applied = {
  data: UpdateMentionData;
  target: { type: string; id: string | null };
  /** `project:<slug>` tags on top of `mentions`. */
  slugs: (string | null)[];
  /** The keys the audit line lists. */
  audited: object;
};

/** `{reorder}`: one RPC = one transaction; an unknown id → P0002 → `not_found`, nothing applied. */
async function applyReorder(
  admin: Admin,
  reorder: ReorderItems,
): Promise<Applied | ActionResult<never>> {
  const { data: reordered, error } = await admin.rpc('reorder_mentions', { p_items: reorder });
  if (error) {
    if (error.code === NO_DATA_FOUND) return fail('not_found', NOT_FOUND_IN_REORDER);
    throw new Error(`reorder_mentions failed: ${error.code}`);
  }
  return {
    data: { reordered },
    target: { type: 'mentions', id: null },
    slugs: [],
    audited: { reorder },
  };
}

/** `{id, patch}`: the stored row decides `not_found`, the platform / id pair and the old project tag. */
async function applyPatch(
  admin: Admin,
  id: string,
  patch: MentionPatchValues,
): Promise<Applied | ActionResult<never>> {
  const { data: stored, error: readError } = await admin
    .from('mentions')
    .select('id, project_id, platform, external_id')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw new Error(`mentions read failed: ${readError.code}`);
  if (stored === null) return fail('not_found', NOT_FOUND_MENTION);

  // `mentions_youtube_external_id_format`, in words: the schema checks the pair only when the patch
  // carries both halves — here the stored half stands in for the missing one.
  const platform = patch.platform ?? stored.platform;
  const externalId = patch.external_id === undefined ? stored.external_id : patch.external_id;
  if (platform === 'youtube' && externalId !== null && !YOUTUBE_ID_RE.test(externalId)) {
    return fieldFailure('external_id', NOT_A_YOUTUBE_ID);
  }

  const oldSlug =
    stored.project_id === null ? null : await readProjectSlug(admin, stored.project_id);
  let newSlug = oldSlug;
  if (patch.project_id !== undefined && patch.project_id !== stored.project_id) {
    newSlug = patch.project_id === null ? null : await readProjectSlug(admin, patch.project_id);
    if (patch.project_id !== null && newSlug === null) {
      return fieldFailure('project_id', UNKNOWN_PROJECT);
    }
  }

  // Only the provided keys land in the update — an absent one keeps its stored value, `null` clears
  // it. The schema strips unknown keys, and the annotation pins every patch key to its column type.
  const typed: MentionUpdate = patch;
  const columns: MentionUpdate = Object.fromEntries(
    Object.entries(typed).filter(([, value]) => value !== undefined),
  );

  const { data: row, error } = await admin
    .from('mentions')
    .update(columns)
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) {
    // The new project went away between the read above and the update.
    if (error.code === FOREIGN_KEY_VIOLATION) return fieldFailure('project_id', UNKNOWN_PROJECT);
    throw new Error(`mentions update failed: ${error.code}`);
  }
  // Nothing deletes a mention (01 INV-24), so this is only a row removed by hand mid-call.
  if (row === null) return fail('not_found', NOT_FOUND_MENTION);

  return {
    data: { mention: row },
    target: { type: 'mention', id: row.id },
    slugs: [oldSlug, newSlug],
    audited: { id, ...columns },
  };
}

export async function updateMention(
  input: UpdateMentionInput,
): Promise<ActionResult<UpdateMentionData>> {
  return runAction('updateMention', updateMentionInput, input, async (data, ctx) => {
    const { user } = await requireRole('admin');
    const admin = createAdminClient();

    const applied =
      'reorder' in data
        ? await applyReorder(admin, data.reorder)
        : await applyPatch(admin, data.id, data.patch);
    // A failure: nothing was written, so nothing is revalidated and nothing is audited.
    if ('ok' in applied) return applied;

    revalidateMentions(applied.slugs);
    logAdmin('updateMention', ctx, user.id, applied.target, applied.audited);
    return ok(applied.data);
  });
}
