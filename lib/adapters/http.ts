/**
 * lib/adapters/http.ts — `fetchJson` / `fetchText` / `fetchPage` + `AdapterError`, the one HTTP path
 * for every adapter (04 SC-09 / SC-10; §4 adapter rules A1–A5; 05 T-ADP-1; registry Adapters: `http`
 * (`fetchJson`, `fetchText`, `fetchPage`); ADR-0030 D6 — `method` / `body` for the S1.5 POST
 * adapters; ADR-0043 D3 — `fetchText`, the same loop for a non-JSON body: the YouTube RSS feed is
 * Atom XML; ADR-0045 — `fetchPage`, the same loop for a page somebody else chose: the S1.8 Open
 * Graph read, 04 §4.4).
 *
 * All three exports run ONE request loop (`requestBody`) — everything below holds for each:
 *
 * - `AbortSignal.timeout(10000)` on every attempt (10 s — SC-09).
 * - Retries HTTP 429/5xx and network errors with backoff 1 s → 2 s → 4 s, honouring `Retry-After` /
 *   `X-Ratelimit-Reset` (seconds) when larger, capped at 30 s; max 3 retries. 4xx other than 429 is
 *   never retried. Final failure throws `AdapterError {status, code, body}` with the upstream body
 *   truncated to 300 chars (A4). `retryOn` narrows the retried status set for a caller with its own
 *   rule (Discord's `retry_after` once, 04 §4.6) — the SC-09 default is unchanged.
 * - `method` defaults to GET. `method: 'POST'` sends `JSON.stringify(body)` with
 *   `Content-Type: application/json` (ADR-0030 D6). Request bodies are NEVER echoed into an error
 *   message, `AdapterError.body`, or any log line — only the redacted URL and the upstream body are.
 * - `fetchJson`: a 2xx with an empty body (Discord 204, or a bare `200`) resolves to `null` instead
 *   of a `parse_error`; callers that expect a body type it as `T | null` or validate the shape.
 * - `fetchText` (ADR-0043 D3): GET only; resolves to the 2xx body verbatim (an empty body is `''`)
 *   and NEVER looks at the response `Content-Type` — the caller owns the parse and its
 *   `parse_error` (the e2e fixture paths and `spyFetch` serve `rss.xml` with a JSON content type).
 * - `fetchPage` (ADR-0045): GET only, for a URL the adapter does not own (`lib/adapters/oembed.ts`).
 *   Resolves to `{status, location, contentType, text}` instead of a bare string, and is where three
 *   OPT-IN guards live — each is off unless the caller sets it, so `fetchJson` / `fetchText` calls
 *   send the same request and read the body the same way as before:
 *   `redirect: 'manual'` — a 301/302/303/307/308 is RETURNED (status + raw `Location`, body
 *   discarded) and never followed, so the caller can re-check every hop (the default transport
 *   follows up to 20 hops on its own); `contentTypes` — a 2xx whose media type is not listed throws
 *   `unsupported` with the body unread; `maxBytes` — a `Content-Length` over the cap throws
 *   `unsupported` before the read, otherwise the body is streamed and cut off the moment the DECODED
 *   byte count passes the cap (the transport hands over decompressed bytes, so a compressed bomb is
 *   bounded too), and a 4xx / 5xx body is read only as far as its 300-character excerpt needs
 *   (`min(maxBytes, 1200)` decoded bytes, the rest cancelled — ADR-0046; without `maxBytes` an
 *   error body is still read whole). `unsupported` is thrown, never retried. `fetchText` given `redirect: 'manual'`
 *   reports the redirect as an `http_error` — it has no way to return one.
 * - Every request carries `User-Agent` = the caller's `ua` (= `env.MODRINTH_USER_AGENT`, SC-10 —
 *   also sent to CurseForge/YouTube/OG/Resend/Discord fetches) and an `Accept` header:
 *   `application/json` from `fetchJson`, the caller's `accept` (default any type) from `fetchText`
 *   and `fetchPage`.
 * - `fetch` is injectable: factories pass theirs down (SC-25) and unit tests use `mockFetch` (05 H-5).
 *   `onResponse` lets the Modrinth adapter watch quota headers (04 §4.1) and the Discord adapter read
 *   the final status without a second HTTP path.
 * - Error messages and bodies never carry secrets: key-like query params are redacted — in the URL
 *   label, in a network-error string and in an echoed upstream body (before it is truncated) — and
 *   request headers are never echoed (05 T-ADP-1 — no `key=` / `x-api-key` / `Authorization` values).
 */
import 'server-only';

/** SC-09 binding defaults. */
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 3;
/** Backoff after the 1st/2nd/3rd failed attempt (SC-09: 1 s → 2 s → 4 s). */
const BACKOFF_MS = [1_000, 2_000, 4_000] as const;
/** Ceiling for any honoured `Retry-After` / `X-Ratelimit-Reset` wait (SC-09: capped at 30 s). */
const MAX_DELAY_MS = 30_000;
/** A4: raw upstream error bodies are truncated before storage/logging. */
const BODY_LIMIT = 300;
/**
 * How much of a non-2xx body is READ for that excerpt when the caller set `maxBytes` (ADR-0046):
 * 300 characters are at most 1,200 UTF-8 bytes. Without `maxBytes` the body is read whole, as ever.
 */
const EXCERPT_BYTES = BODY_LIMIT * 4;
/** The statuses `redirect: 'manual'` hands back; any other 3xx (300, 304, 305) stays an `http_error`. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Failure taxonomy across adapters: `http_error`/`network_error`/`parse_error` from this module;
 * `not_found`/`rejected`/`unsupported` are thrown by the per-adapter modules (04 §4.3–§4.6,
 * 05 T-ADP-15/16/17) so the union lives here with the class.
 */
export type AdapterErrorCode =
  'http_error' | 'network_error' | 'parse_error' | 'not_found' | 'rejected' | 'unsupported';

/** SC-09: `AdapterError {status, code, body(≤300)}`. `status` is 0 when no response arrived. */
export class AdapterError extends Error {
  readonly status: number;
  readonly code: AdapterErrorCode;
  readonly body: string;

  constructor(message: string, details: { status: number; code: AdapterErrorCode; body: string }) {
    super(message);
    this.name = 'AdapterError';
    this.status = details.status;
    this.code = details.code;
    this.body = details.body.slice(0, BODY_LIMIT);
  }
}

export type FetchJsonMethod = 'GET' | 'POST';

export type FetchJsonOptions = {
  /** Per-attempt timeout (SC-09 default 10 s). */
  timeoutMs?: number;
  /** Retries after the first attempt (SC-09 default 3 → at most 4 attempts). */
  retries?: number;
  /**
   * Which HTTP statuses are retried at all (SC-09 default: 429 and every 5xx). Narrow it when the
   * caller owns a status's rule (Discord 429 → `retry_after` once, 04 §4.6); never widen to other 4xx.
   */
  retryOn?: (status: number) => boolean;
  /** HTTP method — GET (default) or POST (ADR-0030 D6). */
  method?: FetchJsonMethod;
  /** POST payload, JSON-encoded with `Content-Type: application/json`. Ignored for GET. */
  body?: unknown;
  /** SC-10: `env.MODRINTH_USER_AGENT` — required on every outbound call. */
  ua: string;
  /** Extra request headers (e.g. CurseForge `x-api-key`, Resend `Authorization`). Never echoed into errors. */
  headers?: Record<string, string>;
  /** Injectable transport (SC-25 / 05 H-5). Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Observes every received response (any status) — Modrinth quota headers (04 §4.1), Discord status. */
  onResponse?: (response: Response) => void;
};

/**
 * `fetchText` / `fetchPage` options (ADR-0043 D3): the SC-09 knobs of `fetchJson` without `method` /
 * `body` — a text read is always a GET. The last three are the opt-in `fetchPage` guards
 * (ADR-0045); left unset, nothing about the request or the read changes.
 */
export type FetchTextOptions = Omit<FetchJsonOptions, 'method' | 'body'> & {
  /** `Accept` request header. Defaults to any type — the body is returned verbatim either way. */
  accept?: string;
  /**
   * `'manual'` → a 301/302/303/307/308 is RETURNED (`status` + `location`), never followed.
   * Default: the transport follows redirects (unchanged).
   */
  redirect?: 'follow' | 'manual';
  /**
   * Stop after this many DECODED body bytes → `AdapterError 'unsupported'`; a non-2xx body is then
   * read only as far as its excerpt needs (≤ `min(maxBytes, 1200)` bytes — ADR-0046). Default:
   * unbounded (unchanged).
   */
  maxBytes?: number;
  /**
   * Lower-case media types a 2xx may carry (`text/html`). Anything else — a missing header
   * included — → `AdapterError 'unsupported'` with the body NOT read. Default: not checked (unchanged).
   */
  contentTypes?: readonly string[];
};

/** `fetchPage` result. `status` is 2xx, or a redirect status when `redirect: 'manual'`. */
export type FetchedPage = {
  status: number;
  /** Raw `Location` header of a manual redirect (may be relative, may be absent); `null` on a 2xx. */
  location: string | null;
  /** Lower-cased media type without parameters (`text/html`); `null` when absent or on a redirect. */
  contentType: string | null;
  /** The 2xx body (`''` on a redirect or an empty body). */
  text: string;
};

/** `setTimeout` promise — fake-timer friendly; shared with the adapters' quota waits. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** SC-09 default retry set: 429 and every 5xx. */
function defaultRetryOn(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Redacts values of key-like query params so no URL secret reaches an error message (T-ADP-1).
 * Exported for the adapters that build their own `parse_error` label from a keyed URL (YouTube
 * `key=` — 04 §4.3).
 */
export function redactSecrets(text: string): string {
  return text.replace(
    /([?&](?:api[-_]?key|key|token|secret|sig|authorization)=)[^&\s"']*/gi,
    '$1[redacted]',
  );
}

/**
 * Wait derived from `Retry-After` (seconds or HTTP-date) / `X-Ratelimit-Reset` (seconds) — the
 * larger of the two when both are present; `null` when neither header is set.
 */
function headerDelayMs(response: Response): number | null {
  let delay: number | null = null;
  const consider = (ms: number): void => {
    if (Number.isFinite(ms) && ms > 0) delay = Math.max(delay ?? 0, ms);
  };
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) consider(seconds * 1000);
    else consider(new Date(retryAfter).getTime() - Date.now());
  }
  const reset = response.headers.get('x-ratelimit-reset');
  if (reset !== null) consider(Number(reset) * 1000);
  return delay;
}

/**
 * What the shared loop hands back: the raw body plus the pieces a parse error names. `status` is
 * 2xx, or a redirect status under `redirect: 'manual'`. `headers` is the response's own object,
 * passed along untouched — only `fetchPage` reads it.
 */
type ReceivedBody = { status: number; text: string; label: string; headers: Headers };

/** Everything the loop understands: the `fetchJson` options plus the opt-in `fetchPage` guards. */
type RequestOptions = FetchJsonOptions &
  Pick<FetchTextOptions, 'redirect' | 'maxBytes' | 'contentTypes'>;

/** Lower-cased media type without parameters (`Text/HTML; charset=utf-8` → `text/html`), or `null`. */
function mediaType(headers: Headers): string | null {
  const type = (headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
  return type === undefined || type === '' ? null : type;
}

/** Lets go of a body nobody will read, so the connection is released; never throws. */
async function discardBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

/**
 * `maxBytes` read: refuses a declared `Content-Length` over the cap before reading, otherwise
 * streams the body and stops the moment the decoded byte count passes the cap → `unsupported`.
 * UTF-8, like `Response#text()`. A read that dies half-way (timeout, reset) is a typed
 * `network_error`, so a caller that maps `AdapterError` never sees a bare stream error.
 */
async function readCapped(response: Response, maxBytes: number, label: string): Promise<string> {
  const tooLarge = (): AdapterError =>
    new AdapterError(`${label} → unsupported (body over ${String(maxBytes)} bytes)`, {
      status: response.status,
      code: 'unsupported',
      body: '',
    });
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discardBody(response);
    throw tooLarge();
  }
  if (response.body === null) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
  } catch (error) {
    if (error instanceof AdapterError) throw error;
    throw new AdapterError(`${label} → network_error (${redactSecrets(String(error))})`, {
      status: 0,
      code: 'network_error',
      body: '',
    });
  }
  return text + decoder.decode();
}

/**
 * The excerpt source of a non-2xx body (`AdapterError.body`, ≤ 300 chars after redaction). With no
 * `maxBytes` the body is read whole, as it always was; with one (ADR-0046 — `fetchPage` reading a
 * page the adapter does not own) at most `min(maxBytes, EXCERPT_BYTES)` DECODED bytes are read and
 * the rest is cancelled — never thrown over: the status is the error, the body only illustrates it.
 * A read that fails yields `''`, like the uncapped `.text().catch(() => '')`.
 */
async function readExcerpt(response: Response, maxBytes: number | undefined): Promise<string> {
  if (maxBytes === undefined) return response.text().catch(() => '');
  if (response.body === null) return '';
  const limit = Math.min(maxBytes, EXCERPT_BYTES);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      const part = value.byteLength > limit - total ? value.subarray(0, limit - total) : value;
      total += part.byteLength;
      text += decoder.decode(part, { stream: true });
    }
    await reader.cancel().catch(() => undefined);
  } catch {
    return '';
  }
  return text + decoder.decode();
}

/**
 * The one SC-09 request loop behind `fetchJson`, `fetchText` and `fetchPage` (ADR-0043 D3): timeout
 * per attempt, retry/backoff, `Retry-After` / `X-Ratelimit-Reset`, SC-10 User-Agent, `onResponse`,
 * redaction. Resolves with the 2xx body as text and — unless the caller opted into `contentTypes` —
 * never inspects the response `Content-Type`; throws `AdapterError` on the final failure.
 */
async function requestBody(
  url: string,
  options: RequestOptions,
  accept: string,
): Promise<ReceivedBody> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryOn = options.retryOn ?? defaultRetryOn;
  const method: FetchJsonMethod = options.method ?? 'GET';
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const manualRedirect = options.redirect === 'manual';
  const safeUrl = redactSecrets(url);
  const label = `${method} ${safeUrl}`;

  const hasBody = method === 'POST' && options.body !== undefined;
  const encodedBody = hasBody ? JSON.stringify(options.body) : undefined;
  const headers: Record<string, string> = {
    Accept: accept,
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
    ...options.headers,
    'User-Agent': options.ua,
  };

  let lastError: AdapterError | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        ...(encodedBody !== undefined ? { body: encodedBody } : {}),
        // Only ever set when asked for — every other call's init object is what it always was.
        ...(manualRedirect ? { redirect: 'manual' as const } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      // Network error / timeout — no response, no headers: plain backoff only.
      lastError = new AdapterError(`${label} → network_error (${redactSecrets(String(error))})`, {
        status: 0,
        code: 'network_error',
        body: '',
      });
      if (attempt < retries) {
        await sleep(BACKOFF_MS[Math.min(attempt, 2)] ?? MAX_DELAY_MS);
        continue;
      }
      throw lastError;
    }

    options.onResponse?.(response);

    const { status, headers: responseHeaders } = response;

    // `redirect: 'manual'` — hand the hop back unfollowed; its body is never read.
    if (manualRedirect && REDIRECT_STATUSES.has(status)) {
      await discardBody(response);
      return { status, text: '', label, headers: responseHeaders };
    }

    if (response.ok) {
      if (options.contentTypes !== undefined) {
        const type = mediaType(responseHeaders);
        if (type === null || !options.contentTypes.includes(type)) {
          await discardBody(response);
          // Thrown, not assigned to `lastError`: a wrong media type is never retried.
          throw new AdapterError(`${label} → unsupported (content type)`, {
            status,
            code: 'unsupported',
            body: '',
          });
        }
      }
      const text =
        options.maxBytes === undefined
          ? await response.text()
          : await readCapped(response, options.maxBytes, label);
      return { status, text, label, headers: responseHeaders };
    }

    // Redacted BEFORE truncation: an upstream that echoes the request URL never leaks a key tail.
    // Under `maxBytes` the read itself is bounded (ADR-0046); the regex redacts a value cut short.
    const body = redactSecrets(await readExcerpt(response, options.maxBytes)).slice(0, BODY_LIMIT);
    lastError = new AdapterError(`${label} → ${response.status}`, {
      status: response.status,
      code: 'http_error',
      body,
    });
    const retryable = defaultRetryOn(response.status) && retryOn(response.status);
    if (!retryable || attempt >= retries) throw lastError;

    const backoff = BACKOFF_MS[Math.min(attempt, 2)] ?? MAX_DELAY_MS;
    await sleep(Math.min(Math.max(backoff, headerDelayMs(response) ?? 0), MAX_DELAY_MS));
  }
  // Unreachable: every loop path returns or throws.
  throw (
    lastError ??
    new AdapterError(`${label} → network_error`, {
      status: 0,
      code: 'network_error',
      body: '',
    })
  );
}

/**
 * The SC-09 HTTP call. GET by default; `method: 'POST'` JSON-encodes `body` (ADR-0030 D6). Parses the
 * response as JSON; an empty 2xx body resolves to `null`. Throws `AdapterError` — callers map it to
 * `upstream_error` (actions) or `summary.errors[]` / `sync_runs.error` / recipient `error` (jobs)
 * per 04 §7. The request body never appears in the thrown error.
 */
export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions): Promise<T> {
  const { status, text, label } = await requestBody(url, options, 'application/json');
  if (text.trim() === '') return null as T; // 204 / empty 2xx — nothing to parse
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AdapterError(`${label} → parse_error (invalid JSON)`, {
      status,
      code: 'parse_error',
      body: redactSecrets(text).slice(0, BODY_LIMIT),
    });
  }
}

/**
 * The SC-09 HTTP call for a non-JSON body (ADR-0043 D3 — YouTube's Atom feed, 04 §4.3 `fetchRss`).
 * GET only; same timeout / retry / backoff / User-Agent / redaction as `fetchJson` (one loop).
 * Resolves with the 2xx body verbatim whatever `Content-Type` the server sent; the caller parses it
 * and throws its own typed `parse_error`.
 */
export async function fetchText(url: string, options: FetchTextOptions): Promise<string> {
  const { accept, ...rest } = options;
  const { status, text, label } = await requestBody(
    url,
    { ...rest, method: 'GET' },
    accept ?? '*/*',
  );
  // Only reachable under `redirect: 'manual'`: a string cannot carry a redirect, and `''` would
  // read as an empty page — so it is the `http_error` any other non-2xx is.
  if (status >= 300) {
    throw new AdapterError(`${label} → ${String(status)}`, {
      status,
      code: 'http_error',
      body: '',
    });
  }
  return text;
}

/**
 * The SC-09 HTTP call for a page the adapter does not own (ADR-0045 — the Open Graph read of
 * `lib/adapters/oembed.ts`, 04 §4.4). GET only, the same loop as `fetchJson` / `fetchText`; resolves
 * with the status, the media type and the body, and — under `redirect: 'manual'` — with a redirect's
 * status and raw `Location` instead of following it. `maxBytes` / `contentTypes` refuse a body that
 * is too large or of the wrong kind with a typed `unsupported` (see `FetchTextOptions`). The SSRF
 * rules are NOT here: the caller checks the URL before this call and every `location` after it.
 */
export async function fetchPage(url: string, options: FetchTextOptions): Promise<FetchedPage> {
  const { accept, ...rest } = options;
  const { status, text, headers } = await requestBody(
    url,
    { ...rest, method: 'GET' },
    accept ?? '*/*',
  );
  const redirected = status >= 300;
  return {
    status,
    location: redirected ? headers.get('location') : null,
    contentType: redirected ? null : mediaType(headers),
    text,
  };
}
