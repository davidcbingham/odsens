/**
 * lib/adapters/resend.ts — `createResend` (04 §4.5 export list verbatim: `sendEmail`; 04 SC-09/SC-10/
 * SC-25; §4 rules A1–A5; 05 T-ADP-17, T-ADP-20; ADR-0030 D6/D13).
 *
 * Pure I/O, no DB access (A1). Factory `createResend({fetch, env})` — env is an argument (the caller
 * passes `lib/env.ts`'s `env`); this module reads no environment of its own (SC-25 / T-ADP-20).
 * Construction requires `RESEND_API_KEY` (bearer) and `MODRINTH_USER_AGENT` (SC-10 — the same UA
 * goes to Resend); callers check the optional key BEFORE constructing — no key means recipient rows
 * `failed` / `not_configured` (04 §3.7 N7), never a construction crash in a prod path.
 *
 * ADR-0030 D6: no `resend` npm SDK — `sendEmail` is one `POST ${base}/emails` through `fetchJson`
 * (`https://api.resend.com`; `RESEND_API_BASE` overrides in tests only, ADR-0002 #73). 04 §4.5's
 * `react` parameter is satisfied at the deliverer seam: `lib/notify/deliver/email.ts` renders the
 * React Email template to `html` + `text` first and this adapter sends both (never `react`).
 * From defaults to `odsens <${NOTIFY_FROM_EMAIL}>` (D13); `reply_to` is sent only when the caller
 * passes `replyTo` (04 N5 — not before inbound forwarding exists). `X-Entity-Ref-ID` = the
 * `notification_recipients.id` the deliverer is sending for.
 *
 * Errors: 422 → `AdapterError {code:'rejected'}` (validation — never retried); 429/5xx/network →
 * SC-09 retries inside `fetchJson`, then `http_error`/`network_error`; an unexpected 2xx shape →
 * `parse_error`. The request body (addresses, subject, rendered mail) never reaches an error or log.
 */
import 'server-only';
import { z } from 'zod';
import { AdapterError, fetchJson } from '@/lib/adapters/http';
import type { Env } from '@/lib/env';

/** 04 §4.5 base URL — unit tests assert the real host (05 T-ADP-17); e2e overrides to :4010. */
export const RESEND_API = 'https://api.resend.com';

/** 04 SC-16 default sender address (`NOTIFY_FROM_EMAIL`), repeated here for a partial env. */
export const DEFAULT_FROM_EMAIL = 'allay@odsens.com';

const resendEnvSchema = z.object({
  RESEND_API_KEY: z.string().min(1),
  MODRINTH_USER_AGENT: z.string().min(1),
  NOTIFY_FROM_EMAIL: z.string().min(1).default(DEFAULT_FROM_EMAIL),
  RESEND_API_BASE: z.string().optional(),
});

export type ResendEnv = Partial<
  Pick<Env, 'RESEND_API_KEY' | 'MODRINTH_USER_AGENT' | 'NOTIFY_FROM_EMAIL' | 'RESEND_API_BASE'>
>;

/** 04 §4.5 / 05 T-ADP-17 `sendEmail` input — `html` + `text` are the rendered template (D6). */
export type SendEmailInput = {
  /** One recipient address (an `admin_notify_emails` entry). */
  to: string;
  subject: string;
  /** Rendered HTML — non-empty (the deliverer renders the template before calling). */
  html: string;
  /** Rendered plain-text alternative — non-empty (03 E-01: every mail has one). */
  text: string;
  /** Defaults to `odsens <${NOTIFY_FROM_EMAIL}>` (04 N5). */
  from?: string;
  /** Sent as `reply_to` only when given (04 N5: no Reply-To until inbound forwarding exists). */
  replyTo?: string;
  /** `X-Entity-Ref-ID` = recipient row id (T-ADP-17); other headers pass through. */
  headers: Record<string, string> & { 'X-Entity-Ref-ID': string };
};

/** Resend's `POST /emails` success body — `{ id }` is all the deliverer records. */
const sendResponseSchema = z.object({ id: z.string().min(1) });

export type SendEmailResult = z.infer<typeof sendResponseSchema>;

/** 04 §4.5 factory (SC-25). Throws a zod error naming any missing env key — before any request. */
export function createResend({ fetch: fetchImpl, env }: { fetch?: typeof fetch; env: ResendEnv }) {
  const parsed = resendEnvSchema.parse(env);
  const base = (parsed.RESEND_API_BASE ?? RESEND_API).replace(/\/+$/, '');
  const ua = parsed.MODRINTH_USER_AGENT;
  const authorization = `Bearer ${parsed.RESEND_API_KEY}`;
  const defaultFrom = `odsens <${parsed.NOTIFY_FROM_EMAIL}>`;

  return {
    /**
     * 04 §4.5: `POST /emails` with `Authorization: Bearer <key>` and the T-ADP-17 body
     * `{from, to:[to], subject, html, text, headers, reply_to?}` → `{id}`.
     */
    async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
      const url = `${base}/emails`;
      if (input.html.trim() === '' || input.text.trim() === '') {
        // A blank render is a template bug, not something to hand Resend (05 T-ADP-17: both non-empty).
        throw new AdapterError(`POST ${url} → rejected (html and text must both be non-empty)`, {
          status: 0,
          code: 'rejected',
          body: '',
        });
      }
      const body = {
        from: input.from ?? defaultFrom,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
        headers: input.headers,
        ...(input.replyTo !== undefined ? { reply_to: input.replyTo } : {}),
      };

      let payload: unknown;
      try {
        payload = await fetchJson<unknown>(url, {
          ua,
          method: 'POST',
          body,
          headers: { Authorization: authorization },
          fetch: fetchImpl,
        });
      } catch (error) {
        // 422 = Resend validation error (`resend/422.json`): typed, and `fetchJson` never retried it.
        if (error instanceof AdapterError && error.status === 422) {
          throw new AdapterError(`POST ${url} → rejected (422)`, {
            status: 422,
            code: 'rejected',
            body: error.body,
          });
        }
        throw error;
      }

      const result = sendResponseSchema.safeParse(payload);
      if (!result.success) {
        throw new AdapterError(`POST ${url} → parse_error (unexpected response shape)`, {
          status: 200,
          code: 'parse_error',
          body: JSON.stringify(payload ?? null).slice(0, 300),
        });
      }
      return result.data;
    },
  };
}

export type Resend = ReturnType<typeof createResend>;
