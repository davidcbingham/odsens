/**
 * lib/adapters/discord.ts — `createDiscord` (04 §4.6 export list verbatim: `postEmbed`; §1.3 webhook
 * URL regex; §3.7 N6 colours; 04 SC-09/SC-10/SC-25; §4 rules A1–A5; 05 T-ADP-18, T-ADP-20;
 * ADR-0030 D6/D9; DESIGN.md §12.1 "Discord embed").
 *
 * Pure I/O, no DB access (A1). Factory `createDiscord({fetch, env})` — env is an argument (the caller
 * passes `lib/env.ts`'s `env`); this module reads no environment of its own (SC-25 / T-ADP-20).
 * Construction requires only `MODRINTH_USER_AGENT` (SC-10); the webhook URL is passed per call (the
 * recipient row's `address`, or the URL under test) and IS the secret (04 §4.6): it never appears in
 * a thrown message, an `AdapterError.body`, or a log line — this module logs nothing, and every error
 * it throws names the webhook as `…<last 4>` (`maskSecret` from `lib/format/secret.ts` — ADR-0030 D12;
 * `maskWebhookUrl` is that function under the name 04 §4.6 / the registry list).
 *
 * `postEmbed(url, {title, description, url?, color, fields?})` → `POST <url>?wait=true` with body
 * `{username:'allay', embeds:[{title, description, url, color, timestamp}]}` → `{status}`.
 * `avatar_url` is omitted until the allay asset exists (04 N6 / Q44 — the key is absent, not null).
 * When `DISCORD_API_BASE` is set (tests only, ADR-0002 #73 / ADR-0030 D6) the
 * `https://discord.com/api` / `https://discordapp.com/api` prefix is rewritten to it, so the e2e
 * fixture server answers `POST /discord/webhooks/<id>/<token>` (ADR-0030 D8).
 *
 * Retry: 429 → read the body's `retry_after` (milliseconds per 04 §4.6 / T-ADP-18 — ADR-0030 D9
 * records that live Discord sends seconds; follow-up, not a deviation), wait, retry ONCE, then throw
 * `http_error` 429; 5xx/network → SC-09 retries inside `fetchJson`; other 4xx → `http_error`, no retry.
 * A 200 (with `?wait=true`, the message object) and a 204 both resolve to `{status}`.
 */
import 'server-only';
import { z } from 'zod';
import { AdapterError, fetchJson, sleep } from '@/lib/adapters/http';
import type { Env } from '@/lib/env';
import { maskSecret } from '@/lib/format/secret';

/** 04 §3.7 N6 / 05 T-ADP-18 colour bars — the DESIGN.md tokens as Discord integers (indigo 4933078 · gold 16762399 · alert 13384234). */
export const DISCORD_COLORS = {
  indigo: 0x4b45d6,
  gold: 0xffc61f,
  alert: 0xcc3a2a,
} as const;

export type DiscordColor = (typeof DISCORD_COLORS)[keyof typeof DISCORD_COLORS];

/** 04 §1.3 `discord_webhook_url` grammar — shared with `lib/actions/settings.schema.ts` (no trim, https only). */
export const discordWebhookUrlPattern =
  /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;

/** The 04 §4.6 bot name — the webhook posts as the allay (docs/notifications.md §Character). */
export const DISCORD_USERNAME = 'allay';

/** Wait used when a 429 body carries no usable `retry_after` (and no `Retry-After` header). */
const DEFAULT_RETRY_AFTER_MS = 1_000;
/** SC-09 ceiling for any honoured wait. */
const MAX_RETRY_AFTER_MS = 30_000;

const discordEnvSchema = z.object({
  MODRINTH_USER_AGENT: z.string().min(1),
  DISCORD_API_BASE: z.string().optional(),
});

export type DiscordEnv = Partial<Pick<Env, 'MODRINTH_USER_AGENT' | 'DISCORD_API_BASE'>>;

/** 04 §4.6 `postEmbed` input — the deliverer supplies `'<Event> — <target title>'` + excerpt(200). */
export type DiscordEmbedInput = {
  title: string;
  description: string;
  /** Link target (the "View" click on the title). */
  url?: string;
  /** One of `DISCORD_COLORS` (04 N6: indigo default · gold held/reported · alert sync.*). */
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
};

export type PostEmbedResult = { status: number };

/**
 * `…<last 4>` — the one way a webhook URL may be written anywhere (UI, logs, errors). A thin alias of
 * `lib/format/secret.ts` `maskSecret` (ADR-0030 D12 — one implementation of the rule); kept under the
 * 04 §4.6 / registry name. Empty → `NOT SET`; shorter than 4 → `…` + all.
 */
export const maskWebhookUrl: typeof maskSecret = maskSecret;

/**
 * Rewrites the Discord API prefix to `base` when set (tests only); every other URL is returned as is.
 * Pure (A3) — exported for T-ADP-18.
 */
export function rewriteDiscordBase(url: string, base: string | undefined): string {
  if (base === undefined || base === '') return url;
  return url.replace(/^https:\/\/(?:discord|discordapp)\.com\/api(?=\/)/, base.replace(/\/+$/, ''));
}

/** `retry_after` from a Discord 429 body (ms per 04 §4.6); `null` when absent or not a finite number. */
function retryAfterFromBody(body: string): number | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed !== null && typeof parsed === 'object' && 'retry_after' in parsed) {
      const value = (parsed as { retry_after: unknown }).retry_after;
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
    }
  } catch {
    // not JSON — fall through
  }
  return null;
}

/** 04 §4.6 factory (SC-25). Throws a zod error naming any missing env key — before any request. */
export function createDiscord({
  fetch: fetchImpl,
  env,
}: {
  fetch?: typeof fetch;
  env: DiscordEnv;
}) {
  const parsed = discordEnvSchema.parse(env);
  const ua = parsed.MODRINTH_USER_AGENT;
  const base = parsed.DISCORD_API_BASE;

  /** Re-throws anything from `fetchJson` with the webhook replaced by its mask (URL never leaks). */
  function masked(error: unknown, mask: string, secrets: string[]): never {
    const scrub = (text: string): string =>
      secrets.reduce((acc, secret) => (secret === '' ? acc : acc.split(secret).join(mask)), text);
    if (error instanceof AdapterError) {
      const tail = error.message.includes('→')
        ? error.message.slice(error.message.indexOf('→'))
        : '';
      throw new AdapterError(`POST discord webhook ${mask} ${scrub(tail)}`.trimEnd(), {
        status: error.status,
        code: error.code,
        body: scrub(error.body),
      });
    }
    throw new AdapterError(`POST discord webhook ${mask} → network_error`, {
      status: 0,
      code: 'network_error',
      body: '',
    });
  }

  return {
    /**
     * 04 §4.6: `POST <url>?wait=true` → `{status}`. 429 → `retry_after` once (T-ADP-18); the URL never
     * appears in the thrown error.
     */
    async postEmbed(webhookUrl: string, embed: DiscordEmbedInput): Promise<PostEmbedResult> {
      const mask = maskWebhookUrl(webhookUrl);
      if (!discordWebhookUrlPattern.test(webhookUrl)) {
        throw new AdapterError(`POST discord webhook ${mask} → unsupported (not a webhook URL)`, {
          status: 0,
          code: 'unsupported',
          body: '',
        });
      }
      const target = rewriteDiscordBase(webhookUrl, base);
      const token = webhookUrl.slice(webhookUrl.lastIndexOf('/') + 1);
      const secrets = [webhookUrl, target, token];
      const requestUrl = `${target}?wait=true`;
      const body = {
        username: DISCORD_USERNAME,
        embeds: [
          {
            title: embed.title,
            description: embed.description,
            ...(embed.url !== undefined ? { url: embed.url } : {}),
            color: embed.color,
            timestamp: new Date().toISOString(),
            ...(embed.fields !== undefined ? { fields: embed.fields } : {}),
          },
        ],
      };

      let lastStatus = 0;
      let lastRetryAfterHeader: string | null = null;
      const post = (): Promise<unknown> =>
        fetchJson<unknown>(requestUrl, {
          ua,
          method: 'POST',
          body,
          fetch: fetchImpl,
          // 429 is this module's rule (retry_after once); 5xx/network keep the SC-09 retries.
          retryOn: (status) => status >= 500,
          onResponse: (response) => {
            lastStatus = response.status;
            lastRetryAfterHeader = response.headers.get('retry-after');
          },
        });

      try {
        await post();
        return { status: lastStatus };
      } catch (first) {
        if (!(first instanceof AdapterError) || first.status !== 429) masked(first, mask, secrets);
        const headerSeconds = Number(lastRetryAfterHeader ?? Number.NaN);
        const wait =
          retryAfterFromBody(first.body) ??
          (Number.isFinite(headerSeconds) && headerSeconds > 0
            ? headerSeconds * 1000
            : DEFAULT_RETRY_AFTER_MS);
        await sleep(Math.min(wait, MAX_RETRY_AFTER_MS));
        try {
          await post();
          return { status: lastStatus };
        } catch (second) {
          masked(second, mask, secrets);
        }
      }
    },
  };
}

export type Discord = ReturnType<typeof createDiscord>;
