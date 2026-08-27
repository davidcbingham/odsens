/**
 * tests/helpers/spies.ts — `spyRevalidateTag` · `spyRevalidatePath` · `spyFetch` · `spyLog` (05 §1.3).
 *
 * `next/cache` `revalidateTag`/`revalidatePath` are `vi.mock`ed for every `db` test file by
 * tests/helpers/setup.db.ts (recorders in tests/helpers/actionContext.ts). Calling `spyRevalidateTag()`
 * clears the recording and returns a LIVE view: `calls` keeps growing as the code under test runs.
 *   const tags = spyRevalidateTag();
 *   await callAction(…);
 *   expect(tags.calls).toEqual(['project:pixel-chameleon']);   // literal tag names (05 §1.3)
 *
 * `spyLog()` captures `lib/log.ts` output (one JSON line per call on stdout/stderr) as parsed objects;
 * non-JSON console output is ignored. Call `restore()` in `afterEach`/`afterAll` (a second `spyLog()`
 * restores the previous one first).
 *
 * `spyFetch(fixtureMap)` — the 05 §1.3 / §7.2 job harness ("adapters' `fetch` mocked to fixtures"):
 * replaces `globalThis.fetch` (jobs build adapters from `lib/env.ts` and pass no `fetch`, so the
 * adapter falls back to the global — 04 SC-25) with a router over `fixtureMap`. A key matches like
 * `mockFetch` (exact URL, URL without query, or prefix; first key in insertion order wins). Values:
 *   'modrinth/user-projects.json'  → the fixture file (status 200; `error-<nnn>.*` names → status nnn)
 *   'status:500'                   → an empty JSON body with that status
 *   a `Response` or `(req) => Response` → as `mockFetch` routes (for derived payloads, e.g. T-ACT-49)
 * Unmatched loopback URLs (the local Supabase stack) pass through to the real fetch; unmatched
 * non-loopback URLs throw (05 H-5). `calls` records matched URLs, `requests` their headers (e.g. the
 * T-ACT-52 `x-api-key` assertion). Call `restore()` in `afterEach`/`afterAll`; a second `spyFetch()`
 * restores the previous one first.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';
import { revalidatePathCalls, revalidateTagCalls, resetCacheSpies } from './actionContext';
import { FIXTURE_ROOT } from './fixtures';
import type { MockRoute } from './mockFetch';

export type TagSpy = { calls: string[] };
export type PathSpy = { calls: string[] };
export type LogSpy = { lines: object[]; restore: () => void };
/** url (or prefix) → fixture path under tests/fixtures/, `status:<nnn>`, or a mockFetch route. */
export type FixtureRoute = string | MockRoute;
export type FixtureMap = Record<string, FixtureRoute>;
export type FetchSpy = {
  calls: string[];
  requests: { url: string; headers: Record<string, string> }[];
  fetch: typeof fetch;
  restore: () => void;
};

export const spyRevalidateTag = (): TagSpy => {
  revalidateTagCalls.length = 0;
  return { calls: revalidateTagCalls };
};

export const spyRevalidatePath = (): PathSpy => {
  revalidatePathCalls.length = 0;
  return { calls: revalidatePathCalls };
};

/** Clears both revalidate recordings and the underlying `vi.fn` call lists. */
export const resetRevalidateSpies = (): void => {
  resetCacheSpies();
};

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const STATUS_VALUE = /^status:(\d{3})$/;
const ERROR_NAME = /^error-(\d{3})\./;

function fixtureResponse(fixture: string): Response {
  const statusFromName = ERROR_NAME.exec(path.basename(fixture));
  const body = readFileSync(path.join(FIXTURE_ROOT, fixture), 'utf8');
  return new Response(body, {
    status: statusFromName ? Number(statusFromName[1]) : 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function resolveRoute(route: FixtureRoute, request: Request): Response | Promise<Response> {
  if (typeof route === 'function') return route(request);
  if (route instanceof Response) return route.clone();
  const status = STATUS_VALUE.exec(route);
  if (status) {
    return new Response('{}', {
      status: Number(status[1]),
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  return fixtureResponse(route);
}

let activeFetchSpy: FetchSpy | null = null;

export const spyFetch = (fixtureMap: FixtureMap): FetchSpy => {
  activeFetchSpy?.restore();
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  const requests: { url: string; headers: Record<string, string> }[] = [];

  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input instanceof URL ? input.href : input, init);
    const bare = request.url.split('?')[0];
    for (const [key, route] of Object.entries(fixtureMap)) {
      if (request.url === key || bare === key || request.url.startsWith(key)) {
        calls.push(request.url);
        requests.push({ url: request.url, headers: Object.fromEntries(request.headers) });
        return resolveRoute(route, request);
      }
    }
    // Unrouted: the local Supabase stack passes through; anything external is a harness bug (H-5).
    const host = new URL(request.url).hostname;
    if (!LOOPBACK_HOSTS.includes(host)) {
      throw new Error(`spyFetch: unrouted non-loopback URL ${request.url} (05 H-5)`);
    }
    return realFetch(input as RequestInfo, init);
  }) as typeof fetch;

  globalThis.fetch = impl;
  const spy: FetchSpy = {
    calls,
    requests,
    fetch: impl,
    restore: () => {
      globalThis.fetch = realFetch;
      if (activeFetchSpy === spy) activeFetchSpy = null;
    },
  };
  activeFetchSpy = spy;
  return spy;
};

let activeLogSpy: LogSpy | null = null;

function parseLine(args: unknown[], into: object[]): void {
  const first = args[0];
  if (typeof first !== 'string') return;
  const text = first.trim();
  if (!text.startsWith('{')) return;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') into.push(parsed as object);
  } catch {
    // not a log line
  }
}

export const spyLog = (): LogSpy => {
  activeLogSpy?.restore();
  const lines: object[] = [];
  const outSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    parseLine(args, lines);
  });
  const errSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    parseLine(args, lines);
  });
  const spy: LogSpy = {
    lines,
    restore: () => {
      outSpy.mockRestore();
      errSpy.mockRestore();
      if (activeLogSpy === spy) activeLogSpy = null;
    },
  };
  activeLogSpy = spy;
  return spy;
};
