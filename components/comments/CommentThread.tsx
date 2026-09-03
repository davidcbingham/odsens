'use client';

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { useViewer, type Viewer } from '@/components/accounts/ViewerProvider';
import { Comment } from '@/components/comments/Comment';
import { Composer, COMPOSER_ID, type ComposerPending } from '@/components/comments/Composer';
import type { ModActionResult } from '@/components/comments/ModActionRow';
import { Reply } from '@/components/comments/Reply';
import { SIGN_IN_PROMPT_ID, SignInPrompt } from '@/components/comments/SignInPrompt';
import { CommentThreadSkeleton } from '@/components/layout/CommentThreadSkeleton';
import { useToast } from '@/components/layout/Toast';
import { Avatar } from '@/components/primitives/Avatar';
import { EmptyState } from '@/components/primitives/EmptyState';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { SectionTitle } from '@/components/primitives/SectionTitle';
import { Toggle } from '@/components/primitives/Toggle';
import type { CommentAuthor, CommentTarget, CommentView } from '@/lib/data/comments';
import type { CommentStatus, ModerationMode } from '@/lib/validation/moderation';
import styles from './CommentThread.module.css';

/**
 * CommentThread — DESIGN.md §5 Comment bubble, §11.1 Mod action row (Moderate toggle in the
 * header), §11.2 every edge state, §12.7 #76 "N TOTAL"; 03 §2.4 `CommentThread` (ONE client
 * file — ADR-0002 A1); 02 §2.3 COMMENTS; 00 S1.4.AC1/AC2/AC4/AC8/AC10/AC11/AC15. The ADR-0002 C1
 * session seam (03 C-17 exception 5, the C-16a row): the PUBLIC thread arrives as props from the
 * ISR page (`lib/data/comments.ts` over `comments_public`, tag `project:<slug>` — published rows
 * plus the "Hidden by a moderator." / "Deleted." slots, already in the HTML: no fetch before
 * hydration, no layout shift of those rows); after hydration, for a signed-in viewer, this file
 * alone imports `lib/supabase/client.ts` (lazily — 03 C-18) and reads the viewer's OWN rows under
 * RLS: own `held` / `hidden` comments for this target, own `comment_likes` for the listed ids,
 * and — moderators only (ADR-0002 A2) — RPC `moderator_thread(target_type, target_id)` for the
 * held / hidden / reported rows with `is_first_comment` + `report_count`. The RPC returns
 * `author_id` without a handle, so authors unknown to the public list are resolved through the
 * public `public_profiles` view (the same identity read `lib/data/comments.ts` makes server-side;
 * 01 INV-45) — no private row of anyone else is ever read. `CommentThreadSkeleton` shows UNDER
 * the public list only while that merge runs.
 *
 * The list is derived, never mutated: `mergeThread(base, own, mod, likes, patches)` → the slot
 * rule (`buildTree`: roots oldest first, replies oldest first; a `deleted` root stays only while
 * it has a visible reply — ADR-0028 D1; deleted replies leave) → `N TOTAL` = the slots rendered
 * (ADR-0002 #76), recomputed after every merge, optimistic bubble and patch. Local results are
 * patches over the props (post / edit / delete / moderate / like), so a refreshed `comments` prop
 * never clobbers them. Optimistic insert (`useOptimistic`, ADR-0002 #72 / A3): only under
 * `moderationMode === 'auto'` — under `hold_first_time` nothing is inserted until `postComment`
 * returns the row AS STORED, so a held comment never flashes as published (foreman brief).
 *
 * Shell (03 §3 `data-state`): `closed` (`commentsEnabled=false` — sunk slab, `PixelLabel` CLOSED,
 * "Comments are off for this one. The old ones stay."; the list still renders) · `signed-out`
 * (`useViewer().status !== 'signed-in'`, also the pre-hydration shape — `SignInPrompt`) · `banned`
 * (dim `Avatar` + "You can't comment here.") · `empty` (`EmptyState` "NO COMMENTS YET" /
 * "Say something." + one primary button that focuses the composer) · `normal`. Precedence is that
 * order (the composer slot decides). `data-moderate="on|off"` on the root for moderators (the
 * `Toggle role="switch" accent="indigo"` "Moderate" beside the `SectionTitle`); `ModActionRow`
 * always on held / reported rows, on every other row while ON. Toasts only "Comment posted."
 * (G-04 — the mod row toasts its own); a visually-hidden `role="status"` line announces it too.
 * The `<section id="comments" aria-labelledby>` is the page's; the heading here is
 * `SectionTitle` "COMMENTS" (`sectionTitleId('COMMENTS')`), count `{ total, 'TOTAL' }`, action
 * "How comments work" → `/how-comments-work`.
 */
export type CommentThreadProps = {
  /** v1: projects only (ADR-0002 C21); `slug` builds the sign-in return path. */
  target: CommentTarget;
  /** Public rows from `comments_public` (published + Deleted. / Hidden slots), display order. */
  comments: CommentView[];
  /** `listPublicComments().total` — the server-side slot count (the client recomputes). */
  total: number;
  commentsEnabled: boolean;
  /** `site_settings_public.owner_profile_id` — the CREATOR tag (ADR-0002 #55). */
  ownerProfileId: string | null;
  /** `site_settings_public.moderation_mode` — the optimistic-insert rule (ADR-0002 A3). */
  moderationMode: ModerationMode;
  className?: string;
};

export const CLOSED_LINE = 'Comments are off for this one. The old ones stay.';
export const BANNED_LINE = "You can't comment here.";
export const EMPTY_TITLE = 'NO COMMENTS YET';
export const EMPTY_LINE = 'Say something.';
export const EMPTY_ACTION = 'Write a comment';
export const POSTED_TOAST = 'Comment posted.';
export const HOW_COMMENTS_WORK = {
  label: 'How comments work',
  href: '/how-comments-work',
} as const;

/** A row in the merged list; `pending` marks the optimistic bubble. */
export type ThreadItem = CommentView & { pending?: boolean };

/** One RPC `moderator_thread` row, shaped for the merge (author resolved by the read). */
export type ModRow = {
  id: string;
  parentId: string | null;
  body: string;
  status: CommentStatus;
  createdAt: string;
  editedAt: string | null;
  likeCount: number;
  isFirstComment: boolean;
  reportCount: number;
  author: CommentAuthor | null;
};

/** Local results layered over the props (post / edit / delete / moderate / like). */
export type ThreadPatches = {
  added: CommentView[];
  edited: Record<string, CommentView>;
  status: Record<string, CommentStatus>;
  likes: Record<string, { liked: boolean; count: number }>;
};

const NO_PATCHES: ThreadPatches = { added: [], edited: {}, status: {}, likes: {} };
const NO_ROWS: readonly CommentView[] = [];
const NO_MOD_ROWS: readonly ModRow[] = [];
const NO_LIKES: ReadonlySet<string> = new Set();

/** One completed client-seam read, keyed by the inputs that produced it. */
type Seam = {
  viewerId: string;
  canModerate: boolean;
  base: readonly CommentView[];
  own: readonly CommentView[];
  mod: readonly ModRow[];
  likes: ReadonlySet<string>;
};

export type ThreadTree = {
  roots: { comment: ThreadItem; replies: ThreadItem[] }[];
  /** The slots rendered — `N TOTAL` (ADR-0002 #76). */
  total: number;
};

// ---- Pure helpers (exported for unit tests; no I/O) ----------------------------------------

function byCreated(a: ThreadItem, b: ThreadItem): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** A row that lost its body (hidden / deleted by a later patch) renders as a slot. */
function asSlot(item: ThreadItem, status: 'hidden' | 'deleted'): ThreadItem {
  return { ...item, status, body: '', author: null, editedAt: null, likedByViewer: false };
}

/**
 * Public rows + own held rows + moderator rows + own likes + local patches → one flat list.
 * Own/mod rows never replace a public row; they add the rows the public read could not show
 * (held) and decorate the rest (`reportCount`, `isFirstComment`).
 */
export function mergeThread(input: {
  base: readonly CommentView[];
  own: readonly CommentView[];
  mod: readonly ModRow[];
  likes: ReadonlySet<string>;
  patches: ThreadPatches;
}): ThreadItem[] {
  const map = new Map<string, ThreadItem>();
  for (const row of input.base) map.set(row.id, { ...row });
  for (const row of input.own) if (!map.has(row.id)) map.set(row.id, { ...row });
  for (const row of input.mod) {
    const existing = map.get(row.id);
    if (existing) {
      map.set(row.id, {
        ...existing,
        reportCount: row.reportCount,
        isFirstComment: row.isFirstComment,
      });
    } else if (row.status === 'held' && row.author !== null) {
      map.set(row.id, {
        id: row.id,
        body: row.body,
        status: 'held',
        createdAt: row.createdAt,
        editedAt: row.editedAt,
        parentId: row.parentId,
        likeCount: row.likeCount,
        likedByViewer: false,
        isFirstComment: row.isFirstComment,
        reportCount: row.reportCount,
        author: row.author,
      });
    }
  }
  for (const row of input.patches.added) map.set(row.id, { ...map.get(row.id), ...row });
  for (const [id, row] of Object.entries(input.patches.edited)) {
    const existing = map.get(id);
    if (existing) map.set(id, { ...existing, body: row.body, editedAt: row.editedAt });
  }
  for (const [id, status] of Object.entries(input.patches.status)) {
    const existing = map.get(id);
    if (!existing) continue;
    map.set(
      id,
      status === 'hidden' || status === 'deleted'
        ? asSlot(existing, status)
        : { ...existing, status },
    );
  }
  for (const item of map.values()) {
    const like = input.patches.likes[item.id];
    if (like) {
      item.likedByViewer = like.liked;
      item.likeCount = like.count;
    } else if (input.likes.has(item.id)) {
      item.likedByViewer = true;
    }
  }
  return [...map.values()];
}

/**
 * The slot rule (ADR-0028 D1; `lib/data/comments.ts` `buildPublicSlots` for the public half):
 * roots oldest first, replies oldest first; a reply renders unless `deleted`; a `deleted` root
 * renders only while it has a visible reply. `total` = the slots rendered (ADR-0002 #76).
 */
export function buildTree(list: readonly ThreadItem[]): ThreadTree {
  const repliesByRoot = new Map<string, ThreadItem[]>();
  for (const item of list) {
    if (item.parentId === null) continue;
    const bucket = repliesByRoot.get(item.parentId) ?? [];
    bucket.push(item);
    repliesByRoot.set(item.parentId, bucket);
  }
  const roots: ThreadTree['roots'] = [];
  let total = 0;
  for (const root of list.filter((item) => item.parentId === null).sort(byCreated)) {
    const replies = (repliesByRoot.get(root.id) ?? [])
      .filter((reply) => reply.status !== 'deleted')
      .sort(byCreated);
    if (root.status === 'deleted' && replies.length === 0) continue;
    roots.push({ comment: root, replies });
    total += 1 + replies.length;
  }
  return { roots, total };
}

function viewerAuthor(viewer: Viewer | null): CommentAuthor | null {
  if (viewer === null || viewer.handle === null) return null;
  return { id: viewer.id, handle: viewer.handle, avatarUrl: viewer.avatarUrl, role: viewer.role };
}

// ---- The island ------------------------------------------------------------------------------

type Shell = 'normal' | 'empty' | 'closed' | 'banned' | 'signed-out';

export function CommentThread({
  target,
  comments,
  commentsEnabled,
  ownerProfileId,
  moderationMode,
  className,
}: CommentThreadProps) {
  const viewerState = useViewer();
  const { toast } = useToast();
  const viewer = viewerState.status === 'signed-in' ? viewerState.viewer : null;
  const canModerate = viewer !== null && (viewer.role === 'moderator' || viewer.role === 'admin');
  const author = useMemo(() => viewerAuthor(viewer), [viewer]);
  const canPost = commentsEnabled && author !== null && viewer !== null && !viewer.isBanned;

  // The seam result is keyed by what produced it (viewer, role, the public rows), so a stale one
  // never shows and `merging` is derived — nothing is reset inside an effect.
  const [seam, setSeam] = useState<Seam | null>(null);
  const seamCurrent =
    seam !== null &&
    viewer !== null &&
    seam.viewerId === viewer.id &&
    seam.canModerate === canModerate &&
    seam.base === comments;
  const merging = viewer !== null && author !== null && !seamCurrent;
  const own = seamCurrent ? seam.own : NO_ROWS;
  const mod = seamCurrent ? seam.mod : NO_MOD_ROWS;
  const likes = seamCurrent ? seam.likes : NO_LIKES;

  const [patches, setPatches] = useState<ThreadPatches>(NO_PATCHES);
  const [moderate, setModerate] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const composerSlot = useRef<HTMLDivElement>(null);
  const pendingSequence = useRef(0);

  // The client-seam reads (03 C-17 exception 5): own held/hidden rows, own likes, mod rows.
  useEffect(() => {
    if (!merging || viewer === null || author === null) return;
    let cancelled = false;
    const viewerId = viewer.id;
    const self = author;
    const ids = comments.map((row) => row.id);
    const knownAuthors = new Map<string, CommentAuthor>();
    for (const row of comments) if (row.author) knownAuthors.set(row.author.id, row.author);
    knownAuthors.set(self.id, self);

    (async () => {
      const { createBrowserClient } = await import('@/lib/supabase/client');
      const supabase = createBrowserClient();
      const [ownRead, likesRead, modRead] = await Promise.all([
        supabase
          .from('comments')
          .select('id, parent_id, body, status, created_at, edited_at, like_count')
          .eq('author_id', viewerId)
          .eq('target_type', target.type)
          .eq('target_id', target.id)
          .in('status', ['held', 'hidden']),
        ids.length > 0
          ? supabase
              .from('comment_likes')
              .select('comment_id')
              .eq('user_id', viewerId)
              .in('comment_id', ids)
          : Promise.resolve({ data: [], error: null }),
        canModerate
          ? supabase.rpc('moderator_thread', { p_target_type: target.type, p_target_id: target.id })
          : Promise.resolve({ data: [], error: null }),
      ]);

      const ownRows: CommentView[] = (ownRead.data ?? []).map((row) => ({
        id: row.id,
        body: row.status === 'held' ? row.body : '',
        status: row.status,
        createdAt: row.created_at,
        editedAt: row.status === 'held' ? row.edited_at : null,
        parentId: row.parent_id,
        likeCount: row.like_count,
        likedByViewer: false,
        author: row.status === 'held' ? self : null,
      }));

      const modRaw = modRead.data ?? [];
      const missing = [
        ...new Set(
          modRaw.flatMap((row) =>
            row.author_id && !knownAuthors.has(row.author_id) ? [row.author_id] : [],
          ),
        ),
      ];
      if (missing.length > 0) {
        const profiles = await supabase
          .from('public_profiles')
          .select('id, handle, avatar_path, role')
          .in('id', missing);
        const { publicEnv } = await import('@/lib/env/public');
        for (const profile of profiles.data ?? []) {
          if (profile.id === null || profile.handle === null || profile.role === null) continue;
          knownAuthors.set(profile.id, {
            id: profile.id,
            handle: profile.handle,
            avatarUrl: profile.avatar_path
              ? `${publicEnv.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${profile.avatar_path}`
              : null,
            role: profile.role,
          });
        }
      }
      const modRows: ModRow[] = modRaw.map((row) => ({
        id: row.id,
        parentId: row.parent_id ?? null,
        body: row.body,
        status: row.status as CommentStatus,
        createdAt: row.created_at,
        editedAt: row.edited_at ?? null,
        likeCount: row.like_count,
        isFirstComment: row.is_first_comment,
        reportCount: row.report_count,
        author: row.author_id ? (knownAuthors.get(row.author_id) ?? null) : null,
      }));

      if (cancelled) return;
      setSeam({
        viewerId,
        canModerate,
        base: comments,
        own: ownRows,
        mod: modRows,
        likes: new Set((likesRead.data ?? []).map((row) => row.comment_id)),
      });
    })().catch(() => {
      // A failed seam read leaves the public thread as it is (the ISR HTML is complete).
      if (cancelled) return;
      setSeam({ viewerId, canModerate, base: comments, own: [], mod: [], likes: NO_LIKES });
    });

    return () => {
      cancelled = true;
    };
  }, [merging, viewer, author, canModerate, comments, target.type, target.id]);

  const merged = useMemo(
    () => mergeThread({ base: comments, own, mod, likes, patches }),
    [comments, own, mod, likes, patches],
  );
  const [optimisticList, addPending] = useOptimistic<ThreadItem[], ThreadItem>(
    merged,
    (state, item) => [...state, item],
  );
  const tree = useMemo(() => buildTree(optimisticList), [optimisticList]);

  // ---- Handlers (patches over the props) ---------------------------------------------------
  const onPosting = useCallback(
    (pending: ComposerPending) => {
      if (moderationMode !== 'auto' || author === null) return;
      pendingSequence.current += 1;
      addPending({
        id: `pending-${pendingSequence.current}`,
        body: pending.body,
        status: 'published',
        createdAt: new Date().toISOString(),
        editedAt: null,
        parentId: pending.parentId,
        likeCount: 0,
        likedByViewer: false,
        author,
        pending: true,
      });
    },
    [moderationMode, author, addPending],
  );

  const onPosted = useCallback(
    (comment: CommentView) => {
      startTransition(() => {
        setPatches((current) => ({ ...current, added: [...current.added, comment] }));
      });
      toast(POSTED_TOAST);
      setAnnouncement(POSTED_TOAST);
    },
    [toast],
  );

  const onEdited = useCallback((comment: CommentView) => {
    setPatches((current) => ({ ...current, edited: { ...current.edited, [comment.id]: comment } }));
  }, []);

  const onDeleted = useCallback((id: string) => {
    setPatches((current) => ({ ...current, status: { ...current.status, [id]: 'deleted' } }));
  }, []);

  const onModerated = useCallback((id: string, result: ModActionResult) => {
    if (result.action === 'ban' || result.action === 'rename') return;
    setPatches((current) => ({ ...current, status: { ...current.status, [id]: result.status } }));
  }, []);

  const onLiked = useCallback((id: string, liked: boolean, count: number) => {
    setPatches((current) => ({ ...current, likes: { ...current.likes, [id]: { liked, count } } }));
  }, []);

  // The announcement clears so a second post announces again.
  useEffect(() => {
    if (announcement === '') return;
    const timer = setTimeout(() => setAnnouncement(''), 4000);
    return () => clearTimeout(timer);
  }, [announcement]);

  // ---- Shell -------------------------------------------------------------------------------
  const shell: Shell = !commentsEnabled
    ? 'closed'
    : viewer === null || author === null
      ? 'signed-out'
      : viewer.isBanned
        ? 'banned'
        : tree.total === 0
          ? 'empty'
          : 'normal';

  const focusTargetId = canPost ? COMPOSER_ID : SIGN_IN_PROMPT_ID;

  function focusComposer(event: MouseEvent<HTMLDivElement>): void {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;
    event.preventDefault();
    const slot = composerSlot.current;
    const field = slot?.querySelector<HTMLElement>('textarea, button');
    slot?.scrollIntoView({ block: 'center' });
    field?.focus();
  }

  const classes = className ? `${styles.thread} ${className}` : styles.thread;

  return (
    <div
      className={classes}
      data-state={shell}
      {...(canModerate ? { 'data-moderate': moderate ? 'on' : 'off' } : {})}
    >
      <div className={styles['thread-header']}>
        <SectionTitle
          count={{ value: tree.total, word: 'TOTAL' }}
          action={HOW_COMMENTS_WORK}
          className={styles['thread-title']}
        >
          COMMENTS
        </SectionTitle>
        {canModerate ? (
          <span className={styles['thread-moderate']}>
            {/* The word is decorative for AT (the switch is named "Moderate"); a mouse click on it
                flips the switch too, the way a label would. */}
            <span
              className={styles['thread-moderate-word']}
              aria-hidden="true"
              onClick={() => setModerate((on) => !on)}
            >
              Moderate
            </span>
            <Toggle
              name="moderate"
              role="switch"
              accent="indigo"
              label="Moderate"
              checked={moderate}
              onChange={setModerate}
            />
          </span>
        ) : null}
      </div>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      <div ref={composerSlot} className={styles['thread-composer']}>
        {shell === 'closed' ? (
          <div className={styles['thread-closed']}>
            <PixelLabel tone="mute-dim">CLOSED</PixelLabel>
            <p className={styles['thread-closed-line']}>{CLOSED_LINE}</p>
          </div>
        ) : shell === 'signed-out' ? (
          <SignInPrompt next={`/projects/${target.slug}#comments`} />
        ) : shell === 'banned' && viewer !== null ? (
          <div className={styles['thread-banned']}>
            <Avatar src={viewer.avatarUrl} alt={viewer.handle ?? ''} size={40} border={2} dim />
            <p className={styles['thread-banned-line']}>{BANNED_LINE}</p>
          </div>
        ) : viewer !== null ? (
          <Composer
            id={COMPOSER_ID}
            target={target}
            viewer={viewer}
            onPosting={onPosting}
            onPosted={onPosted}
          />
        ) : null}
      </div>

      {tree.total === 0 ? (
        commentsEnabled ? (
          <div onClick={focusComposer}>
            <EmptyState
              as="h3"
              title={EMPTY_TITLE}
              line={EMPTY_LINE}
              action={{ label: EMPTY_ACTION, variant: 'primary', href: `#${focusTargetId}` }}
            />
          </div>
        ) : null
      ) : (
        <ol className={styles['thread-list']}>
          {tree.roots.map(({ comment, replies }) => {
            const rowProps = {
              viewer,
              canModerate,
              ownerProfileId,
              target,
              rootId: comment.id,
              canReply: canPost,
              onPosting,
              onPosted,
              onEdited,
              onDeleted,
              onModerated,
              onLiked,
            };
            const modRowFor = (item: ThreadItem): boolean =>
              canModerate &&
              item.author !== null &&
              (item.status === 'held' || (item.reportCount ?? 0) > 0 || moderate);
            return (
              <Comment
                key={comment.id}
                comment={comment}
                depth={0}
                showModRow={modRowFor(comment)}
                pending={comment.pending}
                {...rowProps}
              >
                {replies.length > 0
                  ? replies.map((reply) => (
                      <Reply
                        key={reply.id}
                        comment={reply}
                        showModRow={modRowFor(reply)}
                        pending={reply.pending}
                        {...rowProps}
                      />
                    ))
                  : null}
              </Comment>
            );
          })}
        </ol>
      )}

      {merging ? <CommentThreadSkeleton count={2} /> : null}
    </div>
  );
}
