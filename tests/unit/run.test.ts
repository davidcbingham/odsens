/**
 * tests/unit/run.test.ts — `lib/actions/run.ts`: `formDataToObject` (FormData → plain object; an
 * untouched `<input type=file>` is dropped whatever its name) and `runAction` (the 04 SC-03 envelope:
 * a coded error → its code, a `ZodError` → `validation` with plain `issues`, anything else → `internal`
 * + exactly ONE `log.error` line). 04 SC-02 / SC-03 / SC-15; 01 INV-18 / INV-19; ADR-0013.
 *
 * This is the unit half of 05 T-ACT-0 (1)/(2), which asserts the same contract per action in the db
 * lane; 05 §7.4 has no dedicated T-UNIT id for the wrapper, so the titles below are descriptive.
 * `server-only` is mocked by tests/helpers/setup.unit.ts. `lib/log.ts` writes its real JSON lines —
 * captured here with `vi.spyOn(console, …)` so the "exactly one line" rule is checked for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ok } from '@/lib/actions/result';
import {
  INTERNAL_MESSAGE,
  VALIDATION_MESSAGE,
  formDataToObject,
  isCodedError,
  runAction,
} from '@/lib/actions/run';

const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe('formDataToObject — FormData → plain object (lib/actions/run.ts; 04 SC-02)', () => {
  it('drops an untouched file input that arrives as an empty Blob (browser → busboy shape, name "blob")', () => {
    const fd = new FormData();
    fd.append('handle', 'abc');
    fd.append('avatar', new Blob([]));

    // Document the shape the guard must catch: the platform wraps a bare Blob as File { name: 'blob', size: 0 }.
    const entry = fd.get('avatar');
    expect(entry).toBeInstanceOf(File);
    expect((entry as File).name).toBe('blob');
    expect((entry as File).size).toBe(0);

    const out = formDataToObject(fd);
    expect(out).toEqual({ handle: 'abc' });
    expect('avatar' in out).toBe(false);
  });

  it('drops an empty File with an empty name (Node-built FormData shape)', () => {
    const fd = new FormData();
    fd.append('handle', 'abc');
    fd.append('avatar', new File([], ''));

    const out = formDataToObject(fd);
    expect(out).toEqual({ handle: 'abc' });
    expect('avatar' in out).toBe(false);
  });

  it('keeps a real non-empty File as a File (name, size and type intact)', () => {
    const fd = new FormData();
    fd.append('avatar', new File([PNG_HEAD], 'pic.png', { type: 'image/png' }));

    const out = formDataToObject(fd);
    expect(out.avatar).toBeInstanceOf(File);
    const file = out.avatar as File;
    expect(file.name).toBe('pic.png');
    expect(file.size).toBe(PNG_HEAD.byteLength);
    expect(file.type).toBe('image/png');
  });

  it('passes plain string fields through unchanged (booleans stay the strings "true" / "false")', () => {
    const fd = new FormData();
    fd.append('handle', 'abc');
    fd.append('removeAvatar', 'true');
    fd.append('note', '');

    expect(formDataToObject(fd)).toEqual({ handle: 'abc', removeAvatar: 'true', note: '' });
  });

  it("ignores React's internal $ACTION_* fields", () => {
    const fd = new FormData();
    fd.append('$ACTION_ID_0123', 'x');
    fd.append('$ACTION_REF_1', 'y');
    fd.append('handle', 'abc');

    expect(formDataToObject(fd)).toEqual({ handle: 'abc' });
  });
});

describe('runAction — the 04 SC-03 envelope (unit half of T-ACT-0 (1)/(2))', () => {
  const schema = z.object({
    handle: z.string(),
    avatar: z.custom<File>((value) => value instanceof File).optional(),
  });
  type Input = z.infer<typeof schema>;

  let errSpy: ReturnType<typeof vi.spyOn>;
  let outSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    outSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('FormData with an empty file input reaches fn without the avatar key', async () => {
    const fd = new FormData();
    fd.append('handle', 'abc');
    fd.append('avatar', new Blob([]));

    const fn = vi.fn(async (input: Input) => ok(input));
    const result = await runAction('unitAction', schema, fd, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, data: { handle: 'abc' } });
    if (result.ok) expect('avatar' in result.data).toBe(false);
  });

  it('input that fails the schema → validation, "Check the form.", plain issues, fn never called', async () => {
    const fn = vi.fn(async (input: Input) => ok(input));
    const result = await runAction('unitAction', schema, {}, fn);

    expect(fn).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'validation',
        message: VALIDATION_MESSAGE,
        field: 'handle',
        issues: [{ path: 'handle', message: 'Required.' }],
      },
    });
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("a schema's own message is kept; zod's generic wording becomes 'Required.' / 'Check this field.'", async () => {
    const worded = z.object({
      handle: z.string({ error: 'Pick a handle.' }),
      count: z.number(),
      flag: z.boolean(),
    });
    const result = await runAction(
      'unitAction',
      worded,
      { count: 'x', flag: null },
      async (input) => ok(input),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation');
    expect(result.error.field).toBe('handle');
    expect(result.error.issues).toEqual([
      { path: 'handle', message: 'Pick a handle.' },
      { path: 'count', message: 'Check this field.' },
      { path: 'flag', message: 'Check this field.' },
    ]);
  });

  it('a thrown error carrying code "rate_limited" → that code and its message, no log line', async () => {
    const thrown = Object.assign(new Error('Slow down a little.'), {
      code: 'rate_limited' as const,
    });
    const result = await runAction('unitAction', schema, { handle: 'abc' }, async () => {
      throw thrown;
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'rate_limited', message: 'Slow down a little.' },
    });
    expect(errSpy).not.toHaveBeenCalled();
    expect(outSpy).not.toHaveBeenCalled();
  });

  it('a ZodError thrown inside fn → validation with plain { path, message } issues', async () => {
    const inner = z.object({ count: z.number() });
    const result = await runAction('unitAction', schema, { handle: 'abc' }, async () => {
      inner.parse({ count: 'x' });
      return ok(null);
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('validation');
    expect(result.error.message).toBe(VALIDATION_MESSAGE);
    expect(result.error.field).toBe('count');
    expect(result.error.issues).toEqual([{ path: 'count', message: 'Check this field.' }]);
    for (const issue of result.error.issues ?? []) {
      expect(Object.keys(issue).sort()).toEqual(['message', 'path']);
      expect(issue.message).not.toMatch(/invalid|expected|received|zod/i);
    }
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('an unknown error → internal, "Something broke.", exactly one log.error line with action + ctx.id', async () => {
    let seenId = '';
    const result = await runAction('unitAction', schema, { handle: 'abc' }, async (_input, ctx) => {
      seenId = ctx.id;
      throw new TypeError('boom');
    });

    expect(result).toEqual({ ok: false, error: { code: 'internal', message: INTERNAL_MESSAGE } });
    expect(seenId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(outSpy).not.toHaveBeenCalled();
    const raw = errSpy.mock.calls[0]?.[0];
    expect(typeof raw).toBe('string');
    const line: unknown = JSON.parse(String(raw));
    expect(line).toMatchObject({
      action: 'unitAction',
      id: seenId,
      level: 'error',
      msg: 'unhandled',
      meta: { name: 'TypeError' },
    });
    // Only the error's name reaches the log — never its message (04 SC-15 / 01 INV-43).
    expect(String(raw)).not.toContain('boom');
  });

  it('a thrown non-Error value → internal, meta.name is its typeof', async () => {
    const result = await runAction('unitAction', schema, { handle: 'abc' }, async () => {
      throw 'nope';
    });

    expect(result).toEqual({ ok: false, error: { code: 'internal', message: INTERNAL_MESSAGE } });
    expect(errSpy).toHaveBeenCalledTimes(1);
    const line: unknown = JSON.parse(String(errSpy.mock.calls[0]?.[0]));
    expect(line).toMatchObject({ msg: 'unhandled', meta: { name: 'string' } });
  });

  it('isCodedError accepts only a string code from the 04 §7 union', () => {
    expect(isCodedError(Object.assign(new Error('x'), { code: 'rate_limited' }))).toBe(true);
    expect(isCodedError({ code: 'unauthenticated' })).toBe(true);
    expect(isCodedError({ code: 'not_a_code' })).toBe(false);
    expect(isCodedError({ code: 429 })).toBe(false);
    expect(isCodedError(new Error('x'))).toBe(false);
    expect(isCodedError(null)).toBe(false);
    expect(isCodedError('rate_limited')).toBe(false);
  });
});
