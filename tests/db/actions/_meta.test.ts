/**
 * tests/db/actions/_meta.test.ts — T-ACT-0 (05 §7.2) for every S1.1 action exported from
 * lib/actions/accounts.ts (`checkHandle`, `completeOnboarding`, `updateProfile`, `deleteAccount`) and,
 * since S1.4, the eight comment actions of lib/actions/comments.ts.
 *
 * (1) result shape + never throws: `@/lib/supabase/admin` is mocked to THROW in this file (a switch —
 *     see `adminMode`), so the first service-role touch inside each action (the rate limiter / the
 *     admin read / `emit`) blows up like a DB outage would — the action must still return
 *     `{ok:false, error:{code:'internal'}}` and write exactly one `log.error` line carrying the
 *     request `id` (04 SC-15; ADR-0013), with nothing written.
 * (2) zod validation happens before any DB call: invalid input as `anon` → `validation` with plain
 *     `issues[]` (not `unauthenticated`), and `fetch` is never called.
 * (3) role re-check: the S1.4 `requireRole` actions (`moderateComment`, `banUser`, `renameUserHandle`,
 *     the moderator path of `deleteComment`) called as `user` WITH the admin client mocked to succeed
 *     (the switch flipped to the real client) still answer `forbidden`; accounts.ts has no `requireRole`
 *     (S1.1), and every `requireRole` call site in comments.ts has its SC-24 `logAdmin` twin.
 * (4) every `error.code` asserted across tests/db/{actions,routes,proxy} is a member of the 04 §7 union.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as accounts from '@/lib/actions/accounts';
import type {
  CheckHandleInput,
  CompleteOnboardingInput,
  DeleteAccountInput,
  UpdateProfileInput,
} from '@/lib/actions/accounts.schema';
import * as comments from '@/lib/actions/comments';
import type {
  BanUserInput,
  ModerateCommentInput,
  PostCommentInput,
  RenameUserHandleInput,
  ReportCommentInput,
} from '@/lib/actions/comments.schema';
import type { ActionResult } from '@/lib/actions/result';
import { INTERNAL_MESSAGE, VALIDATION_MESSAGE } from '@/lib/actions/run';
import { freeHandle, readProfile } from '@/tests/helpers/arrange';
import { ACTION_ERROR_CODES, expectFail, expectResultShape } from '@/tests/helpers/actionResult';
import { asRole, SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import { REPO_ROOT } from '@/tests/helpers/envTest';
import {
  cleanupFactories,
  makeComment,
  makeUser,
  restoreSeedCommentCounts,
} from '@/tests/helpers/factories';
import { SEED_COMMENTS, SEED_PROJECTS, SEED_USERS } from '@/tests/helpers/seedIds';
import { spyLog, type LogSpy } from '@/tests/helpers/spies';

/** `throw` = the DB-outage fault injection of (1); `real` = the working service client for (3). */
const adminMode = vi.hoisted(() => ({ mode: 'throw' as 'throw' | 'real' }));

vi.mock('@/lib/supabase/admin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/admin')>();
  return {
    createAdminClient: () => {
      if (adminMode.mode === 'throw') {
        throw new Error('T-ACT-0 fault injection: service-role client unavailable');
      }
      return actual.createAdminClient();
    },
  };
});

setupActionMocks();

const { checkHandle, completeOnboarding, updateProfile, deleteAccount } = accounts;
const {
  postComment,
  editComment,
  deleteComment,
  toggleLike,
  reportComment,
  moderateComment,
  banUser,
  renameUserHandle,
} = comments;

const S14_ACTIONS = [
  'banUser',
  'deleteComment',
  'editComment',
  'moderateComment',
  'postComment',
  'renameUserHandle',
  'reportComment',
  'toggleLike',
] as const;

const service = asRole('service');
const TARGET = { target_type: 'project', target_id: SEED_PROJECTS.pixelChameleon } as const;

const S11_ACTIONS = [
  'checkHandle',
  'completeOnboarding',
  'deleteAccount',
  'updateProfile',
] as const;

let logs: LogSpy;
beforeEach(() => {
  logs = spyLog();
});
afterEach(() => {
  logs.restore();
});

function errorLines(): Array<Record<string, unknown>> {
  return (logs.lines as Array<Record<string, unknown>>).filter((line) => line.level === 'error');
}

function expectInternal<T>(res: ActionResult<T>, action: string): void {
  const error = expectFail(res, 'internal');
  expect(error.message).toBe(INTERNAL_MESSAGE);
  expect(error.issues).toBeUndefined();
  const errors = errorLines();
  expect(errors, 'exactly one log.error line').toHaveLength(1);
  const [line] = errors;
  expect(line?.action).toBe(action);
  expect(line?.msg).toBe('unhandled');
  expect(typeof line?.id).toBe('string');
  expect(String(line?.id)).toMatch(/^[0-9a-f-]{36}$/);
  expect(JSON.stringify(line)).not.toMatch(/@localhost\.test|fault injection/);
}

describe('T-ACT-0 (1) every action returns ActionResult and never throws', () => {
  it('T-ACT-0 checkHandle: service outage → internal + one log.error line', async () => {
    const res = await callAction(checkHandle, { handle: freeHandle() }, { role: 'user' });
    expectInternal(res, 'checkHandle');
  });

  it('T-ACT-0 completeOnboarding: service outage → internal, seed_newbie stays un-onboarded', async () => {
    const res = await callAction(
      completeOnboarding,
      { handle: freeHandle() },
      { role: 'nohandle' },
    );
    expectInternal(res, 'completeOnboarding');
    const row = await readProfile(SEED_ROLE_IDS.nohandle);
    expect(row?.handle).toBeNull();
  });

  it('T-ACT-0 updateProfile: service outage → internal, row untouched', async () => {
    const before = await readProfile(SEED_ROLE_IDS.user);
    const res = await callAction(updateProfile, { removeAvatar: true }, { role: 'user' });
    expectInternal(res, 'updateProfile');
    expect(await readProfile(SEED_ROLE_IDS.user)).toEqual(before);
  });

  it('T-ACT-0 deleteAccount: service outage → internal, seed_user still exists', async () => {
    const res = await callAction(deleteAccount, { confirm: true }, { role: 'user' });
    expectInternal(res, 'deleteAccount');
    expect((await readProfile(SEED_ROLE_IDS.user))?.handle).toBe('seed_user');
  });
});

describe('T-ACT-0 (1) S1.4 comment actions return internal on a service outage, nothing written', () => {
  afterAll(async () => {
    await cleanupFactories();
    await restoreSeedCommentCounts();
  });

  async function commentStatus(id: string): Promise<string> {
    const { data, error } = await service.from('comments').select('status').eq('id', id).single();
    if (error) throw new Error(error.message);
    return data.status;
  }

  it('T-ACT-0 postComment: the rate limiter needs the service client → internal, no row', async () => {
    const res = await callAction(
      postComment,
      { ...TARGET, body: 'T-ACT-0 outage' },
      { role: 'user' },
    );
    expectInternal(res, 'postComment');
    const { data } = await service.from('comments').select('id').eq('body', 'T-ACT-0 outage');
    expect(data).toEqual([]);
  });

  it('T-ACT-0 editComment: → internal, body untouched', async () => {
    const id = await makeComment({ author_id: SEED_USERS.seed_user });
    expectInternal(
      await callAction(editComment, { comment_id: id, body: 'changed' }, { role: 'user' }),
      'editComment',
    );
    const { data } = await service.from('comments').select('body').eq('id', id).single();
    expect(data?.body).not.toBe('changed');
  });

  it('T-ACT-0 deleteComment (author path and moderator path): → internal, status untouched', async () => {
    const own = await makeComment({ author_id: SEED_USERS.seed_user });
    expectInternal(
      await callAction(deleteComment, { comment_id: own }, { role: 'user' }),
      'deleteComment',
    );
    expect(await commentStatus(own)).toBe('published');
    logs.restore();
    logs = spyLog();
    expectInternal(
      await callAction(deleteComment, { comment_id: SEED_COMMENTS.published }, { role: 'mod' }),
      'deleteComment',
    );
    expect(await commentStatus(SEED_COMMENTS.published)).toBe('published');
  });

  it('T-ACT-0 toggleLike: → internal, no like row', async () => {
    expectInternal(
      await callAction(toggleLike, { comment_id: SEED_COMMENTS.published }, { role: 'user' }),
      'toggleLike',
    );
    const { data } = await service
      .from('comment_likes')
      .select('user_id')
      .eq('comment_id', SEED_COMMENTS.published)
      .eq('user_id', SEED_USERS.seed_user);
    expect(data).toEqual([]);
  });

  it('T-ACT-0 reportComment: → internal, no report row', async () => {
    expectInternal(
      await callAction(
        reportComment,
        { comment_id: SEED_COMMENTS.creatorReply, reason: 'spam' },
        { role: 'user' },
      ),
      'reportComment',
    );
    const { data } = await service
      .from('comment_reports')
      .select('id')
      .eq('comment_id', SEED_COMMENTS.creatorReply);
    expect(data).toEqual([]);
  });

  it('T-ACT-0 moderateComment: → internal, …0203 still held', async () => {
    expectInternal(
      await callAction(
        moderateComment,
        { comment_id: SEED_COMMENTS.held, action: 'approve' },
        { role: 'mod' },
      ),
      'moderateComment',
    );
    expect(await commentStatus(SEED_COMMENTS.held)).toBe('held');
  });

  it('T-ACT-0 banUser: → internal, target untouched', async () => {
    const target = await makeUser();
    expectInternal(
      await callAction(banUser, { profile_id: target, banned: true }, { role: 'mod' }),
      'banUser',
    );
    expect((await readProfile(target))?.is_banned).toBe(false);
  });

  it('T-ACT-0 renameUserHandle: → internal, handle untouched', async () => {
    const target = await makeUser();
    const before = (await readProfile(target))?.handle;
    expectInternal(
      await callAction(
        renameUserHandle,
        { profile_id: target, handle: freeHandle() },
        { role: 'mod' },
      ),
      'renameUserHandle',
    );
    expect((await readProfile(target))?.handle).toBe(before);
  });
});

describe('T-ACT-0 (2) zod validation runs before auth and before any DB call', () => {
  const invalid: Array<{
    name: string;
    call: () => Promise<ActionResult<unknown>>;
    path: string;
  }> = [
    {
      name: 'checkHandle: handle is not a string',
      call: () =>
        callAction(checkHandle, { handle: 123 } as unknown as CheckHandleInput, { role: 'anon' }),
      path: 'handle',
    },
    {
      name: 'checkHandle: handle longer than 64',
      call: () => callAction(checkHandle, { handle: 'x'.repeat(65) }, { role: 'anon' }),
      path: 'handle',
    },
    {
      name: 'completeOnboarding: missing handle',
      call: () =>
        callAction(completeOnboarding, {} as unknown as CompleteOnboardingInput, { role: 'anon' }),
      path: 'handle',
    },
    {
      name: 'completeOnboarding: avatar is not a File',
      call: () =>
        callAction(
          completeOnboarding,
          { handle: 'abc', avatar: 'not-a-file' } as unknown as CompleteOnboardingInput,
          { role: 'anon' },
        ),
      path: 'avatar',
    },
    {
      name: 'updateProfile: nothing to save',
      call: () => callAction(updateProfile, {} as UpdateProfileInput, { role: 'anon' }),
      path: '',
    },
    {
      name: 'updateProfile: removeAvatar=false only',
      call: () => callAction(updateProfile, { removeAvatar: false }, { role: 'anon' }),
      path: '',
    },
    {
      name: 'updateProfile: FormData with only an empty file input',
      call: () => {
        const form = new FormData();
        form.set('avatar', new File([], ''));
        return callAction(updateProfile, form, { role: 'anon' });
      },
      path: '',
    },
    {
      name: 'deleteAccount: confirm:false',
      call: () =>
        callAction(deleteAccount, { confirm: false } as unknown as DeleteAccountInput, {
          role: 'anon',
        }),
      path: 'confirm',
    },
    {
      name: 'postComment: target_type outside the v1 enum',
      call: () =>
        callAction(
          postComment,
          {
            target_type: 'skin',
            target_id: SEED_PROJECTS.pixelChameleon,
            body: 'hi',
          } as unknown as PostCommentInput,
          { role: 'anon' },
        ),
      path: 'target_type',
    },
    {
      name: 'postComment: empty body',
      call: () => callAction(postComment, { ...TARGET, body: '   ' }, { role: 'anon' }),
      path: 'body',
    },
    {
      name: 'editComment: comment_id is not a uuid',
      call: () => callAction(editComment, { comment_id: 'nope', body: 'x' }, { role: 'anon' }),
      path: 'comment_id',
    },
    {
      name: 'deleteComment: missing comment_id',
      call: () => callAction(deleteComment, {} as never, { role: 'anon' }),
      path: 'comment_id',
    },
    {
      name: 'toggleLike: comment_id is not a uuid',
      call: () => callAction(toggleLike, { comment_id: '123' }, { role: 'anon' }),
      path: 'comment_id',
    },
    {
      name: 'reportComment: reason outside the enum',
      call: () =>
        callAction(
          reportComment,
          { comment_id: SEED_COMMENTS.published, reason: 'meh' } as unknown as ReportCommentInput,
          { role: 'anon' },
        ),
      path: 'reason',
    },
    {
      name: 'moderateComment: unknown action',
      call: () =>
        callAction(
          moderateComment,
          { comment_id: SEED_COMMENTS.held, action: 'nuke' } as unknown as ModerateCommentInput,
          { role: 'anon' },
        ),
      path: 'action',
    },
    {
      name: 'banUser: reason over 200',
      call: () =>
        callAction(
          banUser,
          {
            profile_id: SEED_USERS.seed_user2,
            banned: true,
            reason: 'r'.repeat(201),
          } as BanUserInput,
          { role: 'anon' },
        ),
      path: 'reason',
    },
    {
      // H1/H3 are the RPC's call (04 §1.2 → handle_reserved / handle_taken / validation); only the
      // shape is zod's — a non-string handle fails before auth.
      name: 'renameUserHandle: handle is not a string',
      call: () =>
        callAction(
          renameUserHandle,
          { profile_id: SEED_USERS.seed_user2, handle: 42 } as unknown as RenameUserHandleInput,
          { role: 'anon' },
        ),
      path: 'handle',
    },
  ];

  it.each(invalid)('T-ACT-0 $name → validation, no network call', async ({ call, path: p }) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const res = await call();
      const error = expectFail(res, 'validation');
      expect(error.message).toBe(VALIDATION_MESSAGE);
      expect(error.issues?.length ?? 0).toBeGreaterThan(0);
      for (const issue of error.issues ?? []) {
        // plain words, never zod internals (04 SC-02)
        expect(issue.message).not.toMatch(/invalid_type|expected|received|ZodError|\$Zod/i);
        expect(issue.message).toMatch(/^[A-Z]/);
      }
      expect(error.issues?.[0]?.path).toBe(p);
      if (p) expect(error.field).toBe(p);
      expect(fetchSpy, 'no DB / GoTrue call before validation').not.toHaveBeenCalled();
      expect(errorLines()).toHaveLength(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('T-ACT-0 (3) role re-check', () => {
  it('T-ACT-0 S1.1 exports exactly the four account actions and none of them calls requireRole', () => {
    expect(Object.keys(accounts).sort()).toEqual([...S11_ACTIONS]);
    const source = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'actions', 'accounts.ts'), 'utf8');
    expect(source.includes('requireRole')).toBe(false);
  });

  it('T-ACT-0 S1.4 exports exactly the eight comment actions; every requireRole call site has its SC-24 logAdmin twin', () => {
    expect(Object.keys(comments).sort()).toEqual([...S14_ACTIONS]);
    const source = fs.readFileSync(path.join(REPO_ROOT, 'lib', 'actions', 'comments.ts'), 'utf8');
    const requireRoleCalls = source.match(/await requireRole\('moderator'\)/g) ?? [];
    const auditCalls = source.match(/logAdmin\('(\w+)'/g) ?? [];
    expect(requireRoleCalls).toHaveLength(4);
    expect(auditCalls.map((call) => call.slice("logAdmin('".length, -1)).sort()).toEqual([
      'banUser',
      'deleteComment',
      'moderateComment',
      'renameUserHandle',
    ]);
  });

  describe('T-ACT-0 requireRole actions as `user` with the admin client mocked to SUCCEED → forbidden', () => {
    beforeEach(() => {
      adminMode.mode = 'real';
    });
    afterEach(() => {
      adminMode.mode = 'throw';
    });

    const roleChecks: Array<{ name: string; call: () => Promise<ActionResult<unknown>> }> = [
      {
        name: 'moderateComment',
        call: () =>
          callAction(
            moderateComment,
            { comment_id: SEED_COMMENTS.held, action: 'approve' },
            { role: 'user' },
          ),
      },
      {
        name: 'banUser',
        call: () =>
          callAction(
            banUser,
            { profile_id: SEED_USERS.seed_user2, banned: true },
            { role: 'user' },
          ),
      },
      {
        name: 'renameUserHandle',
        call: () =>
          callAction(
            renameUserHandle,
            { profile_id: SEED_USERS.seed_user2, handle: freeHandle() },
            { role: 'user' },
          ),
      },
      {
        name: "deleteComment (someone else's comment)",
        call: () =>
          callAction(deleteComment, { comment_id: SEED_COMMENTS.creatorReply }, { role: 'user' }),
      },
    ];

    it.each(roleChecks)('T-ACT-0 $name → forbidden', async ({ call }) => {
      const error = expectFail(await call(), 'forbidden');
      expect(error.message).toBe('Not allowed.');
      expect(errorLines()).toHaveLength(0);
    });

    it('T-ACT-0 the switch really hands out a working client: …0203 is still held and the seed rows are untouched', async () => {
      const { data } = await service
        .from('comments')
        .select('status')
        .eq('id', SEED_COMMENTS.held)
        .single();
      expect(data?.status).toBe('held');
      expect((await readProfile(SEED_USERS.seed_user2))?.is_banned).toBe(false);
      expect((await readProfile(SEED_USERS.seed_user2))?.handle).toBe('seed_user2');
    });
  });
});

describe('T-ACT-0 (4) asserted error codes are 04 §7 members', () => {
  it('T-ACT-0 every code asserted under tests/db/{actions,routes,proxy.test.ts} is in the union', () => {
    const files = [
      ...fs.readdirSync(path.join(REPO_ROOT, 'tests', 'db', 'actions')).map((f) => `actions/${f}`),
      ...fs.readdirSync(path.join(REPO_ROOT, 'tests', 'db', 'routes')).map((f) => `routes/${f}`),
      'proxy.test.ts',
    ].filter((f) => f.endsWith('.test.ts'));
    const asserted = new Set<string>();
    for (const file of files) {
      const text = fs.readFileSync(path.join(REPO_ROOT, 'tests', 'db', file), 'utf8');
      for (const m of text.matchAll(/expectFail\([^;]*?,\s*'([a-z_]+)'\s*\)/g))
        asserted.add(m[1] ?? '');
      for (const m of text.matchAll(/\.code\)\.toBe\('([a-z_]+)'\)/g)) asserted.add(m[1] ?? '');
    }
    expect(asserted.size).toBeGreaterThan(0);
    const unknown = [...asserted].filter((code) => !ACTION_ERROR_CODES.has(code));
    expect(unknown, 'codes outside the 04 §7 ActionErrorCode union').toEqual([]);
  });

  it('T-ACT-0 the result helpers accept both arms of the envelope', () => {
    expectResultShape({ ok: true, data: { status: 'available' } });
    expectResultShape({ ok: false, error: { code: 'validation', message: 'Check the form.' } });
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
