/**
 * tests/unit/adapters/http.test.ts — `lib/adapters/http.ts` `fetchJson` / `AdapterError`
 * (05 T-ADP-1: 04 SC-09 timeout / retry / backoff / `Retry-After` / `X-Ratelimit-Reset` + SC-10
 * User-Agent + secret-free errors; 05 T-ADP-20: nothing under `lib/adapters/` reads `process.env`;
 * ADR-0030 D6: `method: 'POST'` + JSON `body`, an empty 2xx body → `null`, `retryOn` narrowing;
 * ADR-0043 D3: `fetchText` — the same loop for a non-JSON body, blind to the response content type;
 * ADR-0045: `fetchPage` — the same loop again, with the three opt-in guards the S1.8 Open Graph read
 * needs: `redirect: 'manual'`, `contentTypes`, `maxBytes`).
 * Pure over `mockFetch` — no sockets (05 H-5); backoff timing via fake timers.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdapterError, fetchJson, fetchPage, fetchText, redactSecrets } from '@/lib/adapters/http';
import { REPO_ROOT } from '../../helpers/envTest';
import { mockFetch } from '../../helpers/mockFetch';

/** SC-10: the ua option is `env.MODRINTH_USER_AGENT` (`.env.test` value, no email). */
const UA = 'odsens.com/test (localhost)';

const URL_LIST = 'https://upstream.test/list';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Routes `URL_LIST` for a run under fake timers, recording each attempt's offset from t0. */
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
    expect(names.length).toBeGreaterThanOrEqual(7); // http, modrinth, curseforge, resend, discord, youtube, oembed
    for (const name of names) {
      const text = readFileSync(path.join(dir, name), 'utf8');
      expect(text, `lib/adapters/${name} must take env by injection (04 SC-25)`).not.toContain(
        'process.env',
      );
    }
  });
});

describe('T-ADP-1 fetchJson POST + empty body (ADR-0030 D6)', () => {
  it('T-ADP-1 method POST sends JSON.stringify(body) with Content-Type: application/json, Accept and the SC-10 UA', async () => {
    const seen: {
      method?: string;
      contentType?: string | null;
      body?: string;
      ua?: string | null;
    } = {};
    const impl = mockFetch({
      [URL_LIST]: async (request) => {
        seen.method = request.method;
        seen.contentType = request.headers.get('content-type');
        seen.ua = request.headers.get('user-agent');
        seen.body = await request.text();
        return Response.json({ id: 'abc' });
      },
    });
    const data = await fetchJson<{ id: string }>(URL_LIST, {
      ua: UA,
      fetch: impl,
      method: 'POST',
      body: { hello: 'world', n: 1 },
      headers: { Authorization: 'Bearer tok123' },
    });
    expect(data).toEqual({ id: 'abc' });
    expect(seen.method).toBe('POST');
    expect(seen.contentType).toBe('application/json');
    expect(seen.ua).toBe(UA);
    expect(seen.body).toBe(JSON.stringify({ hello: 'world', n: 1 }));
  });

  it('T-ADP-1 GET stays the default: no body, no Content-Type', async () => {
    const seen: { method?: string; contentType?: string | null; body?: string } = {};
    const impl = mockFetch({
      [URL_LIST]: async (request) => {
        seen.method = request.method;
        seen.contentType = request.headers.get('content-type');
        seen.body = await request.text();
        return Response.json({ ok: true });
      },
    });
    await fetchJson(URL_LIST, { ua: UA, fetch: impl });
    expect(seen.method).toBe('GET');
    expect(seen.contentType).toBeNull();
    expect(seen.body).toBe('');
  });

  it('T-ADP-1 a 2xx with an empty body (204) resolves to null instead of a parse_error', async () => {
    const impl = mockFetch({ [URL_LIST]: () => new Response(null, { status: 204 }) });
    await expect(
      fetchJson<unknown>(URL_LIST, { ua: UA, fetch: impl, method: 'POST', body: {} }),
    ).resolves.toBeNull();
    const blank = mockFetch({ [URL_LIST]: () => new Response('  \n', { status: 200 }) });
    await expect(fetchJson<unknown>(URL_LIST, { ua: UA, fetch: blank })).resolves.toBeNull();
  });

  it('T-ADP-1 a failed POST names the method but never echoes the request body', async () => {
    const impl = mockFetch({
      [URL_LIST]: () => new Response('{"message":"nope"}', { status: 404 }),
    });
    const error = await fetchJson(URL_LIST, {
      ua: UA,
      fetch: impl,
      method: 'POST',
      body: { secret_body_marker: 'hunter2-body', to: ['seed-admin@localhost.test'] },
      headers: { Authorization: 'Bearer tok123' },
    }).then(
      () => null,
      (thrown: unknown) => thrown as AdapterError,
    );
    expect(error).toBeInstanceOf(AdapterError);
    expect(error?.message).toBe(`POST ${URL_LIST} → 404`);
    for (const text of [error?.message ?? '', error?.body ?? '']) {
      expect(text).not.toContain('hunter2-body');
      expect(text).not.toContain('secret_body_marker');
      expect(text).not.toContain('localhost.test');
      expect(text).not.toContain('tok123');
    }
    expect(error?.body).toBe('{"message":"nope"}');
  });

  it('T-ADP-1 retryOn narrows the retried set: an excluded 429 throws at once, 5xx still backs off', async () => {
    const fetchSpy = vi.fn(mockFetch({ [URL_LIST]: () => new Response('slow', { status: 429 }) }));
    await expect(
      fetchJson(URL_LIST, { ua: UA, fetch: fetchSpy, retryOn: (status) => status >= 500 }),
    ).rejects.toMatchObject({ status: 429, code: 'http_error' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    const { fetch: impl, times } = timedRoute((attempt) =>
      attempt === 1 ? new Response('boom', { status: 503 }) : Response.json({ ok: true }),
    );
    const promise = fetchJson<{ ok: boolean }>(URL_LIST, {
      ua: UA,
      fetch: impl,
      retryOn: (status) => status >= 500,
    });
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ ok: true });
    expect(times).toEqual([0, 1000]);
  });

  it('T-ADP-1 retryOn can never widen the set to other 4xx (SC-09: only 429/5xx are retryable)', async () => {
    const fetchSpy = vi.fn(mockFetch({ [URL_LIST]: () => new Response('gone', { status: 404 }) }));
    await expect(
      fetchJson(URL_LIST, { ua: UA, fetch: fetchSpy, retryOn: () => true }),
    ).rejects.toMatchObject({ status: 404 });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('T-ADP-1 echoed upstream bodies are redacted before truncation', () => {
  it('T-ADP-1 an error body (or an invalid-JSON 2xx body) that echoes the keyed URL carries key=[redacted], even across the 300-char cut', async () => {
    const url = 'https://upstream.test/v3/thing?part=snippet&key=hunter2-long-secret';
    const echo = `${'x'.repeat(250)} ${url}`; // the key value straddles char 300
    const denied = mockFetch({
      'https://upstream.test/v3/thing': () => new Response(echo, { status: 403 }),
    });
    const error = await fetchJson(url, { ua: UA, fetch: denied }).then(
      () => null,
      (thrown: unknown) => thrown as AdapterError,
    );
    expect(error?.body).toHaveLength(300);
    expect(error?.body).not.toContain('hunter2');
    expect(error?.body.endsWith('part=snippet&key=[')).toBe(true); // cut inside the marker, not the key

    const html = mockFetch({
      'https://upstream.test/v3/thing': () => new Response(`<html>${url}</html>`, { status: 200 }),
    });
    await expect(fetchJson(url, { ua: UA, fetch: html })).rejects.toMatchObject({
      code: 'parse_error',
      body: '<html>https://upstream.test/v3/thing?part=snippet&key=[redacted]',
    });
  });
});

describe('T-ADP-1 fetchText (ADR-0043 D3 — one loop with fetchJson)', () => {
  const XML = '<?xml version="1.0"?><feed><entry>not json at all</entry></feed>';

  it('T-ADP-1 fetchText returns the 2xx body verbatim with a 10 s AbortSignal.timeout, GET, the SC-10 UA and Accept */*', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const seen: { method?: string; ua?: string | null; accept?: string | null; body?: string } = {};
    const fetchSpy = vi.fn(
      mockFetch({
        [URL_LIST]: async (request) => {
          seen.method = request.method;
          seen.ua = request.headers.get('user-agent');
          seen.accept = request.headers.get('accept');
          seen.body = await request.text();
          return new Response(XML, { status: 200, headers: { 'content-type': 'application/xml' } });
        },
      }),
    );
    expect(await fetchText(URL_LIST, { ua: UA, fetch: fetchSpy })).toBe(XML);
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(timeoutSpy.mock.results[0]?.value);
    expect(seen).toEqual({ method: 'GET', ua: UA, accept: '*/*', body: '' });
  });

  it('T-ADP-1 fetchText never branches on the response content type (XML served as application/json, or with none)', async () => {
    const asJson = mockFetch({
      [URL_LIST]: () =>
        new Response(XML, { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    expect(await fetchText(URL_LIST, { ua: UA, fetch: asJson })).toBe(XML);
    const bare = mockFetch({ [URL_LIST]: () => new Response(new TextEncoder().encode(XML)) });
    expect(await fetchText(URL_LIST, { ua: UA, fetch: bare })).toBe(XML);
  });

  it("T-ADP-1 fetchText sends the caller's accept and resolves an empty 2xx body to an empty string", async () => {
    let accept: string | null = null;
    const impl = mockFetch({
      [URL_LIST]: (request) => {
        accept = request.headers.get('accept');
        return new Response(null, { status: 204 });
      },
    });
    expect(await fetchText(URL_LIST, { ua: UA, fetch: impl, accept: 'application/atom+xml' })).toBe(
      '',
    );
    expect(accept).toBe('application/atom+xml');
  });

  it('T-ADP-1 fetchText is GET only — a smuggled method/body is ignored', async () => {
    const seen: { method?: string; body?: string } = {};
    const impl = mockFetch({
      [URL_LIST]: async (request) => {
        seen.method = request.method;
        seen.body = await request.text();
        return new Response('ok');
      },
    });
    const smuggled = { ua: UA, fetch: impl, method: 'POST', body: { a: 1 } };
    expect(await fetchText(URL_LIST, smuggled)).toBe('ok');
    expect(seen).toEqual({ method: 'GET', body: '' });
  });

  it('T-ADP-1 fetchText retries 5xx with backoff 1 s → 2 s → 4 s, max 3 retries, then throws AdapterError', async () => {
    vi.useFakeTimers();
    const { fetch: impl, times } = timedRoute(() => new Response('feed exploded', { status: 503 }));
    const settled = fetchText(URL_LIST, { ua: UA, fetch: impl }).then(
      () => null,
      (error: unknown) => error,
    );
    await vi.runAllTimersAsync();
    const error = (await settled) as AdapterError;
    expect(times).toEqual([0, 1000, 3000, 7000]);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 503, code: 'http_error', body: 'feed exploded' });
    expect(error.message).toBe(`GET ${URL_LIST} → 503`);
  });

  it('T-ADP-1 fetchText honours Retry-After, recovers from network errors, and never retries a 404', async () => {
    vi.useFakeTimers();
    const { fetch: impl, times } = timedRoute((attempt) =>
      attempt === 1
        ? new Response('slow down', { status: 429, headers: { 'Retry-After': '10' } })
        : new Response(XML),
    );
    const promise = fetchText(URL_LIST, { ua: UA, fetch: impl });
    await vi.runAllTimersAsync();
    expect(await promise).toBe(XML);
    expect(times).toEqual([0, 10_000]);

    let calls = 0;
    const flaky = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('fetch failed');
      return new Response(XML);
    }) as typeof fetch;
    const recovered = fetchText(URL_LIST, { ua: UA, fetch: flaky });
    await vi.runAllTimersAsync();
    expect(await recovered).toBe(XML);
    expect(calls).toBe(2);

    vi.useRealTimers();
    const fetchSpy = vi.fn(mockFetch({ [URL_LIST]: () => new Response('gone', { status: 404 }) }));
    await expect(fetchText(URL_LIST, { ua: UA, fetch: fetchSpy })).rejects.toMatchObject({
      status: 404,
      code: 'http_error',
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('T-ADP-1 fetchText errors never contain key= values; redactSecrets covers every key-like param', async () => {
    const impl = mockFetch({
      'https://upstream.test/feed': () => new Response('denied', { status: 403 }),
    });
    const error = await fetchText('https://upstream.test/feed?channel_id=UC1&key=hunter2', {
      ua: UA,
      fetch: impl,
    }).then(
      () => null,
      (thrown: unknown) => thrown as AdapterError,
    );
    expect(error?.message).toBe(
      'GET https://upstream.test/feed?channel_id=UC1&key=[redacted] → 403',
    );
    expect(redactSecrets('https://x.test/a?part=snippet&key=hunter2&id=1')).toBe(
      'https://x.test/a?part=snippet&key=[redacted]&id=1',
    );
    expect(redactSecrets('GET /a?api_key=s3cret&token=t0k → 500')).toBe(
      'GET /a?api_key=[redacted]&token=[redacted] → 500',
    );
    expect(redactSecrets('https://x.test/a?part=snippet')).toBe('https://x.test/a?part=snippet');
  });
});

describe('T-ADP-1 fetchPage (ADR-0045 — one loop with fetchJson / fetchText, three opt-in guards)', () => {
  const HTML = '<!doctype html><title>hello</title>';
  const htmlHeaders = { 'content-type': 'text/html; charset=utf-8' };
  const encoder = new TextEncoder();

  /** A body that records whether anybody pulled from it or cancelled it (pulls only on demand). */
  function watchedBody(chunks: () => Uint8Array | null): {
    stream: ReadableStream<Uint8Array>;
    seen: { pulls: number; cancelled: boolean };
  } {
    const seen = { pulls: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          seen.pulls += 1;
          const next = chunks();
          if (next === null) controller.close();
          else controller.enqueue(next);
        },
        cancel() {
          seen.cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    return { stream, seen };
  }

  const caught = (promise: Promise<unknown>): Promise<AdapterError | null> =>
    promise.then(
      () => null,
      (thrown: unknown) => thrown as AdapterError,
    );

  it('T-ADP-1 fetchPage returns {status, location, contentType, text} for a 2xx: GET, the SC-10 UA, Accept, a 10 s AbortSignal.timeout', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const seen: { method?: string; ua?: string | null; accept?: string | null } = {};
    const responses: number[] = [];
    const fetchSpy = vi.fn(
      mockFetch({
        [URL_LIST]: (request) => {
          seen.method = request.method;
          seen.ua = request.headers.get('user-agent');
          seen.accept = request.headers.get('accept');
          return new Response(HTML, { headers: { 'content-type': 'Text/HTML; Charset=UTF-8' } });
        },
      }),
    );
    const page = await fetchPage(URL_LIST, {
      ua: UA,
      fetch: fetchSpy,
      accept: 'text/html',
      onResponse: (response) => responses.push(response.status),
    });
    expect(page).toEqual({ status: 200, location: null, contentType: 'text/html', text: HTML });
    expect(seen).toEqual({ method: 'GET', ua: UA, accept: 'text/html' });
    expect(responses).toEqual([200]);
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(fetchSpy.mock.calls[0]?.[1]?.signal).toBe(timeoutSpy.mock.results[0]?.value);

    // No content type at all → null; the default Accept is any type; a smuggled method/body is ignored.
    let accept: string | null = null;
    let method = '';
    const bare = mockFetch({
      [URL_LIST]: (request) => {
        accept = request.headers.get('accept');
        method = request.method;
        return new Response(encoder.encode('raw'));
      },
    });
    const smuggled = { ua: UA, fetch: bare, method: 'POST', body: { a: 1 } };
    expect(await fetchPage(URL_LIST, smuggled)).toEqual({
      status: 200,
      location: null,
      contentType: null,
      text: 'raw',
    });
    expect(accept).toBe('*/*');
    expect(method).toBe('GET');
  });

  it.each([301, 302, 303, 307, 308])(
    'T-ADP-1 fetchPage redirect manual: a %i is RETURNED with its raw Location, never followed, its body cancelled unread',
    async (status) => {
      const { stream, seen } = watchedBody(() => encoder.encode('you are being redirected'));
      const redirectModes: string[] = [];
      const fetchSpy = vi.fn(
        mockFetch({
          'https://upstream.test/final': () => new Response('followed!', { headers: htmlHeaders }),
          [URL_LIST]: (request) => {
            redirectModes.push(request.redirect);
            return new Response(stream, { status, headers: { location: '/final?x=1' } });
          },
        }),
      );
      const page = await fetchPage(URL_LIST, { ua: UA, fetch: fetchSpy, redirect: 'manual' });
      expect(page).toEqual({ status, location: '/final?x=1', contentType: null, text: '' });
      expect(redirectModes).toEqual(['manual']);
      expect(fetchSpy).toHaveBeenCalledTimes(1); // `/final` was never asked for
      expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
      expect(seen).toEqual({ pulls: 0, cancelled: true });
    },
  );

  it('T-ADP-1 fetchPage redirect manual: an absolute Location is passed through verbatim; a missing one is null; onResponse sees the hop', async () => {
    const statuses: number[] = [];
    const absolute = mockFetch({
      [URL_LIST]: () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/latest/meta-data/?token=abc' },
        }),
    });
    expect(
      await fetchPage(URL_LIST, {
        ua: UA,
        fetch: absolute,
        redirect: 'manual',
        onResponse: (response) => statuses.push(response.status),
      }),
    ).toEqual({
      status: 302,
      location: 'http://127.0.0.1/latest/meta-data/?token=abc', // raw — the CALLER re-checks it
      contentType: null,
      text: '',
    });
    expect(statuses).toEqual([302]);

    const missing = mockFetch({ [URL_LIST]: () => new Response(null, { status: 301 }) });
    expect(await fetchPage(URL_LIST, { ua: UA, fetch: missing, redirect: 'manual' })).toEqual({
      status: 301,
      location: null,
      contentType: null,
      text: '',
    });
  });

  it('T-ADP-1 fetchPage redirect manual: any other 3xx (300, 304) stays an http_error; a 2xx is read as usual', async () => {
    for (const status of [300, 304]) {
      const impl = mockFetch({ [URL_LIST]: () => new Response(null, { status }) });
      await expect(
        fetchPage(URL_LIST, { ua: UA, fetch: impl, redirect: 'manual' }),
      ).rejects.toMatchObject({ status, code: 'http_error' });
    }
    const ok = mockFetch({ [URL_LIST]: () => new Response(HTML, { headers: htmlHeaders }) });
    expect(await fetchPage(URL_LIST, { ua: UA, fetch: ok, redirect: 'manual' })).toEqual({
      status: 200,
      location: null,
      contentType: 'text/html',
      text: HTML,
    });
  });

  it('T-ADP-1 the redirect key is opt-in: fetchJson, fetchText and a plain fetchPage send the init object they always sent', async () => {
    const fetchSpy = vi.fn(mockFetch({ [URL_LIST]: () => Response.json({ ok: true }) }));
    await fetchJson(URL_LIST, { ua: UA, fetch: fetchSpy });
    await fetchText(URL_LIST, { ua: UA, fetch: fetchSpy });
    await fetchPage(URL_LIST, { ua: UA, fetch: fetchSpy });
    await fetchPage(URL_LIST, { ua: UA, fetch: fetchSpy, redirect: 'follow' });
    await fetchPage(URL_LIST, { ua: UA, fetch: fetchSpy, redirect: 'manual' });
    const keys = fetchSpy.mock.calls.map((call) => Object.keys(call[1] ?? {}));
    expect(keys).toEqual([
      ['method', 'headers', 'signal'],
      ['method', 'headers', 'signal'],
      ['method', 'headers', 'signal'],
      ['method', 'headers', 'signal'],
      ['method', 'headers', 'redirect', 'signal'],
    ]);
  });

  it('T-ADP-1 fetchText under redirect manual reports the hop as an http_error — never an empty string', async () => {
    const impl = mockFetch({
      [URL_LIST]: () => new Response(null, { status: 302, headers: { location: '/elsewhere' } }),
    });
    const error = await caught(fetchText(URL_LIST, { ua: UA, fetch: impl, redirect: 'manual' }));
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 302, code: 'http_error', body: '' });
    expect(error?.message).toBe(`GET ${URL_LIST} → 302`);
  });

  it.each([
    ['another type', { 'content-type': 'application/pdf' }],
    ['JSON', { 'content-type': 'application/json; charset=utf-8' }],
    ['a look-alike', { 'content-type': 'text/htmlx' }],
    ['no header at all', {}],
  ] as [string, Record<string, string>][])(
    'T-ADP-1 fetchPage contentTypes: %s → typed unsupported, the body unread, NOT retried',
    async (_label, headers) => {
      const { stream, seen } = watchedBody(() => encoder.encode('%PDF-1.7 …'));
      const fetchSpy = vi.fn(mockFetch({ [URL_LIST]: () => new Response(stream, { headers }) }));
      const error = await caught(
        fetchPage(URL_LIST, { ua: UA, fetch: fetchSpy, contentTypes: ['text/html'] }), // default retries: 3
      );
      expect(error).toBeInstanceOf(AdapterError);
      expect(error).toMatchObject({ status: 200, code: 'unsupported', body: '' });
      expect(error?.message).toBe(`GET ${URL_LIST} → unsupported (content type)`);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(seen).toEqual({ pulls: 0, cancelled: true });
    },
  );

  it('T-ADP-1 fetchPage contentTypes: a listed type passes whatever its case or parameters; unset → never checked', async () => {
    const xhtml = mockFetch({
      [URL_LIST]: () =>
        new Response(HTML, { headers: { 'content-type': 'APPLICATION/XHTML+XML;charset=utf-8' } }),
    });
    const page = await fetchPage(URL_LIST, {
      ua: UA,
      fetch: xhtml,
      contentTypes: ['text/html', 'application/xhtml+xml'],
    });
    expect(page).toMatchObject({ status: 200, contentType: 'application/xhtml+xml', text: HTML });

    const pdf = mockFetch({
      [URL_LIST]: () => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
    });
    expect(await fetchPage(URL_LIST, { ua: UA, fetch: pdf })).toMatchObject({
      contentType: 'application/pdf',
      text: '%PDF',
    });
  });

  it('T-ADP-1 fetchPage maxBytes: a Content-Length over the cap → unsupported before a single byte is read, not retried', async () => {
    const { stream, seen } = watchedBody(() => encoder.encode('x'.repeat(10)));
    const fetchSpy = vi.fn(
      mockFetch({
        [URL_LIST]: () =>
          new Response(stream, { headers: { ...htmlHeaders, 'content-length': '2000000' } }),
      }),
    );
    const error = await caught(
      fetchPage(URL_LIST, { ua: UA, fetch: fetchSpy, maxBytes: 1_048_576 }),
    );
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 200, code: 'unsupported', body: '' });
    expect(error?.message).toBe(`GET ${URL_LIST} → unsupported (body over 1048576 bytes)`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(seen).toEqual({ pulls: 0, cancelled: true });
  });

  it('T-ADP-1 fetchPage maxBytes: a streamed body with no (or a lying) Content-Length is cut off the moment it passes the cap', async () => {
    for (const headers of [htmlHeaders, { ...htmlHeaders, 'content-length': '12' }]) {
      const chunk = encoder.encode('x'.repeat(40_000));
      const { stream, seen } = watchedBody(() => chunk); // never ends on its own
      const fetchSpy = vi.fn(mockFetch({ [URL_LIST]: () => new Response(stream, { headers }) }));
      const error = await caught(
        fetchPage(URL_LIST, { ua: UA, fetch: fetchSpy, maxBytes: 100_000 }),
      );
      expect(error).toMatchObject({ status: 200, code: 'unsupported', body: '' });
      expect(seen.pulls).toBe(3); // 40k + 40k + 40k > 100k — the 4th chunk is never asked for
      expect(seen.cancelled).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    }
  });

  it('T-ADP-1 fetchPage maxBytes: a body at or under the cap is decoded as UTF-8 — a character split across chunks, a BOM, an exact fit', async () => {
    const bytes = encoder.encode('\uFEFFcafé ☕ déjà vu');
    const cut = bytes.indexOf(0xc3) + 1; // between the two bytes of the first `é`
    const parts = [bytes.slice(0, cut), bytes.slice(cut), null];
    const { stream } = watchedBody(() => parts.shift() ?? null);
    const impl = mockFetch({ [URL_LIST]: () => new Response(stream, { headers: htmlHeaders }) });
    const page = await fetchPage(URL_LIST, { ua: UA, fetch: impl, maxBytes: bytes.byteLength });
    expect(page).toEqual({
      status: 200,
      location: null,
      contentType: 'text/html',
      text: 'café ☕ déjà vu',
    });
    // Same answer as the uncapped read of the same bytes.
    const plain = mockFetch({ [URL_LIST]: () => new Response(bytes, { headers: htmlHeaders }) });
    expect((await fetchPage(URL_LIST, { ua: UA, fetch: plain })).text).toBe(page.text);

    const oneOver = mockFetch({ [URL_LIST]: () => new Response(bytes, { headers: htmlHeaders }) });
    await expect(
      fetchPage(URL_LIST, { ua: UA, fetch: oneOver, maxBytes: bytes.byteLength - 1 }),
    ).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('T-ADP-1 fetchPage maxBytes: a 5 MB 500 body is NOT read whole — ≤ maxBytes (and ≤ 1,200 bytes) pulled, the rest cancelled, excerpt ≤ 300 chars, still retried (ADR-0046)', async () => {
    vi.useFakeTimers();
    const CHUNK = 64 * 1024;
    const chunk = encoder.encode('e'.repeat(CHUNK));
    const bodies: { pulls: number; cancelled: boolean }[] = [];
    const fetchSpy = vi.fn(
      mockFetch({
        [URL_LIST]: () => {
          let sent = 0;
          const { stream, seen } = watchedBody(() => {
            if (sent >= 5 * 1024 * 1024) return null; // 5 MB in 64 KiB chunks
            sent += CHUNK;
            return chunk;
          });
          bodies.push(seen);
          return new Response(stream, { status: 500, headers: htmlHeaders });
        },
      }),
    );
    const settled = caught(fetchPage(URL_LIST, { ua: UA, fetch: fetchSpy, maxBytes: 1_048_576 }));
    await vi.runAllTimersAsync();
    const error = await settled;
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 500, code: 'http_error' });
    expect(error?.body).toBe('e'.repeat(300));
    expect(fetchSpy).toHaveBeenCalledTimes(4); // the SC-09 loop is unchanged: 1 + 3 retries
    // Every attempt pulled ONE chunk (64 KiB ≥ the 1,200-byte excerpt read) and cancelled the rest.
    expect(bodies).toHaveLength(4);
    for (const seen of bodies) expect(seen).toEqual({ pulls: 1, cancelled: true });
  });

  it('T-ADP-1 fetchPage maxBytes: an error body is cut at the excerpt, redacted first, and never thrown over as unsupported', async () => {
    const echoed = `no: ${URL_LIST}?key=hunter2&x=${'y'.repeat(5_000)}`;
    const fetchSpy = vi.fn(
      mockFetch({ [URL_LIST]: () => new Response(echoed, { status: 403, headers: htmlHeaders }) }),
    );
    const error = await caught(
      fetchPage(URL_LIST, { ua: UA, fetch: fetchSpy, maxBytes: 100, retries: 0 }),
    );
    expect(error).toMatchObject({ status: 403, code: 'http_error' });
    // ≤ 100 bytes were read; the redaction then swaps a 7-char value for `[redacted]`.
    expect(error?.body.length).toBeLessThanOrEqual(100 + '[redacted]'.length);
    expect(error?.body).toContain('key=[redacted]');
    expect(error?.body).not.toContain('hunter2');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Without maxBytes nothing changed: the whole body is read, then cut to 300 after redaction.
    const whole = await caught(fetchPage(URL_LIST, { ua: UA, fetch: fetchSpy, retries: 0 }));
    expect(whole?.body).toHaveLength(300);
    expect(whole?.body).toContain('key=[redacted]');
    expect(whole?.body).not.toContain('hunter2');
  });

  it('T-ADP-1 fetchPage maxBytes: a null body is the empty string', async () => {
    const impl = mockFetch({
      [URL_LIST]: () => new Response(null, { status: 200, headers: htmlHeaders }),
    });
    expect(
      await fetchPage(URL_LIST, {
        ua: UA,
        fetch: impl,
        maxBytes: 10,
        contentTypes: ['text/html'],
      }),
    ).toEqual({ status: 200, location: null, contentType: 'text/html', text: '' });
  });

  it('T-ADP-1 fetchPage timeout: timeoutMs reaches AbortSignal.timeout; a timed-out request or a body that dies mid-read is a typed network_error', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const timedOut = vi.fn((async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    }) as typeof fetch);
    const error = await caught(
      fetchPage(URL_LIST, { ua: UA, fetch: timedOut, timeoutMs: 2_500, retries: 0 }),
    );
    expect(timeoutSpy).toHaveBeenCalledWith(2_500);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({ status: 0, code: 'network_error', body: '' });
    expect(error?.message).toContain('TimeoutError');
    expect(timedOut).toHaveBeenCalledTimes(1);

    let pulls = 0;
    const dying = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls === 1) controller.enqueue(encoder.encode('<html>'));
          else controller.error(new DOMException('aborted', 'TimeoutError'));
        },
      },
      { highWaterMark: 0 },
    );
    const midRead = mockFetch({
      [URL_LIST]: () => new Response(dying, { headers: htmlHeaders }),
    });
    const readError = await caught(
      fetchPage(`${URL_LIST}?token=hunter2`, { ua: UA, fetch: midRead, maxBytes: 1_000 }),
    );
    expect(readError).toBeInstanceOf(AdapterError);
    expect(readError).toMatchObject({ status: 0, code: 'network_error', body: '' });
    expect(readError?.message).toContain('token=[redacted]');
    expect(readError?.message).not.toContain('hunter2');
  });

  it('T-ADP-1 fetchPage retries: 0 is honoured (one attempt, no backoff); the default is still the SC-09 loop', async () => {
    const once = vi.fn(mockFetch({ [URL_LIST]: () => new Response('boom', { status: 503 }) }));
    await expect(fetchPage(URL_LIST, { ua: UA, fetch: once, retries: 0 })).rejects.toMatchObject({
      status: 503,
      code: 'http_error',
      body: 'boom',
    });
    expect(once).toHaveBeenCalledTimes(1);

    const dead = vi.fn((async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    await expect(fetchPage(URL_LIST, { ua: UA, fetch: dead, retries: 0 })).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
    });
    expect(dead).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    const { fetch: impl, times } = timedRoute(() => new Response('boom', { status: 500 }));
    const settled = caught(fetchPage(URL_LIST, { ua: UA, fetch: impl }));
    await vi.runAllTimersAsync();
    expect(await settled).toMatchObject({ status: 500, code: 'http_error' });
    expect(times).toEqual([0, 1000, 3000, 7000]);
  });

  it('T-ADP-1 fetchPage labels are redacted: no key-like query value reaches an unsupported / http_error message', async () => {
    const url = 'https://upstream.test/page?id=7&key=hunter2&sig=s1gnature';
    const pdf = mockFetch({
      'https://upstream.test/page': () =>
        new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }),
    });
    const big = mockFetch({
      'https://upstream.test/page': () => new Response('x'.repeat(50), { headers: htmlHeaders }),
    });
    const denied = mockFetch({
      'https://upstream.test/page': (request) =>
        new Response(`no: ${request.url}`, { status: 403 }),
    });
    const errors = [
      await caught(fetchPage(url, { ua: UA, fetch: pdf, contentTypes: ['text/html'] })),
      await caught(fetchPage(url, { ua: UA, fetch: big, maxBytes: 10 })),
      await caught(fetchPage(url, { ua: UA, fetch: denied, retries: 0 })),
    ];
    expect(errors.map((error) => error?.code)).toEqual([
      'unsupported',
      'unsupported',
      'http_error',
    ]);
    for (const error of errors) {
      expect(error?.message).toContain('key=[redacted]&sig=[redacted]');
      for (const text of [error?.message ?? '', error?.body ?? '']) {
        expect(text).not.toContain('hunter2');
        expect(text).not.toContain('s1gnature');
      }
    }
  });
});
