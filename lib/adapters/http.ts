/**
 * lib/adapters/http.ts — `fetchJson` + `AdapterError`, the one HTTP path for every adapter
 * (04 SC-09 / SC-10; §4 adapter rules A1–A5; 05 T-ADP-1; registry Adapters: `http` (`fetchJson`);
 * ADR-0030 D6 — `method` / `body` for the S1.5 POST adapters).
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
 * - A 2xx with an empty body (Discord 204, or a bare `200`) resolves to `null` instead of a
 *   `parse_error`; callers that expect a body type it as `T | null` or validate the shape.
 * - Every request carries `User-Agent` = the caller's `ua` (= `env.MODRINTH_USER_AGENT`, SC-10 —
 *   also sent to CurseForge/YouTube/OG/Resend/Discord fetches) and `Accept: application/json`.
 * - `fetch` is injectable: factories pass theirs down (SC-25) and unit tests use `mockFetch` (05 H-5).
 *   `onResponse` lets the Modrinth adapter watch quota headers (04 §4.1) and the Discord adapter read
 *   the final status without a second HTTP path.
 * - Error messages and bodies never carry secrets: key-like query params are redacted and request
 *   headers are never echoed (05 T-ADP-1 — no `key=` / `x-api-key` / `Authorization` values).
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

/** Redacts values of key-like query params so no URL secret reaches an error message (T-ADP-1). */
function redactSecrets(text: string): string {
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
 * The SC-09 HTTP call. GET by default; `method: 'POST'` JSON-encodes `body` (ADR-0030 D6). Parses the
 * response as JSON; an empty 2xx body resolves to `null`. Throws `AdapterError` — callers map it to
 * `upstream_error` (actions) or `summary.errors[]` / `sync_runs.error` / recipient `error` (jobs)
 * per 04 §7. The request body never appears in the thrown error.
 */
export async function fetchJson<T = unknown>(url: string, options: FetchJsonOptions): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const retryOn = options.retryOn ?? defaultRetryOn;
  const method: FetchJsonMethod = options.method ?? 'GET';
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const safeUrl = redactSecrets(url);
  const label = `${method} ${safeUrl}`;

  const hasBody = method === 'POST' && options.body !== undefined;
  const encodedBody = hasBody ? JSON.stringify(options.body) : undefined;
  const headers: Record<string, string> = {
    Accept: 'application/json',
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

    if (response.ok) {
      const text = await response.text();
      if (text.trim() === '') return null as T; // 204 / empty 2xx — nothing to parse
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new AdapterError(`${label} → parse_error (invalid JSON)`, {
          status: response.status,
          code: 'parse_error',
          body: text.slice(0, BODY_LIMIT),
        });
      }
    }

    const body = (await response.text().catch(() => '')).slice(0, BODY_LIMIT);
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
