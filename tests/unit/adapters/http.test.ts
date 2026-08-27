/**
 * tests/unit/adapters/http.test.ts — `lib/adapters/http.ts` `fetchJson` / `AdapterError`
 * (05 T-ADP-1: 04 SC-09 timeout / retry / backoff / `Retry-After` / `X-Ratelimit-Reset` + SC-10
 * User-Agent + secret-free errors; 05 T-ADP-20: nothing under `lib/adapters/` reads `process.env`).
 * Pure over `mockFetch` — no sockets (05 H-5); backoff timing via fake timers.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterError, fetchJson } from '@/lib/adapters/http';
import { REPO_ROOT } from '../../helpers/envTest';
import { mockFetch } from '../../helpers/mockFetch';

/** SC-10: the ua option is `env.MODRINTH_USER_AGENT` (`.env.test` value, no email). */
const UA = 'odsens.com/test (localhost)';

const URL_LIST = 'https://upstream.test/list';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Runs `fetchJson` under fake timers, recording each attempt's offset from t0. */
function timedRoute(respond: (attempt: number) => Response): {
  fetch: typeof fetch;
  times: number[];
} {
  const times: number[] = [];
  const t0 = Date.now();
  const impl = mockFetch({
    [URL_LIST]: () => {
      times.push(Date.now() - t0);
      return respond(times.length);
    },
  });
  return { fetch: impl, times };
}

describe('T-ADP-1 fetchJson (04 SC-09/SC-10)', () => {
  it('T-ADP-1 sends a 10 s AbortSignal.timeout and returns parsed JSON on 200', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const fetchSpy = vi.fn(mockFetch({ [URL_LIST]: Response.json({ hello: 'world' }) }));
    const data = await fetchJson<{ hello: string }>(URL_LIST, { ua: UA, fetch: fetchSpy });
    expect(data).toEqual({ hello: 'world' });
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(timeoutSpy.mock.results[0]?.value);
  });

  it('T-ADP-1 retries 5xx with backoff 1 s → 2 s → 4 s, max 3 retries, then throws AdapterError', async () => {
    vi.useFakeTimers();
    const { fetch: impl, times } = timedRoute(
      () => new Response('server exploded', { status: 500 }),
    );
    const settled = fetchJson(URL_LIST, { ua: UA, fetch: impl }).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    const error = await settled;
    expect(times).toEqual([0, 1000, 3000, 7000]); // 4 attempts: 1 s → 2 s → 4 s between them
    expect(error).toBeInstanceOf(AdapterError);
    const adapterError = error as AdapterError;
    expect(adapterError.status).toBe(500);
    expect(adapterError.code).toBe('http_error');
    expect(adapterError.body).toBe('server exploded');
  });

  it('T-ADP-1 honours Retry-After when larger than the backoff', async () => {
    vi.useFakeTimers();
    const { fetch: impl, times } = timedRoute((attempt) =>
      attempt === 1
        ? new Response('slow down', { status: 429, headers: { 'Retry-After': '10' } })
        : Response.json({ ok: true }),
    );
    const promise = fetchJson<{ ok: boolean }>(URL_LIST, { ua: UA, fetch: impl });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ ok: true });
    expect(times).toEqual([0, 10_000]);
  });

  it('T-ADP-1 caps the honoured wait at 30 s', async () => {
    vi.useFakeTimers();
    const { fetch: impl, times } = timedRoute((attempt) =>
      attempt === 1
        ? new Response('slow down', { status: 429, headers: { 'Retry-After': '120' } })
        : Response.json({ ok: true }),
    );
    const promise = fetchJson<{ ok: boolean }>(URL_LIST, { ua: UA, fetch: impl });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ ok: true });
    expect(times).toEqual([0, 30_000]);
  });

  it('T-ADP-1 honours X-Ratelimit-Reset (seconds) when larger than the backoff', async () => {
    vi.useFakeTimers();
    const { fetch: impl, times } = timedRoute((attempt) =>
      attempt === 1
        ? new Response('rate limited', { status: 429, headers: { 'X-Ratelimit-Reset': '7' } })
        : Response.json({ ok: true }),
    );
    const promise = fetchJson<{ ok: boolean }>(URL_LIST, { ua: UA, fetch: impl });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ ok: true });
    expect(times).toEqual([0, 7000]);
  });

  it('T-ADP-1 retries network errors and succeeds once the network recovers', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const impl = (async () => {
      calls += 1;
      if (calls <= 2) throw new TypeError('fetch failed');
      return Response.json({ ok: true });
    }) as typeof fetch;
    const promise = fetchJson<{ ok: boolean }>(URL_LIST, { ua: UA, fetch: impl });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it('T-ADP-1 exhausted network retries throw AdapterError {status 0, code network_error}', async () => {
    vi.useFakeTimers();
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const settled = fetchJson(URL_LIST, { ua: UA, fetch: impl }).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    const error = (await settled) as AdapterError;
    expect(error).toBeInstanceOf(AdapterError);
    expect(error.status).toBe(0);
    expect(error.code).toBe('network_error');
  });

  it('T-ADP-1 does not retry 4xx other than 429', async () => {
    const fetchSpy = vi.fn(mockFetch({ [URL_LIST]: () => new Response('gone', { status: 404 }) }));
    await expect(fetchJson(URL_LIST, { ua: UA, fetch: fetchSpy })).rejects.toMatchObject({
      status: 404,
      code: 'http_error',
      body: 'gone',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('T-ADP-1 truncates the upstream error body to 300 chars', async () => {
    const impl = mockFetch({ [URL_LIST]: () => new Response('x'.repeat(400), { status: 404 }) });
    const error = await fetchJson(URL_LIST, { ua: UA, fetch: impl }).then(
      () => null,
      (thrown: unknown) => thrown as AdapterError,
    );
    expect(error?.body).toBe('x'.repeat(300));
  });

  it('T-ADP-1 invalid JSON on a 2xx throws a typed parse_error', async () => {
    const impl = mockFetch({ [URL_LIST]: () => new Response('<!doctype html>', { status: 200 }) });
    await expect(fetchJson(URL_LIST, { ua: UA, fetch: impl })).rejects.toMatchObject({
      code: 'parse_error',
      body: '<!doctype html>',
    });
  });

  it('T-ADP-1 every request (retries included) carries User-Agent = env.MODRINTH_USER_AGENT', async () => {
    vi.useFakeTimers();
    const agents: (string | null)[] = [];
    const accepts: (string | null)[] = [];
    const impl = mockFetch({
      [URL_LIST]: (request) => {
        agents.push(request.headers.get('user-agent'));
        accepts.push(request.headers.get('accept'));
        return agents.length < 3
          ? new Response('boom', { status: 500 })
          : Response.json({ ok: true });
      },
    });
    const promise = fetchJson(URL_LIST, { ua: UA, fetch: impl });
    await vi.runAllTimersAsync();
    await promise;
    expect(agents).toEqual([UA, UA, UA]);
    expect(accepts).toEqual(['application/json', 'application/json', 'application/json']);
  });

  it('T-ADP-1 errors never contain key=/x-api-key/Authorization values', async () => {
    const url = 'https://upstream.test/v3/thing?key=hunter2&part=snippet';
    const impl = mockFetch({
      'https://upstream.test/v3/thing': () => new Response('denied', { status: 403 }),
    });
    const error = await fetchJson(url, {
      ua: UA,
      fetch: impl,
      headers: { 'x-api-key': 'supersecret', Authorization: 'Bearer tok123' },
    }).then(
      () => null,
      (thrown: unknown) => thrown as AdapterError,
    );
    expect(error).toBeInstanceOf(AdapterError);
    for (const text of [error?.message ?? '', error?.body ?? '']) {
      expect(text).not.toContain('hunter2');
      expect(text).not.toContain('supersecret');
      expect(text).not.toContain('tok123');
    }
    expect(error?.message).toContain('key=[redacted]');
  });
});

describe('T-ADP-20 adapters never read process.env (04 SC-25)', () => {
  it('T-ADP-20 grep "process.env" over lib/adapters/ finds nothing', () => {
    const dir = path.join(REPO_ROOT, 'lib', 'adapters');
    const names = readdirSync(dir).filter((name) => name.endsWith('.ts'));
    expect(names.length).toBeGreaterThanOrEqual(3); // http, modrinth, curseforge
    for (const name of names) {
      const text = readFileSync(path.join(dir, name), 'utf8');
      expect(text, `lib/adapters/${name} must take env by injection (04 SC-25)`).not.toContain(
        'process.env',
      );
    }
  });
});
