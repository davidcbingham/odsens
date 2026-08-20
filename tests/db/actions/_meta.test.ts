/**
 * tests/db/actions/_meta.test.ts — T-ACT-0 (05 §7.2) for every S1.1 action exported from
 * lib/actions/accounts.ts (`checkHandle`, `completeOnboarding`, `updateProfile`, `deleteAccount`).
 *
 * (1) result shape + never throws: `@/lib/supabase/admin` is mocked to THROW in this file, so the first
 *     service-role touch inside each action (the rate limiter / the admin read) blows up like a DB
 *     outage would — the action must still return `{ok:false, error:{code:'internal'}}` and write
 *     exactly one `log.error` line carrying the request `id` (04 SC-15; ADR-0013).
 * (2) zod validation happens before any DB call: invalid input as `anon` → `validation` with plain
 *     `issues[]` (not `unauthenticated`), and `fetch` is never called.
 * (3) no `requireRole` action exists in S1.1 (the first ones — `curateProject`… — arrive in S1.2; this
 *     test then grows the "role re-check with admin mocked to succeed" loop per 05 T-ACT-0 (3)).
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
import type { ActionResult } from '@/lib/actions/result';
import { INTERNAL_MESSAGE, VALIDATION_MESSAGE } from '@/lib/actions/run';
import { freeHandle, readProfile } from '@/tests/helpers/arrange';
import { ACTION_ERROR_CODES, expectFail, expectResultShape } from '@/tests/helpers/actionResult';
import { SEED_ROLE_IDS } from '@/tests/helpers/asRole';
import { callAction, setupActionMocks } from '@/tests/helpers/callAction';
import { REPO_ROOT } from '@/tests/helpers/envTest';
import { spyLog, type LogSpy } from '@/tests/helpers/spies';

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: (): never => {
    throw new Error('T-ACT-0 fault injection: service-role client unavailable');
  },
}));

setupActionMocks();

const { checkHandle, completeOnboarding, updateProfile, deleteAccount } = accounts;

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
    // The first requireRole actions land in S1.2 (curateProject, triggerSync…); extend this test then
    // with the "role user + admin client mocked to succeed → forbidden" loop from 05 T-ACT-0 (3).
    expect(source.includes('requireRole')).toBe(false);
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
