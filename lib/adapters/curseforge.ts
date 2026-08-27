/**
 * lib/adapters/curseforge.ts — `createCurseforge` (04 §4.2 export list verbatim; §1.4 `ref` grammar;
 * 04 SC-09/SC-10/SC-25; 05 T-ADP-7/8, T-ADP-20).
 *
 * Pure I/O + mapping, no DB access (04 §4 A1–A3). Factory `createCurseforge({fetch, env})` — env is
 * an argument (the caller passes `lib/env.ts`'s `env`); this module reads no environment of its
 * own (SC-25 / T-ADP-20).
 * Construction requires `CURSEFORGE_API_KEY` (header `x-api-key`) and `MODRINTH_USER_AGENT` (SC-10:
 * the same UA goes to CurseForge); callers check the optional key BEFORE constructing — no key means
 * a skipped run (04 §3.2) or `upstream_error` (§1.4), never a construction crash in prod paths.
 * Base URL `https://api.curseforge.com/v1`; `CURSEFORGE_API_BASE` overrides in tests only
 * (ADR-0002 #73). Quota is key-scoped and unknown → treated as ≥ 60 req/min: calls are strictly
 * sequential (04 §4.2) via an internal promise chain.
 */
import 'server-only';
import { z } from 'zod';
import { AdapterError, fetchJson } from '@/lib/adapters/http';
import type { Env } from '@/lib/env';

/** 04 §4.2 base URL — unit tests assert the real host (05 T-ADP-7); e2e overrides to :4010. */
export const CURSEFORGE_API = 'https://api.curseforge.com/v1';

/** Minecraft's CurseForge game id (04 §4.2 `searchBySlug`). */
const GAME_ID_MINECRAFT = 432;

/** 04 §1.4 `setProjectLink.ref` URL grammar — capture 3 is the slug. */
const CURSEFORGE_URL_RE =
  /^https:\/\/(www\.)?curseforge\.com\/minecraft\/(mc-mods|texture-packs|data-packs|bukkit-plugins|modpacks|shaders)\/([a-z0-9-]+)/;

/** 04 §1.4: digits ref is 1–10 digits. */
const DIGITS_RE = /^\d{1,10}$/;

const curseforgeEnvSchema = z.object({
  CURSEFORGE_API_KEY: z.string().min(1),
  MODRINTH_USER_AGENT: z.string().min(1),
  CURSEFORGE_API_BASE: z.string().optional(),
});

export type CurseforgeEnv = Partial<
  Pick<Env, 'CURSEFORGE_API_KEY' | 'MODRINTH_USER_AGENT' | 'CURSEFORGE_API_BASE'>
>;

/** 04 §4.2 `getMod` result: `{id, slug, downloadCount, links.websiteUrl}`. */
const modSchema = z.object({
  id: z.number(),
  slug: z.string(),
  downloadCount: z.number(),
  links: z.object({ websiteUrl: z.string() }),
});

export type CurseforgeMod = z.infer<typeof modSchema>;

const modResponseSchema = z.object({ data: modSchema });
const searchResponseSchema = z.object({ data: z.array(modSchema) });

/**
 * 04 §1.4: `ref` is either digits → `{id}` or a CurseForge URL → `{slug}`; anything else → `null`
 * (the action fails it as `validation`). Pure (A3) — exported for tests and the schema module.
 */
export function parseRef(ref: string): { id: number } | { slug: string } | null {
  if (DIGITS_RE.test(ref)) return { id: Number(ref) };
  const slug = CURSEFORGE_URL_RE.exec(ref)?.[3];
  return slug !== undefined ? { slug } : null;
}

/** 04 §4.2 factory (SC-25). Throws a zod error naming any missing env key — before any request. */
export function createCurseforge({
  fetch: fetchImpl,
  env,
}: {
  fetch?: typeof fetch;
  env: CurseforgeEnv;
}) {
  const parsed = curseforgeEnvSchema.parse(env);
  const base = parsed.CURSEFORGE_API_BASE ?? CURSEFORGE_API;
  const headers = { 'x-api-key': parsed.CURSEFORGE_API_KEY };
  const ua = parsed.MODRINTH_USER_AGENT;

  /** Sequential-only quota (04 §4.2): each call starts after the previous one settled. */
  let queue: Promise<unknown> = Promise.resolve();
  function sequential<T>(work: () => Promise<T>): Promise<T> {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  }

  function request(url: string): Promise<unknown> {
    return sequential(() => fetchJson<unknown>(url, { ua, headers, fetch: fetchImpl }));
  }

  /** T-ADP-8: a 2xx body that doesn't match the §4.2 shape is a typed `parse_error`. */
  function parseOr<T>(schema: z.ZodType<T>, payload: unknown, url: string): T {
    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new AdapterError(`GET ${url} → parse_error (unexpected response shape)`, {
        status: 200,
        code: 'parse_error',
        body: JSON.stringify(payload).slice(0, 300),
      });
    }
    return result.data;
  }

  return {
    /** 04 §4.2: `GET /mods/{id}` → `{id, slug, downloadCount, links.websiteUrl}`. */
    async getMod(id: number): Promise<CurseforgeMod> {
      const url = `${base}/mods/${id}`;
      return parseOr(modResponseSchema, await request(url), url).data;
    },
    /**
     * 04 §4.2: `GET /mods/search?gameId=432&slug={slug}&pageSize=5` → the first `data[]` entry
     * whose `slug` equals — `null` when none matches (action maps it to `not_found`).
     */
    async searchBySlug(slug: string): Promise<CurseforgeMod | null> {
      const url = `${base}/mods/search?gameId=${GAME_ID_MINECRAFT}&slug=${encodeURIComponent(slug)}&pageSize=5`;
      const { data } = parseOr(searchResponseSchema, await request(url), url);
      return data.find((mod) => mod.slug === slug) ?? null;
    },
    parseRef,
  };
}

export type Curseforge = ReturnType<typeof createCurseforge>;
