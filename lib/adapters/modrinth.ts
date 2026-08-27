/**
 * lib/adapters/modrinth.ts — `createModrinth` (04 §4.1 export list verbatim; §5.2 P1–P5 mapping;
 * §3.1 steps 1–3 shapes; 04 SC-09/SC-10/SC-25; 05 T-ADP-2..6, T-ADP-20; ADR-0002 #77).
 *
 * Pure I/O + mapping, no DB access (04 §4 A1–A3). Factory `createModrinth({fetch, env})` — env is an
 * argument (the caller passes `lib/env.ts`'s `env`); this module reads no environment of its own
 * (SC-25 / T-ADP-20). A missing `MODRINTH_USER_AGENT` fails construction with a zod error (SC-10).
 * Base URL `https://api.modrinth.com/v2`; `MODRINTH_API_BASE` overrides in tests only (ADR-0002 #73).
 *
 * Quota (04 §4.1): 300 req/min; honour `X-Ratelimit-Remaining`/`X-Ratelimit-Reset` — when a response
 * says remaining < 5, the next call sleeps until reset (05 T-ADP-6). The 100 ms call spacing is the
 * job's (`MODRINTH_CALL_SPACING_MS`, 04 §5.8), not the adapter's.
 *
 * Mapping functions are pure module exports (A3) and also returned by the factory so the 04 §4.1
 * function list holds on the instance.
 */
import 'server-only';
import { z } from 'zod';
import { fetchJson, sleep } from '@/lib/adapters/http';
import type { Env } from '@/lib/env';

/** 04 §4.1 base URL — unit tests assert the real host (05 T-ADP-3); e2e overrides to :4010. */
export const MODRINTH_API = 'https://api.modrinth.com/v2';

/** 04 §5.2 constants — verbatim. */
export const PLUGIN_LOADERS = new Set([
  'paper',
  'spigot',
  'bukkit',
  'purpur',
  'folia',
  'velocity',
  'bungeecord',
  'waterfall',
  'sponge',
]);
export const MOD_LOADERS = new Set([
  'fabric',
  'forge',
  'neoforge',
  'quilt',
  'liteloader',
  'rift',
  'modloader',
]);

/** Below this remaining-request count the adapter sleeps until the rate-limit window resets. */
const QUOTA_FLOOR = 5;

const modrinthEnvSchema = z.object({
  MODRINTH_USER_AGENT: z.string().min(1),
  MODRINTH_API_BASE: z.string().optional(),
});

export type ModrinthEnv = Partial<Pick<Env, 'MODRINTH_USER_AGENT' | 'MODRINTH_API_BASE'>>;

// ---- Raw upstream shapes (only the fields the mapping reads) ----

export type ModrinthGalleryItem = {
  url: string;
  featured?: boolean;
  title?: string | null;
  description?: string | null;
  created?: string | null;
  ordering?: number | null;
};

export type ModrinthProject = {
  id: string;
  slug: string;
  project_type: string;
  title: string;
  description: string;
  body?: string | null;
  status?: string;
  icon_url?: string | null;
  gallery?: ModrinthGalleryItem[] | null;
  categories?: string[] | null;
  additional_categories?: string[] | null;
  loaders?: string[] | null;
  game_versions?: string[] | null;
  license?: { id?: string | null } | null;
  source_url?: string | null;
  issues_url?: string | null;
  discord_url?: string | null;
  downloads?: number | null;
  followers?: number | null;
  published?: string | null;
  updated?: string | null;
};

export type ModrinthVersionFile = {
  hashes?: { sha512?: string | null } | null;
  url: string;
  filename: string;
  primary?: boolean;
  size?: number;
};

export type ModrinthVersion = {
  id: string;
  name?: string | null;
  version_number: string;
  changelog?: string | null;
  game_versions?: string[] | null;
  loaders?: string[] | null;
  version_type?: string | null;
  date_published?: string | null;
  downloads?: number | null;
  files?: ModrinthVersionFile[] | null;
};

// ---- Mapped shapes (the 04 §3.1 sync-owned columns; the job adds status/synced_at) ----

/** `projects.project_type` enum values reachable from the §5.2 mapping. */
export type MappedProjectType = 'mod' | 'datapack' | 'resourcepack' | 'plugin';

export type GalleryItem = {
  url: string;
  title: string | null;
  description: string | null;
  ordering: number;
  featured: boolean;
};

export type ProjectRow = {
  external_id: string;
  slug: string;
  /** `null` = P5 skipped type (`modpack`/`shader`/other) — the job counts it in `summary.skipped`. */
  project_type: MappedProjectType | null;
  title: string;
  description: string;
  body_md: string | null;
  icon_url: string | null;
  gallery: GalleryItem[];
  categories: string[];
  loaders: string[];
  game_versions: string[];
  license: string | null;
  source_url: string | null;
  issues_url: string | null;
  discord_url: string | null;
  downloads_modrinth: number;
  followers: number;
  published_at: Date | null;
  external_updated_at: Date | null;
};

export type VersionRow = {
  external_id: string;
  version_number: string;
  name: string | null;
  changelog_md: string | null;
  game_versions: string[];
  loaders: string[];
  version_type: 'release' | 'beta' | 'alpha';
  date_published: Date | null;
  downloads: number;
};

export type VersionFileRow = {
  filename: string;
  size_bytes: number;
  sha512: string | null;
  url: string;
  primary: boolean;
  /** Synced files live on the Modrinth CDN — `storage_path` is always NULL (04 §3.1 step 3). */
  storage_path: null;
};

/** T-ADP-4: missing optional fields land as NULL, never `undefined` or `""`. */
function nullIfEmpty(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value;
}

function dateOrNull(value: string | null | undefined): Date | null {
  return value === undefined || value === null || value === '' ? null : new Date(value);
}

/**
 * 04 §5.2 — evaluated in order, first match wins (P1–P5); loader match is case-insensitive
 * (05 T-ADP-2). Returns `null` for skipped types (P5): not imported, `summary.skipped++`.
 */
export function mapProjectType(
  projectType: string,
  loaders: readonly string[],
): MappedProjectType | null {
  const type = projectType.toLowerCase();
  const lower = loaders.map((loader) => loader.toLowerCase());
  if (type === 'resourcepack') return 'resourcepack'; // P1
  if (type === 'mod') {
    if (lower.length > 0 && lower.every((loader) => loader === 'datapack')) return 'datapack'; // P2
    const plugin = lower.some((loader) => PLUGIN_LOADERS.has(loader));
    const mod = lower.some((loader) => MOD_LOADERS.has(loader));
    if (plugin && !mod) return 'plugin'; // P3
    return 'mod'; // P4 — anything else, incl. fabric+datapack and empty
  }
  return null; // P5 — modpack, shader, other
}

/** 04 §3.1 step 2 / 05 T-ADP-4 field mapping. Gallery sorted by `ordering` then `created`. */
export function mapProject(raw: ModrinthProject): ProjectRow {
  const gallery = [...(raw.gallery ?? [])]
    .sort(
      (a, b) =>
        (a.ordering ?? 0) - (b.ordering ?? 0) || (a.created ?? '').localeCompare(b.created ?? ''),
    )
    .map((item) => ({
      url: item.url,
      title: nullIfEmpty(item.title),
      description: nullIfEmpty(item.description),
      ordering: item.ordering ?? 0,
      featured: item.featured === true,
    }));
  return {
    external_id: raw.id,
    slug: raw.slug,
    project_type: mapProjectType(raw.project_type, raw.loaders ?? []),
    title: raw.title,
    description: raw.description,
    body_md: nullIfEmpty(raw.body),
    icon_url: nullIfEmpty(raw.icon_url),
    gallery,
    categories: [...new Set([...(raw.categories ?? []), ...(raw.additional_categories ?? [])])],
    loaders: raw.loaders ?? [],
    game_versions: raw.game_versions ?? [],
    license: nullIfEmpty(raw.license?.id),
    source_url: nullIfEmpty(raw.source_url),
    issues_url: nullIfEmpty(raw.issues_url),
    discord_url: nullIfEmpty(raw.discord_url),
    downloads_modrinth: raw.downloads ?? 0,
    followers: raw.followers ?? 0,
    published_at: dateOrNull(raw.published),
    external_updated_at: dateOrNull(raw.updated),
  };
}

/**
 * 04 §3.1 step 3 / 05 T-ADP-5. A version keeps exactly one `primary` file — the flagged one, or the
 * first when none is flagged. Unknown `version_type` → `release` (ADR-0002 #77).
 */
export function mapVersion(raw: ModrinthVersion): { version: VersionRow; files: VersionFileRow[] } {
  const rawFiles = raw.files ?? [];
  const flagged = rawFiles.findIndex((file) => file.primary === true);
  const primaryIndex = flagged === -1 ? 0 : flagged;
  const rawType = (raw.version_type ?? '').toLowerCase();
  return {
    version: {
      external_id: raw.id,
      version_number: raw.version_number,
      name: nullIfEmpty(raw.name),
      changelog_md: nullIfEmpty(raw.changelog),
      game_versions: raw.game_versions ?? [],
      loaders: raw.loaders ?? [],
      version_type: rawType === 'beta' || rawType === 'alpha' ? rawType : 'release',
      date_published: dateOrNull(raw.date_published),
      downloads: raw.downloads ?? 0,
    },
    files: rawFiles.map((file, index) => ({
      filename: file.filename,
      size_bytes: file.size ?? 0,
      sha512: file.hashes?.sha512 ?? null,
      url: file.url,
      primary: index === primaryIndex,
      storage_path: null,
    })),
  };
}

/** 04 §4.1 factory (SC-25). Throws a zod error naming any missing env key — before any request. */
export function createModrinth({
  fetch: fetchImpl,
  env,
}: {
  fetch?: typeof fetch;
  env: ModrinthEnv;
}) {
  const parsed = modrinthEnvSchema.parse(env);
  const base = parsed.MODRINTH_API_BASE ?? MODRINTH_API;
  const ua = parsed.MODRINTH_USER_AGENT;

  /** Epoch ms before which no request may leave (quota floor hit — 04 §4.1). */
  let quotaWaitUntil = 0;

  const trackQuota = (response: Response): void => {
    const remainingHeader = response.headers.get('x-ratelimit-remaining');
    const resetHeader = response.headers.get('x-ratelimit-reset');
    if (remainingHeader === null || resetHeader === null) return;
    const remaining = Number(remainingHeader);
    const resetSeconds = Number(resetHeader);
    if (Number.isFinite(remaining) && remaining < QUOTA_FLOOR && resetSeconds > 0) {
      quotaWaitUntil = Date.now() + resetSeconds * 1000;
    }
  };

  async function request<T>(url: string): Promise<T> {
    const wait = quotaWaitUntil - Date.now();
    if (wait > 0) await sleep(wait);
    return fetchJson<T>(url, { ua, fetch: fetchImpl, onResponse: trackQuota });
  }

  return {
    /** 04 §4.1: `GET /user/{user}/projects` — full Project objects (gallery, body, license included). */
    listUserProjects(user: string): Promise<ModrinthProject[]> {
      return request<ModrinthProject[]>(`${base}/user/${encodeURIComponent(user)}/projects`);
    },
    /** 04 §4.1: `GET /project/{id}/version` — raw Version objects, `[]` when none. */
    listVersions(projectId: string): Promise<ModrinthVersion[]> {
      return request<ModrinthVersion[]>(`${base}/project/${encodeURIComponent(projectId)}/version`);
    },
    mapProject,
    mapVersion,
    mapProjectType,
  };
}

export type Modrinth = ReturnType<typeof createModrinth>;
