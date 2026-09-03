/**
 * tests/unit/moderation.test.ts — `lib/validation/moderation.ts` (05 T-UNIT-6, T-UNIT-7, T-UNIT-8;
 * 04 §5.1 moderation table M2–M7; 04 §1.2 `editComment` preconditions + `moderateComment`
 * transitions; Q38 `AUTO_HOLD_REPORTS`).
 *
 * The edit window is exercised both with an explicit `now` and against the faked app clock
 * (`tests/helpers/time.ts` — `Date` only, real from S1.4). The `nextStatus` cases carry no 05 ID:
 * they pin the 04 §1.2 transition table the `moderateComment` action (T-ACT-23, db lane) relies on.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTO_HOLD_REPORTS,
  EDIT_WINDOW_MS,
  MODERATION_TRANSITIONS,
  decideCommentStatus,
  isWithinEditWindow,
  nextStatus,
  shouldAutoHold,
  type AuthorRole,
  type CommentStatus,
  type ModerateAction,
  type ModerationMode,
} from '@/lib/validation/moderation';
import { advance, freezeAt, unfreeze } from '@/tests/helpers/time';

// ---- T-UNIT-6 ---------------------------------------------------------------------------------

/** 04 §5.1 rows M2–M5, verbatim from 05 T-UNIT-6. */
const STATUS_TABLE: ReadonlyArray<[ModerationMode, number, AuthorRole, 'published' | 'held']> = [
  ['auto', 0, 'user', 'published'],
  ['auto', 5, 'user', 'published'],
  ['hold_first_time', 0, 'user', 'held'],
  ['hold_first_time', 1, 'user', 'published'],
  ['hold_first_time', 0, 'moderator', 'published'],
  ['hold_first_time', 0, 'admin', 'published'],
];

describe('T-UNIT-6 decideCommentStatus', () => {
  it.each(STATUS_TABLE)(
    'T-UNIT-6 (%s, count %d, %s) → %s',
    (mode, authorCommentCount, authorRole, expected) => {
      expect(decideCommentStatus({ mode, authorCommentCount, authorRole })).toBe(expected);
    },
  );

  it('T-UNIT-6 staff are never held, whatever the mode or count (M2)', () => {
    for (const mode of ['auto', 'hold_first_time'] as const) {
      for (const authorRole of ['moderator', 'admin'] as const) {
        expect(decideCommentStatus({ mode, authorCommentCount: 0, authorRole })).toBe('published');
        expect(decideCommentStatus({ mode, authorCommentCount: 9, authorRole })).toBe('published');
      }
    }
  });

  it('T-UNIT-6 a held first-timer who posts again while still count 0 is held again (04 §1.2)', () => {
    expect(
      decideCommentStatus({ mode: 'hold_first_time', authorCommentCount: 0, authorRole: 'user' }),
    ).toBe('held');
  });
});

// ---- T-UNIT-7 ---------------------------------------------------------------------------------

describe('T-UNIT-7 shouldAutoHold', () => {
  it('T-UNIT-7 AUTO_HOLD_REPORTS = 3 is exported', () => {
    expect(AUTO_HOLD_REPORTS).toBe(3);
  });

  it.each([
    [2, 'user', false],
    [3, 'user', true],
    [4, 'user', true],
    [3, 'moderator', false],
    [3, 'admin', false],
  ] as const)('T-UNIT-7 (%d reports, %s) → %s', (reportCount, authorRole, expected) => {
    expect(shouldAutoHold(reportCount, authorRole)).toBe(expected);
  });

  it('T-UNIT-7 staff comments never auto-hold however many reports arrive (M7)', () => {
    expect(shouldAutoHold(99, 'moderator')).toBe(false);
    expect(shouldAutoHold(99, 'admin')).toBe(false);
  });

  it('T-UNIT-7 zero or one report never holds', () => {
    expect(shouldAutoHold(0, 'user')).toBe(false);
    expect(shouldAutoHold(1, 'user')).toBe(false);
  });
});

// ---- T-UNIT-8 ---------------------------------------------------------------------------------

const CREATED = '2026-09-03T12:00:00.000Z';
const createdMs = Date.parse(CREATED);
const MINUTE = 60_000;

describe('T-UNIT-8 isWithinEditWindow', () => {
  afterEach(() => {
    unfreeze();
  });

  it('T-UNIT-8 EDIT_WINDOW_MS = 900000 (15 minutes)', () => {
    expect(EDIT_WINDOW_MS).toBe(900_000);
    expect(EDIT_WINDOW_MS).toBe(15 * MINUTE);
  });

  it('T-UNIT-8 14:59 → true, 15:00 → false (boundary exclusive), 15:01 → false — explicit now', () => {
    expect(isWithinEditWindow(CREATED, createdMs + 14 * MINUTE + 59_000)).toBe(true);
    expect(isWithinEditWindow(CREATED, createdMs + 15 * MINUTE)).toBe(false);
    expect(isWithinEditWindow(CREATED, createdMs + 15 * MINUTE + 1_000)).toBe(false);
  });

  it('T-UNIT-8 the same boundary against the faked app clock (default now = Date.now())', () => {
    freezeAt(CREATED);
    expect(isWithinEditWindow(CREATED)).toBe(true);
    advance(14 * MINUTE + 59_000);
    expect(isWithinEditWindow(CREATED)).toBe(true);
    advance(1_000); // exactly 15:00
    expect(isWithinEditWindow(CREATED)).toBe(false);
    advance(MINUTE); // 16:00
    expect(isWithinEditWindow(CREATED)).toBe(false);
  });

  it('T-UNIT-8 one millisecond inside the window is still inside; the boundary itself is out', () => {
    expect(isWithinEditWindow(CREATED, createdMs + EDIT_WINDOW_MS - 1)).toBe(true);
    expect(isWithinEditWindow(CREATED, createdMs + EDIT_WINDOW_MS)).toBe(false);
  });

  it('T-UNIT-8 accepts an ISO string, a Date or an epoch number for created_at and now', () => {
    const inside = createdMs + 5 * MINUTE;
    expect(isWithinEditWindow(new Date(CREATED), inside)).toBe(true);
    expect(isWithinEditWindow(createdMs, new Date(inside))).toBe(true);
    expect(isWithinEditWindow(CREATED, new Date(createdMs + 20 * MINUTE))).toBe(false);
  });

  it('T-UNIT-8 an unparseable created_at is never inside the window', () => {
    expect(isWithinEditWindow('not a date', createdMs)).toBe(false);
  });
});

// ---- 04 §1.2 moderateComment transitions (supplementary — no 05 ID) --------------------------

const STATUSES: readonly CommentStatus[] = ['published', 'held', 'hidden', 'deleted'];

/** 04 §1.2: approve `held → published`; hide `published|held → hidden`; unhide `hidden → published`; delete any non-deleted → `deleted`. */
const LEGAL: ReadonlyArray<[ModerateAction, CommentStatus, CommentStatus]> = [
  ['approve', 'held', 'published'],
  ['hide', 'published', 'hidden'],
  ['hide', 'held', 'hidden'],
  ['unhide', 'hidden', 'published'],
  ['delete', 'published', 'deleted'],
  ['delete', 'held', 'deleted'],
  ['delete', 'hidden', 'deleted'],
];

describe('nextStatus (04 §1.2 moderateComment transitions)', () => {
  it.each(LEGAL)('%s from %s → %s', (action, from, to) => {
    expect(nextStatus(action, from)).toBe(to);
  });

  it('every other (action, status) pair is illegal → null (the action answers `conflict`)', () => {
    const legal = new Set(LEGAL.map(([action, from]) => `${action}:${from}`));
    for (const action of Object.keys(MODERATION_TRANSITIONS) as ModerateAction[]) {
      for (const status of STATUSES) {
        if (legal.has(`${action}:${status}`)) continue;
        expect(nextStatus(action, status), `${action} from ${status}`).toBeNull();
      }
    }
  });

  it('a deleted comment has no way back (no action moves it)', () => {
    for (const action of ['approve', 'hide', 'unhide', 'delete'] as const) {
      expect(nextStatus(action, 'deleted')).toBeNull();
    }
  });

  it('MODERATION_TRANSITIONS lists exactly the four actions with the 04 §1.2 targets', () => {
    expect(Object.keys(MODERATION_TRANSITIONS).sort()).toEqual([
      'approve',
      'delete',
      'hide',
      'unhide',
    ]);
    expect(MODERATION_TRANSITIONS.approve.to).toBe('published');
    expect(MODERATION_TRANSITIONS.hide.to).toBe('hidden');
    expect(MODERATION_TRANSITIONS.unhide.to).toBe('published');
    expect(MODERATION_TRANSITIONS.delete.to).toBe('deleted');
    expect([...MODERATION_TRANSITIONS.delete.from].sort()).toEqual(['held', 'hidden', 'published']);
  });
});
