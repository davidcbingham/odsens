/**
 * tests/unit/adapters/resend.test.ts — `lib/adapters/resend.ts` (05 T-ADP-17 + the resend half of
 * T-ADP-20; 04 §4.5 export list, SC-09/SC-10/SC-25; ADR-0030 D6/D13).
 * Fixtures: `tests/fixtures/resend/{send-ok,422}.json` (F-5; hand-made minimal shapes). Pure over
 * `mockFetch` (05 H-5); the SC-09 retry timing via fake timers. Addresses are `*@localhost.test` only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { AdapterError } from '@/lib/adapters/http';
import {
  DEFAULT_FROM_EMAIL,
  RESEND_API,
  createResend,
  type SendEmailInput,
} from '@/lib/adapters/resend';
import { loadFixture, loadFixtureText } from '../../helpers/fixtures';
import { mockFetch } from '../../helpers/mockFetch';

const UA = 'odsens.com/test (localhost)';
const KEY = 're_test';
const ENV = { RESEND_API_KEY: KEY, MODRINTH_USER_AGENT: UA };
const EMAILS_URL = `${RESEND_API}/emails`;
const ROW_ID = '5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a';

const sendOk = await loadFixture<{ id: string }>('resend', 'send-ok.json');
const rejectedBody = await loadFixtureText('resend', '422.json');

/** A deliverer-shaped input: rendered html + text, the recipient row id as the entity ref. */
const INPUT: SendEmailInput = {
  to: 'seed-admin@localhost.test',
  subject: 'New comment on Metal Pipe Mace',
  html: '<p>The allay picked this up on Metal Pipe Mace, from creeperfan9:</p>',
  text: 'The allay picked this up on Metal Pipe Mace, from creeperfan9:',
  headers: { 'X-Entity-Ref-ID': ROW_ID },
};

type SentBody = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  reply_to?: string;
};

/** Routes `POST /emails` to `respond`, capturing the request for assertions. */
function capture(respond: () => Response = () => Response.json(sendOk)) {
  const seen: { body?: SentBody; headers?: Record<string, string>; method?: string; url?: string } =
    {};
  const fetchSpy = vi.fn(
    mockFetch({
      [EMAILS_URL]: async (request) => {
        seen.url = request.url;
        seen.method = request.method;
        seen.headers = Object.fromEntries(request.headers);
        seen.body = JSON.parse(await request.text()) as SentBody;
        return respond();
      },
    }),
  );
  return { fetchSpy, seen };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('T-ADP-17 resend sendEmail (04 §4.5)', () => {
  it('T-ADP-17 POST https://api.resend.com/emails with Bearer key, the T-ADP-17 body and X-Entity-Ref-ID → {id}', async () => {
    const { fetchSpy, seen } = capture();
    const resend = createResend({ fetch: fetchSpy, env: ENV });
    const result = await resend.sendEmail(INPUT);
    expect(result).toEqual({ id: sendOk.id });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(seen.url).toBe('https://api.resend.com/emails');
    expect(seen.method).toBe('POST');
    expect(seen.headers?.authorization).toBe(`Bearer ${KEY}`);
    expect(seen.headers?.['content-type']).toBe('application/json');
    expect(seen.headers?.accept).toBe('application/json');
    expect(seen.headers?.['user-agent']).toBe(UA); // SC-10
    expect(seen.body?.from).toBe(`odsens <${DEFAULT_FROM_EMAIL}>`);
    expect(seen.body?.to).toEqual(['seed-admin@localhost.test']);
    expect(seen.body?.subject).toBe('New comment on Metal Pipe Mace');
    expect(seen.body?.html.length).toBeGreaterThan(0);
    expect(seen.body?.text.length).toBeGreaterThan(0);
    expect(seen.body?.headers).toEqual({ 'X-Entity-Ref-ID': ROW_ID });
    expect(seen.body).not.toHaveProperty('reply_to'); // 04 N5: no Reply-To yet
    expect(seen.body).not.toHaveProperty('react'); // ADR-0030 D6: rendered at the deliverer seam
  });

  it('T-ADP-17 from defaults to `odsens <NOTIFY_FROM_EMAIL>` (env value, then allay@odsens.com); an explicit from wins', async () => {
    const custom = capture();
    await createResend({
      fetch: custom.fetchSpy,
      env: { ...ENV, NOTIFY_FROM_EMAIL: 'allay-staging@localhost.test' },
    }).sendEmail(INPUT);
    expect(custom.seen.body?.from).toBe('odsens <allay-staging@localhost.test>');

    const explicit = capture();
    await createResend({ fetch: explicit.fetchSpy, env: ENV }).sendEmail({
      ...INPUT,
      from: 'the allay <allay@odsens.com>',
    });
    expect(explicit.seen.body?.from).toBe('the allay <allay@odsens.com>');
  });

  it('T-ADP-17 reply_to is sent only when the deliverer passes replyTo', async () => {
    const { fetchSpy, seen } = capture();
    await createResend({ fetch: fetchSpy, env: ENV }).sendEmail({
      ...INPUT,
      replyTo: 'allay@odsens.com',
    });
    expect(seen.body?.reply_to).toBe('allay@odsens.com');
  });

  it('T-ADP-17 extra headers pass through beside X-Entity-Ref-ID', async () => {
    const { fetchSpy, seen } = capture();
    await createResend({ fetch: fetchSpy, env: ENV }).sendEmail({
      ...INPUT,
      headers: {
        'X-Entity-Ref-ID': ROW_ID,
        'List-Unsubscribe': '<http://localhost:3000/admin/settings>',
      },
    });
    expect(seen.body?.headers).toEqual({
      'X-Entity-Ref-ID': ROW_ID,
      'List-Unsubscribe': '<http://localhost:3000/admin/settings>',
    });
  });

  it('T-ADP-17 RESEND_API_BASE (tests only) redirects the POST to the fixture server route', async () => {
    const seen: { url?: string } = {};
    const impl = mockFetch({
      'http://127.0.0.1:4010/resend/emails': (request) => {
        seen.url = request.url;
        return Response.json(sendOk);
      },
    });
    const resend = createResend({
      fetch: impl,
      env: { ...ENV, RESEND_API_BASE: 'http://127.0.0.1:4010/resend/' },
    });
    await expect(resend.sendEmail(INPUT)).resolves.toEqual({ id: sendOk.id });
    expect(seen.url).toBe('http://127.0.0.1:4010/resend/emails');
  });

  it('T-ADP-17 resend/422.json → typed rejected (status 422), not retried, key + address absent from the error', async () => {
    const { fetchSpy } = capture(() => new Response(rejectedBody, { status: 422 }));
    const resend = createResend({ fetch: fetchSpy, env: ENV });
    const error = await resend.sendEmail(INPUT).then(
      () => null,
      (thrown: unknown) => thrown as AdapterError,
    );
    expect(error).toBeInstanceOf(AdapterError);
    expect(error?.code).toBe('rejected');
    expect(error?.status).toBe(422);
    expect(error?.body).toContain('validation_error');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    for (const text of [error?.message ?? '', error?.body ?? '']) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('seed-admin');
      expect(text).not.toContain('creeperfan9');
    }
  });

  it('T-ADP-17 429 → T-ADP-1 retry (1 s backoff) then {id}', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const t0 = Date.now();
    const impl = mockFetch({
      [EMAILS_URL]: () => {
        times.push(Date.now() - t0);
        return times.length === 1
          ? new Response('{"message":"Too many requests"}', { status: 429 })
          : Response.json(sendOk);
      },
    });
    const promise = createResend({ fetch: impl, env: ENV }).sendEmail(INPUT);
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ id: sendOk.id });
    expect(times).toEqual([0, 1000]);
  });

  it('T-ADP-17 5xx → T-ADP-1 retries (1 s → 2 s → 4 s) then http_error', async () => {
    vi.useFakeTimers();
    const times: number[] = [];
    const t0 = Date.now();
    const impl = mockFetch({
      [EMAILS_URL]: () => {
        times.push(Date.now() - t0);
        return new Response('{"message":"Internal server error"}', { status: 500 });
      },
    });
    const settled = createResend({ fetch: impl, env: ENV })
      .sendEmail(INPUT)
      .then(
        () => null,
        (thrown: unknown) => thrown as AdapterError,
      );
    await vi.runAllTimersAsync();
    const error = await settled;
    expect(times).toEqual([0, 1000, 3000, 7000]);
    expect(error?.code).toBe('http_error');
    expect(error?.status).toBe(500);
  });

  it('T-ADP-17 a blank html or text is rejected before any request', async () => {
    const { fetchSpy } = capture();
    const resend = createResend({ fetch: fetchSpy, env: ENV });
    await expect(resend.sendEmail({ ...INPUT, html: '   ' })).rejects.toMatchObject({
      code: 'rejected',
    });
    await expect(resend.sendEmail({ ...INPUT, text: '' })).rejects.toMatchObject({
      code: 'rejected',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('T-ADP-17 a 2xx without an id → typed parse_error', async () => {
    const { fetchSpy } = capture(() => Response.json({}));
    await expect(
      createResend({ fetch: fetchSpy, env: ENV }).sendEmail(INPUT),
    ).rejects.toMatchObject({ code: 'parse_error' });
  });
});

describe('T-ADP-20 resend env by injection (04 SC-25)', () => {
  it('T-ADP-20 missing RESEND_API_KEY → createResend throws a zod error naming it, no request', () => {
    const fetchSpy = vi.fn(mockFetch({}));
    let thrown: unknown;
    try {
      createResend({ fetch: fetchSpy, env: { MODRINTH_USER_AGENT: UA } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZodError);
    expect((thrown as ZodError).issues.map((issue) => issue.path.join('.'))).toContain(
      'RESEND_API_KEY',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('T-ADP-20 missing UA → createResend throws a zod error naming MODRINTH_USER_AGENT', () => {
    let thrown: unknown;
    try {
      createResend({ env: { RESEND_API_KEY: KEY } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ZodError);
    expect((thrown as ZodError).issues.map((issue) => issue.path.join('.'))).toContain(
      'MODRINTH_USER_AGENT',
    );
  });
});
