/**
 * lib/data/comments.ts — the public thread read for `/projects/[slug]` (registry Modules
 * `data/comments.ts`; 04 §1.2 "Reads", ADR-0002 C1 / #71; 02 §2.3 "Data (ISR shell)") and the
 * `CommentView` type every comment surface shares (04 §1.2 — verbatim; 03 §2.4 imports it).
 *
 * Server-only; the cookie-less anon client (01 INV-15) over the definer view `comments_public`
 * (every row of a visible target is a slot; `body`/`author_id`/`edited_at` are non-NULL only for
 * `published` rows — the anon read never sees a held/hidden/deleted body) joined with
 * `public_profiles` (the only cross-user read, 01 INV-45). Cached under `project:<slug>` with the
 * page's 600 s (01 INV-38; 02 §5 — every comment action revalidates that tag).
 *
 * Slot rules (`buildPublicSlots`, pure — 05 T-E2E-3 "3 TOTAL" on seed; ADR-0002 #76; ADR-0028 D1;
 * DESIGN.md §11.2): `published` → the full view; `hidden` → the "Hidden by a moderator." slot
 * (no body, no author) at any depth; `deleted` → the "Deleted." slot ONLY for a root that still
 * has a visible reply (a reply-less deleted root and every deleted reply leave the thread);
 * `held` → dropped here (the author's own held rows and the moderators' view merge in
 * client-side, 03 C-17 exception 5). Roots oldest first, replies oldest first, replies right
 * after their root — the display order `CommentThread` renders. `total` = the slots returned.
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import { publicStorageUrl } from '@/lib/data/projects';
import { createAnonClient } from '@/lib/supabase/anon';
import type { Database } from '@/lib/supabase/types';

export type CommentStatus = Database['public']['Enums']['comment_status'];
export type CommentTargetType = Database['public']['Enums']['comment_target'];

/** 04 §1.2 `CommentView.author`. */
export type CommentAuthor = {
  id: string;
  handle: string;
  avatarUrl: string | null;
  role: 'user' | 'moderator' | 'admin';
};

/** 04 §1.2 `CommentView` — the type home; returned by `postComment`/`editComment`, consumed by 03 `CommentThread`/`Comment`/`Composer.onPosted`. */
export type CommentView = {
  id: string;
  body: string;
  status: CommentStatus;
  createdAt: string;
  editedAt: string | null;
  parentId: string | null;
  likeCount: number;
  likedByViewer: boolean;
  /** Mods only (from RPC `moderator_thread`). */
  isFirstComment?: boolean;
  /** Mods only (from RPC `moderator_thread`): unresolved reports. */
  reportCount?: number;
  author: CommentAuthor | null;
};

/** The thread target — v1: projects only (ADR-0002 C21); `slug` feeds the cache tag. */
export type CommentTarget = { type: 'project'; id: string; slug: string };

export type PublicThread = { comments: CommentView[]; total: number };

const REVALIDATE_S = 600;
const projectTag = (slug: string): string => `project:${slug}`;

// ---- Pure helpers (unit-testable; no I/O) ----------------------------------------------------

/** Public-bucket URL of a `profiles.avatar_path` (04 SC-21 `avatars/{profile_id}/{hash}.webp`). */
export function avatarUrlFor(avatarPath: string | null): string | null {
  return avatarPath ? publicStorageUrl(`avatars/${avatarPath}`) : null;
}

/** One `comments_public` row with the identity columns present (view types are all-nullable). */
export type PublicSlotRow = {
  id: string;
  parent_id: string | null;
  status: CommentStatus;
  created_at: string;
  like_count: number;
  body: string | null;
  author_id: string | null;
  edited_at: string | null;
};

/** The eight columns the thread read selects (the generated view type is all-nullable). */
type ViewRow = Pick<
  Database['public']['Views']['comments_public']['Row'],
  'id' | 'parent_id' | 'status' | 'created_at' | 'like_count' | 'body' | 'author_id' | 'edited_at'
>;

/** Drops rows the generated (all-nullable) view type cannot vouch for. */
export function narrowPublicRows(rows: readonly ViewRow[]): PublicSlotRow[] {
  const out: PublicSlotRow[] = [];
  for (const row of rows) {
    if (row.id === null || row.status === null || row.created_at === null) continue;
    out.push({
      id: row.id,
      parent_id: row.parent_id,
      status: row.status,
      created_at: row.created_at,
      like_count: row.like_count ?? 0,
      body: row.body,
      author_id: row.author_id,
      edited_at: row.edited_at,
    });
  }
  return out;
}

function byCreated(a: PublicSlotRow, b: PublicSlotRow): number {
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

function toView(
  row: PublicSlotRow,
  authors: ReadonlyMap<string, CommentAuthor>,
  status: CommentStatus,
): CommentView {
  const exposed = status === 'published';
  return {
    id: row.id,
    body: exposed ? (row.body ?? '') : '',
    status,
    createdAt: row.created_at,
    editedAt: exposed ? row.edited_at : null,
    parentId: row.parent_id,
    likeCount: row.like_count,
    likedByViewer: false,
    author: exposed && row.author_id !== null ? (authors.get(row.author_id) ?? null) : null,
  };
}

/**
 * The slot rule (header): published + hidden slots at any depth; a deleted root only while it has
 * a visible reply; held and deleted replies dropped. Output order = display order.
 */
export function buildPublicSlots(
  rows: readonly PublicSlotRow[],
  authors: ReadonlyMap<string, CommentAuthor>,
): CommentView[] {
  const roots = rows.filter((row) => row.parent_id === null).sort(byCreated);
  const repliesByRoot = new Map<string, PublicSlotRow[]>();
  for (const row of rows) {
    if (row.parent_id === null) continue;
    const list = repliesByRoot.get(row.parent_id) ?? [];
    list.push(row);
    repliesByRoot.set(row.parent_id, list);
  }

  const renderableReply = (row: PublicSlotRow): boolean =>
    row.status === 'published' || row.status === 'hidden';

  const out: CommentView[] = [];
  for (const root of roots) {
    const replies = (repliesByRoot.get(root.id) ?? []).filter(renderableReply).sort(byCreated);
    if (root.status === 'held') continue;
    if (root.status === 'deleted' && replies.length === 0) continue;
    out.push(toView(root, authors, root.status));
    for (const reply of replies) out.push(toView(reply, authors, reply.status));
  }
  return out;
}

// ---- The read --------------------------------------------------------------------------------

async function fetchPublicThread(target: CommentTarget): Promise<PublicThread> {
  const client = createAnonClient();
  const { data, error } = await client
    .from('comments_public')
    .select('id, parent_id, status, created_at, like_count, body, author_id, edited_at')
    .eq('target_type', target.type)
    .eq('target_id', target.id)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`lib/data/comments: thread read failed — ${error.message}`);

  const rows = narrowPublicRows(data);
  const authorIds = [...new Set(rows.flatMap((row) => (row.author_id ? [row.author_id] : [])))];
  const authors = new Map<string, CommentAuthor>();
  if (authorIds.length > 0) {
    const profiles = await client
      .from('public_profiles')
      .select('id, handle, avatar_path, role')
      .in('id', authorIds);
    if (profiles.error) {
      throw new Error(`lib/data/comments: profiles read failed — ${profiles.error.message}`);
    }
    for (const profile of profiles.data) {
      if (profile.id === null || profile.handle === null || profile.role === null) continue;
      authors.set(profile.id, {
        id: profile.id,
        handle: profile.handle,
        avatarUrl: avatarUrlFor(profile.avatar_path),
        role: profile.role,
      });
    }
  }

  const comments = buildPublicSlots(rows, authors);
  return { comments, total: comments.length };
}

/**
 * The public thread of one target as `CommentThread`'s `comments` + `total` props (03 §2.4),
 * cached under `project:<slug>` (02 §5 — `postComment`/`editComment`/`deleteComment`/
 * `moderateComment`/`toggleLike`/`deleteAccount` revalidate it).
 */
export function listPublicComments(target: CommentTarget): Promise<PublicThread> {
  return unstable_cache(
    () => fetchPublicThread(target),
    ['data-comments-thread', target.type, target.id],
    { revalidate: REVALIDATE_S, tags: [projectTag(target.slug)] },
  )();
}
