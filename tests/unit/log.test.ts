/**
 * tests/unit/log.test.ts — T-UNIT-33: `lib/log.ts` shape + redaction (01 INV-42 / INV-43; 04 SC-15).
 * `console.log` / `console.error` are spied and silenced; `lib/log.ts` is the only module that may
 * call them. Test mode (`isTest` from lib/env.ts, set under Vitest) makes malformed entries throw.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { log, redactMeta } from '@/lib/log';

const REDACTED = '[redacted]';

let logSpy: MockInstance<typeof console.log>;
let errorSpy: MockInstance<typeof console.error>;

function onlyLine(spy: MockInstance<typeof console.log>): Record<string, unknown> {
  expect(spy).toHaveBeenCalledTimes(1);
  const [text] = spy.mock.calls[0] ?? [];
  expect(typeof text).toBe('string');
  const parsed: unknown = JSON.parse(text as string);
  expect(parsed).toBeTypeOf('object');
  return parsed as Record<string, unknown>;
}

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lib/log.ts (T-UNIT-33)', () => {
  it('T-UNIT-33 info writes one JSON line with action, id, level, msg, meta, ts — and redacts meta', () => {
    log.info({
      action: 'x',
      id: 'abc',
      msg: 'm',
      meta: {
        email: 'a@b.c',
        ip: '1.2.3.4',
        authorization: 'Bearer t',
        token: 't',
        webhook: 'https://discord.com/api/webhooks/1/x',
        email_hash: 'deadbeef',
        signed_url: 'https://x.supabase.co/storage/v1/object/sign/a?token=abc',
        body: 'comment text',
        nested: { password: 'p' },
        ok: 'keep',
      },
    });

    const line = onlyLine(logSpy);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(Object.keys(line).sort()).toEqual(['action', 'id', 'level', 'meta', 'msg', 'ts']);
    expect(line).not.toHaveProperty('job');
    expect(line.action).toBe('x');
    expect(line.id).toBe('abc');
    expect(line.level).toBe('info');
    expect(line.msg).toBe('m');
    expect(typeof line.ts).toBe('string');
    expect(new Date(line.ts as string).toISOString()).toBe(line.ts);

    const meta = line.meta as Record<string, unknown>;
    for (const key of [
      'email',
      'ip',
      'authorization',
      'token',
      'webhook',
      'email_hash',
      'signed_url',
      'body',
    ]) {
      expect(meta[key], key).toBe(REDACTED);
    }
    expect((meta.nested as Record<string, unknown>).password).toBe(REDACTED);
    expect(meta.ok).toBe('keep');
  });

  it('T-UNIT-33 job entries carry job (not action) and warn also goes to stdout', () => {
    log.warn({ job: 'syncModrinth', id: 'run-1', msg: 'slow' });
    const line = onlyLine(logSpy);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(Object.keys(line).sort()).toEqual(['id', 'job', 'level', 'meta', 'msg', 'ts']);
    expect(line.job).toBe('syncModrinth');
    expect(line.level).toBe('warn');
    expect(line.meta).toEqual({});
  });

  it('T-UNIT-33 error level writes to console.error with the same keys', () => {
    log.error({ action: 'postComment', id: 'req-1', msg: 'boom', meta: { profile_id: 'p1' } });
    const line = onlyLine(errorSpy);
    expect(logSpy).not.toHaveBeenCalled();
    expect(line.level).toBe('error');
    expect(line.meta).toEqual({ profile_id: 'p1' });
  });

  it('T-UNIT-33 a string value containing token= or sig= is redacted under any key', () => {
    log.info({
      action: 'x',
      id: 'abc',
      msg: 'm',
      meta: {
        link: 'https://x/y?token=abc',
        other: 'https://x/y?a=1&sig=zzz',
        plain: 'https://x/y?a=1',
      },
    });
    const meta = onlyLine(logSpy).meta as Record<string, unknown>;
    expect(meta.link).toBe(REDACTED);
    expect(meta.other).toBe(REDACTED);
    expect(meta.plain).toBe('https://x/y?a=1');
  });

  it('T-UNIT-33 both job and action → throws in test mode', () => {
    expect(() => log.info({ job: 'j', action: 'a', id: 'abc', msg: 'm' })).toThrow(/exactly one/);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('T-UNIT-33 neither job nor action → throws in test mode', () => {
    expect(() => log.info({ id: 'abc', msg: 'm' })).toThrow(/exactly one/);
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe('redactMeta (T-UNIT-33)', () => {
  it('T-UNIT-33 matches keys case-insensitively after stripping _ and -', () => {
    const out = redactMeta({
      Email: 'a',
      'Set-Cookie': 'b',
      accessToken: 'c',
      REFRESH_TOKEN: 'd',
      userAgent: 'e',
      'ip-address': 'f',
      remote_addr: 'g',
      api_key: 'h',
      webhook_url: 'i',
    });
    for (const value of Object.values(out)) expect(value).toBe(REDACTED);
  });

  it('T-UNIT-33 keys ending in secret / token / key are redacted; exact key too', () => {
    const out = redactMeta({
      cron_secret: 'a',
      hmacToken: 'b',
      publishable_key: 'c',
      key: 'd',
      id: 'keep-id',
      profile_id: 'keep-profile',
      handle: 'keep-handle',
    });
    expect(out.cron_secret).toBe(REDACTED);
    expect(out.hmacToken).toBe(REDACTED);
    expect(out.publishable_key).toBe(REDACTED);
    expect(out.key).toBe(REDACTED);
    expect(out.id).toBe('keep-id');
    expect(out.profile_id).toBe('keep-profile');
    expect(out.handle).toBe('keep-handle');
  });

  it('T-UNIT-33 deep-walks arrays and nested objects without mutating the input', () => {
    const input = {
      list: [{ email: 'a' }, 'https://x/?token=1', 'fine'],
      deep: { deeper: { cookie: 'c', n: 1 } },
    };
    const snapshot = JSON.stringify(input);
    const out = redactMeta(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    const list = out.list as unknown[];
    expect((list[0] as Record<string, unknown>).email).toBe(REDACTED);
    expect(list[1]).toBe(REDACTED);
    expect(list[2]).toBe('fine');
    const deeper = (out.deep as Record<string, Record<string, unknown>>).deeper;
    expect(deeper?.cookie).toBe(REDACTED);
    expect(deeper?.n).toBe(1);
  });
});

describe('redactMeta — identity fields + webhook URLs (T-UNIT-33, 01 INV-43)', () => {
  it('T-UNIT-33 Google identity keys are redacted; a plain `name` (job/source) is kept', () => {
    const out = redactMeta({
      full_name: 'A Person',
      given_name: 'A',
      family_name: 'Person',
      display_name: 'AP',
      picture: 'https://lh3.googleusercontent.com/a/x',
      avatar_url: 'https://lh3.googleusercontent.com/a/y',
      phone: '+1 555 0100',
      name: 'modrinth',
    });
    for (const key of [
      'full_name',
      'given_name',
      'family_name',
      'display_name',
      'picture',
      'avatar_url',
      'phone',
    ]) {
      expect(out[key], key).toBe('[redacted]');
    }
    expect(out['name']).toBe('modrinth');
  });

  it('T-UNIT-33 a Discord webhook URL is redacted under any key, even without token=', () => {
    const out = redactMeta({
      url: 'https://discord.com/api/webhooks/123456789/AbCdEf-ghijk',
      legacy: 'https://discordapp.com/api/webhooks/123456789/AbCdEf-ghijk',
      nested: { link: 'https://discord.com/api/webhooks/1/x' },
      fine: 'https://discord.com/channels/1/2',
    });
    expect(out['url']).toBe('[redacted]');
    expect(out['legacy']).toBe('[redacted]');
    expect((out['nested'] as Record<string, unknown>)['link']).toBe('[redacted]');
    expect(out['fine']).toBe('https://discord.com/channels/1/2');
  });
});
