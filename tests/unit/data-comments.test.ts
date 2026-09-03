/**
 * tests/unit/data-comments.test.ts — the pure pieces of `lib/data/comments.ts`: `buildPublicSlots`
 * (the ADR-0028 D1 slot rule; 03 §2.2 "N TOTAL"; DESIGN.md §11.2 thread edge states; 05 T-E2E-3
 * "3 TOTAL" on seed), `narrowPublicRows` and `avatarUrlFor` (04 SC-21).
 *
 * Supplementary tests (no 05 IDs — the data layer has none, the `data-projects.test.ts`
 * precedent); the binding count is proved end-to-end by T-E2E-3 and the anon read by T-RLS-128.
 * Rows are shaped like `comments_public` as anon sees it (SEED-9 ids from `seedIds.ts`; a
 * non-published row carries NULL `body`/`author_id`/`edited_at`). No DB, no network.
 */
import { describe, expect, it } from 'vitest';
import {
  avatarUrlFor,
  buildPublicSlots,
  narrowPublicRows,
  type CommentAuthor,
  type CommentStatus,
  type PublicSlotRow,
} from '@/lib/data/comments';
import { SEED_COMMENTS, SEED_USERS } from '@/tests/helpers/seedIds';

const NOW = Date.parse('2026-09-03T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

const AUTHORS: ReadonlyMap<string, CommentAuthor> = new Map([
  [
    SEED_USERS.oddsense,
    { id: SEED_USERS.oddsense, handle: 'oddsense', avatarUrl: null, role: 'admin' },
  ],
  [
    SEED_USERS.seed_user,
    { id: SEED_USERS.seed_user, handle: 'seed_user', avatarUrl: null, role: 'user' },
  ],
  [
    SEED_USERS.seed_user2,
    { id: SEED_USERS.seed_user2, handle: 'seed_user2', avatarUrl: null, role: 'user' },
  ],
]);

type RowInput = {
  id: string;
  status: CommentStatus;
  created_at: string;
  parent_id?: string | null;
  author_id?: string | null;
  body?: string | null;
  like_count?: number;
  edited_at?: string | null;
};

/** A `comments_public` row the way anon sees it: a non-published row has no body/author/edited_at. */
const row = (input: RowInput): PublicSlotRow => {
  const exposed = input.status === 'published';
  return {
    id: input.id,
    parent_id: input.parent_id ?? null,
    status: input.status,
    created_at: input.created_at,
    like_count: input.like_count ?? 0,
    body: exposed ? (input.body ?? `body of ${input.id.slice(-4)}`) : null,
    author_id: exposed ? (input.author_id ?? SEED_USERS.seed_user) : null,
    edited_at: exposed ? (input.edited_at ?? null) : null,
  };
};

const id = (n: number): string => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`;

/** SEED-9 as `comments_public` returns it to anon (statuses, parents and ages from seed.sql). */
const SEED_ROWS: readonly PublicSlotRow[] = [
  row({
    id: SEED_COMMENTS.published,
    status: 'published',
    created_at: ago(3 * DAY),
    author_id: SEED_USERS.seed_user,
    body: 'The chameleon blends into my kitchen floor. Ten out of ten.',
    like_count: 1,
  }),
  row({
    id: SEED_COMMENTS.creatorReply,
    status: 'published',
    created_at: ago(2 * DAY),
    parent_id: SEED_COMMENTS.published,
    author_id: SEED_USERS.oddsense,
    body: 'The kitchen floor is a valid biome.',
  }),
  row({ id: SEED_COMMENTS.held, status: 'held', created_at: ago(HOUR) }),
  row({ id: SEED_COMMENTS.hidden, status: 'hidden', created_at: ago(2 * DAY) }),
  row({ id: SEED_COMMENTS.deleted, status: 'deleted', created_at: ago(2 * DAY) }),
];

describe('buildPublicSlots — ADR-0028 D1 slot rule on the seed thread (T-E2E-3 "3 TOTAL")', () => {
  it('seed-shaped rows → 3 slots for anon: published root, creator reply, hidden slot', () => {
    const slots = buildPublicSlots(SEED_ROWS, AUTHORS);
    expect(slots.map((slot) => slot.id)).toEqual([
      SEED_COMMENTS.published,
      SEED_COMMENTS.creatorReply,
      SEED_COMMENTS.hidden,
    ]);
    expect(slots).toHaveLength(3);
  });

  it('the published root is the full view (body, author, likes) and the reply points at it', () => {
    const [root, reply] = buildPublicSlots(SEED_ROWS, AUTHORS);
    expect(root).toEqual({
      id: SEED_COMMENTS.published,
      body: 'The chameleon blends into my kitchen floor. Ten out of ten.',
      status: 'published',
      createdAt: ago(3 * DAY),
      editedAt: null,
      parentId: null,
      likeCount: 1,
      likedByViewer: false,
      author: { id: SEED_USERS.seed_user, handle: 'seed_user', avatarUrl: null, role: 'user' },
    });
    expect(reply).toMatchObject({
      id: SEED_COMMENTS.creatorReply,
      parentId: SEED_COMMENTS.published,
      body: 'The kitchen floor is a valid biome.',
      status: 'published',
      author: { handle: 'oddsense', role: 'admin' },
    });
  });

  it('the hidden row is the "Hidden by a moderator." slot: no body, no author, status hidden', () => {
    const hidden = buildPublicSlots(SEED_ROWS, AUTHORS).find((s) => s.id === SEED_COMMENTS.hidden);
    expect(hidden).toEqual({
      id: SEED_COMMENTS.hidden,
      body: '',
      status: 'hidden',
      createdAt: ago(2 * DAY),
      editedAt: null,
      parentId: null,
      likeCount: 0,
      likedByViewer: false,
      author: null,
    });
  });

  it('the held row (…0203) and the reply-less deleted root (…0205) are not slots', () => {
    const ids = buildPublicSlots(SEED_ROWS, AUTHORS).map((slot) => slot.id);
    expect(ids).not.toContain(SEED_COMMENTS.held);
    expect(ids).not.toContain(SEED_COMMENTS.deleted);
  });

  it('input order does not matter — the seed rows reversed (reply before root) give the same slots', () => {
    const reversed = [...SEED_ROWS].reverse();
    expect(buildPublicSlots(reversed, AUTHORS)).toEqual(buildPublicSlots(SEED_ROWS, AUTHORS));
  });
});

describe('buildPublicSlots — deleted roots (ADR-0028 D1)', () => {
  it('a deleted root with a published reply keeps its "Deleted." slot and the reply stays readable', () => {
    const rows = [
      row({ id: id(1), status: 'deleted', created_at: ago(2 * DAY) }),
      row({
        id: id(2),
        status: 'published',
        created_at: ago(DAY),
        parent_id: id(1),
        author_id: SEED_USERS.oddsense,
        body: 'still here',
      }),
    ];
    const slots = buildPublicSlots(rows, AUTHORS);
    expect(slots.map((s) => s.id)).toEqual([id(1), id(2)]);
    expect(slots[0]).toMatchObject({ status: 'deleted', body: '', author: null, parentId: null });
    expect(slots[1]).toMatchObject({
      status: 'published',
      body: 'still here',
      parentId: id(1),
      author: { handle: 'oddsense' },
    });
  });

  it('a deleted root with only a hidden reply keeps its slot (a hidden slot is visible)', () => {
    const rows = [
      row({ id: id(1), status: 'deleted', created_at: ago(2 * DAY) }),
      row({ id: id(2), status: 'hidden', created_at: ago(DAY), parent_id: id(1) }),
    ];
    const slots = buildPublicSlots(rows, AUTHORS);
    expect(slots.map((s) => [s.id, s.status])).toEqual([
      [id(1), 'deleted'],
      [id(2), 'hidden'],
    ]);
  });

  it('a deleted root alone is dropped', () => {
    const rows = [row({ id: id(1), status: 'deleted', created_at: ago(DAY) })];
    expect(buildPublicSlots(rows, AUTHORS)).toEqual([]);
  });

  it('a deleted root whose replies are all deleted or held is dropped with them', () => {
    const rows = [
      row({ id: id(1), status: 'deleted', created_at: ago(2 * DAY) }),
      row({ id: id(2), status: 'deleted', created_at: ago(DAY), parent_id: id(1) }),
      row({ id: id(3), status: 'held', created_at: ago(HOUR), parent_id: id(1) }),
    ];
    expect(buildPublicSlots(rows, AUTHORS)).toEqual([]);
  });

  it('a deleted reply under a published root disappears; the root stays', () => {
    const rows = [
      row({ id: id(1), status: 'published', created_at: ago(2 * DAY) }),
      row({ id: id(2), status: 'deleted', created_at: ago(DAY), parent_id: id(1) }),
    ];
    expect(buildPublicSlots(rows, AUTHORS).map((s) => s.id)).toEqual([id(1)]);
  });
});

describe('buildPublicSlots — held and hidden rows', () => {
  it('held rows are dropped at every depth (own held rows merge in client-side)', () => {
    const rows = [
      row({ id: id(1), status: 'held', created_at: ago(2 * DAY) }),
      row({ id: id(2), status: 'published', created_at: ago(DAY) }),
      row({ id: id(3), status: 'held', created_at: ago(HOUR), parent_id: id(2) }),
    ];
    expect(buildPublicSlots(rows, AUTHORS).map((s) => s.id)).toEqual([id(2)]);
  });

  it('a hidden slot survives at any depth — root and reply', () => {
    const rows = [
      row({ id: id(1), status: 'hidden', created_at: ago(3 * DAY) }),
      row({ id: id(2), status: 'published', created_at: ago(2 * DAY) }),
      row({ id: id(3), status: 'hidden', created_at: ago(DAY), parent_id: id(2) }),
    ];
    const slots = buildPublicSlots(rows, AUTHORS);
    expect(slots.map((s) => [s.id, s.status, s.parentId])).toEqual([
      [id(1), 'hidden', null],
      [id(2), 'published', null],
      [id(3), 'hidden', id(2)],
    ]);
    for (const slot of slots.filter((s) => s.status === 'hidden')) {
      expect(slot.body).toBe('');
      expect(slot.author).toBeNull();
      expect(slot.editedAt).toBeNull();
    }
  });

  it('a held root does not keep its published replies (the root is not renderable)', () => {
    const rows = [
      row({ id: id(1), status: 'held', created_at: ago(2 * DAY) }),
      row({ id: id(2), status: 'published', created_at: ago(DAY), parent_id: id(1) }),
    ];
    expect(buildPublicSlots(rows, AUTHORS)).toEqual([]);
  });
});

describe('buildPublicSlots — ordering and authors', () => {
  it('roots oldest first, each followed by its replies oldest first', () => {
    const rows = [
      row({ id: id(5), status: 'published', created_at: ago(HOUR), parent_id: id(1) }),
      row({ id: id(2), status: 'published', created_at: ago(2 * DAY) }),
      row({ id: id(4), status: 'published', created_at: ago(2 * HOUR), parent_id: id(1) }),
      row({ id: id(1), status: 'published', created_at: ago(3 * DAY) }),
      row({ id: id(3), status: 'published', created_at: ago(DAY), parent_id: id(2) }),
    ];
    expect(buildPublicSlots(rows, AUTHORS).map((s) => s.id)).toEqual([
      id(1),
      id(4),
      id(5),
      id(2),
      id(3),
    ]);
  });

  it('a published row whose author is gone (deleted account, author_id null) renders with author null', () => {
    const rows = [
      {
        ...row({ id: id(1), status: 'published', created_at: ago(DAY), body: 'orphan' }),
        author_id: null,
      },
    ];
    expect(buildPublicSlots(rows, AUTHORS)[0]).toMatchObject({ body: 'orphan', author: null });
  });

  it('an author id missing from the profiles map renders with author null (never throws)', () => {
    const rows = [row({ id: id(1), status: 'published', created_at: ago(DAY), author_id: id(99) })];
    expect(buildPublicSlots(rows, AUTHORS)[0]?.author).toBeNull();
  });

  it('editedAt and likeCount pass through on published rows', () => {
    const rows = [
      row({
        id: id(1),
        status: 'published',
        created_at: ago(DAY),
        edited_at: ago(HOUR),
        like_count: 7,
      }),
    ];
    expect(buildPublicSlots(rows, AUTHORS)[0]).toMatchObject({ editedAt: ago(HOUR), likeCount: 7 });
  });

  it('an empty thread gives no slots', () => {
    expect(buildPublicSlots([], AUTHORS)).toEqual([]);
  });
});

describe('narrowPublicRows (the all-nullable view type → PublicSlotRow)', () => {
  const full = {
    id: id(1),
    parent_id: null,
    status: 'published' as const,
    created_at: ago(DAY),
    like_count: 2,
    body: 'hi',
    author_id: SEED_USERS.seed_user,
    edited_at: null,
  };

  it('keeps a complete row as-is', () => {
    expect(narrowPublicRows([full])).toEqual([full]);
  });

  it('drops rows missing id, status or created_at', () => {
    expect(narrowPublicRows([{ ...full, id: null }])).toEqual([]);
    expect(narrowPublicRows([{ ...full, status: null }])).toEqual([]);
    expect(narrowPublicRows([{ ...full, created_at: null }])).toEqual([]);
  });

  it('a NULL like_count reads as 0; NULL body/author/edited_at stay null (the anon shape)', () => {
    const [out] = narrowPublicRows([
      { ...full, status: 'hidden', like_count: null, body: null, author_id: null, edited_at: null },
    ]);
    expect(out).toMatchObject({ like_count: 0, body: null, author_id: null, edited_at: null });
  });
});

describe('avatarUrlFor (04 SC-21 public avatars bucket)', () => {
  it('null path → null', () => {
    expect(avatarUrlFor(null)).toBeNull();
  });

  it('a profile path → the public Storage object URL under avatars/', () => {
    expect(avatarUrlFor(`${SEED_USERS.seed_user}/abc123.webp`)).toBe(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/${SEED_USERS.seed_user}/abc123.webp`,
    );
  });
});
