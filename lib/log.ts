/**
 * lib/log.ts — the one structured logger (01 INV-42/INV-43; 04 SC-15; ADR-0002 C16).
 *
 * `log.info | warn | error({ job?, action?, id, msg, meta? })` — exactly one of `job`/`action` is set
 * (`id` = `sync_runs.id` for jobs, `crypto.randomUUID()` request id for actions and route handlers).
 * The helper adds `level` + `ts` (ISO-8601 UTC) and writes ONE JSON line to stdout with the keys
 * `job|action, id, level, msg, meta, ts` (`meta` is always present — `{}` when omitted — so the shape is
 * stable for Vercel log search). This is the only module outside scripts/** and tests/** that may call
 * `console.*`.
 *
 * Redaction (INV-43, T-UNIT-33): `meta` is deep-walked and every value under a sensitive key — and every
 * string value that carries `token=` / `sig=` — becomes the literal '[redacted]'. User references in
 * `meta` are `profile_id` / `handle` only; never email, IP, request bodies, secrets, signed or webhook URLs.
 *
 * A malformed entry (both or neither of `job`/`action`) throws under Vitest / NODE_ENV=test and otherwise
 * emits a `warn` line and continues — logging must never take a request down in production.
 */
import { isTest } from '@/lib/env';

export type LogLevel = 'info' | 'warn' | 'error';

export type LogEntry = {
  job?: string;
  action?: string;
  id: string;
  msg: string;
  meta?: Record<string, unknown>;
};

const REDACTED = '[redacted]';

/** Sensitive keys, compared after lower-casing and stripping `_` / `-` (so `email_hash` == `emailHash`). */
const REDACT_KEYS: ReadonlySet<string> = new Set([
  'email',
  'emailhash',
  'ip',
  'ipaddress',
  'remoteaddr',
  'authorization',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'key',
  'secret',
  'password',
  'cookie',
  'setcookie',
  'webhook',
  'webhookurl',
  'signedurl',
  'body',
  'useragent',
  // Google identity fields (01 INV-43: name/picture never reach logs) — `name` alone stays loggable
  // (job/source names); the identity-specific keys are listed.
  'fullname',
  'givenname',
  'familyname',
  'displayname',
  'picture',
  'avatarurl',
  'phone',
]);

const REDACT_KEY_SUFFIXES = ['secret', 'token', 'key'] as const;

/** String values that embed a credential: `token=`/`sig=` query parameters (signed URLs) or a Discord webhook URL (the path carries the token). */
const REDACT_VALUE_PATTERN = /(?:token|sig)=|discord(?:app)?\.com\/api\/webhooks\//i;

const MAX_DEPTH = 8;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const norm = normalizeKey(key);
  if (REDACT_KEYS.has(norm)) return true;
  return REDACT_KEY_SUFFIXES.some((suffix) => norm.endsWith(suffix));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return REDACT_VALUE_PATTERN.test(value) ? REDACTED : value;
  }
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return '[truncated]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, seen));
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactValue(value.message, depth + 1, seen),
      stack:
        typeof value.stack === 'string' ? redactValue(value.stack, depth + 1, seen) : undefined,
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (!isPlainObject(value)) return String(value);

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactValue(inner, depth + 1, seen);
  }
  return out;
}

/** Deep-walks `meta` (objects + arrays) and returns a redacted copy; the input is never mutated. */
export function redactMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out = redactValue(meta, 0, new WeakSet());
  return isPlainObject(out) ? out : {};
}

type LogLine = {
  job?: string;
  action?: string;
  id: string;
  level: LogLevel;
  msg: string;
  meta: Record<string, unknown>;
  ts: string;
};

function buildLine(level: LogLevel, entry: LogEntry): LogLine {
  const line: LogLine = {
    ...(entry.job !== undefined ? { job: entry.job } : {}),
    ...(entry.action !== undefined ? { action: entry.action } : {}),
    id: entry.id,
    level,
    msg: entry.msg,
    meta: entry.meta ? redactMeta(entry.meta) : {},
    ts: new Date().toISOString(),
  };
  return line;
}

function write(level: LogLevel, line: LogLine): void {
  const text = JSON.stringify(line);
  if (level === 'error') {
    console.error(text);
  } else {
    console.log(text);
  }
}

function emit(level: LogLevel, entry: LogEntry): void {
  const hasJob = entry.job !== undefined;
  const hasAction = entry.action !== undefined;
  if (hasJob === hasAction) {
    const problem = 'log entry must set exactly one of job/action (01 INV-42)';
    if (isTest) throw new Error(problem);
    write(
      'warn',
      buildLine('warn', {
        action: 'log',
        id: entry.id,
        msg: 'malformed_entry',
        meta: { problem, job: entry.job, action: entry.action, original_msg: entry.msg },
      }),
    );
  }
  write(level, buildLine(level, entry));
}

export const log = {
  info: (entry: LogEntry): void => emit('info', entry),
  warn: (entry: LogEntry): void => emit('warn', entry),
  error: (entry: LogEntry): void => emit('error', entry),
} as const;
