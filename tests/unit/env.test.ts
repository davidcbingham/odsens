/**
 * tests/unit/env.test.ts — T-UNIT-16: `lib/env.ts` schema (04 SC-16; 01 INV-36; ADR-0002 #18 / A14;
 * ADR-0010 integration key-name aliases; ADR-0012 HASH_SECRET boot-required from S1.1).
 * Exercises the pure `parseEnv(source)` with a hand-built source — never `.env` or real values.
 * `server-only` is mocked by tests/helpers/setup.unit.ts; `.env.test` names are already in
 * `process.env` there, which is what lets `import '@/lib/env'` succeed at module load.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { envSchema, parseEnv } from '@/lib/env';

const BOOT_REQUIRED = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'CRON_SECRET',
  'MODRINTH_USER',
  'MODRINTH_USER_AGENT',
  'YOUTUBE_CHANNEL_ID',
  'HASH_SECRET', // S1.1: ≥ 32 chars (ADR-0012)
] as const;

const OPTIONAL = [
  'YOUTUBE_API_KEY',
  'CURSEFORGE_API_KEY',
  'KOFI_PAGE',
  'RESEND_API_KEY',
  'NOTIFY_FROM_EMAIL',
  'DISCORD_WEBHOOK_URL',
  'SENTRY_DSN',
  'NEXT_PUBLIC_SENTRY_DSN',
  'E2E',
  'MODRINTH_API_BASE',
  'CURSEFORGE_API_BASE',
  'YOUTUBE_API_BASE',
  'YOUTUBE_RSS_BASE',
  'OEMBED_BASE',
  'DISCORD_API_BASE',
  'RESEND_API_BASE',
] as const;

/** Names that are deliberately NOT schema keys (01 §7 "CLI only", P2, removed). */
const NOT_SCHEMA_KEYS = [
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'GOOGLE_OAUTH_CLIENT_ID',
  'GOOGLE_OAUTH_CLIENT_SECRET',
  'CURSEFORGE_MEMBER',
  'KOFI_WEBHOOK_VERIFICATION_TOKEN',
  'VERCEL_ENV',
  'VERCEL_URL',
  'VERCEL_BRANCH_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', // alias source only (ADR-0010) — canonical names stay the keys
  'SUPABASE_SECRET_KEY',
] as const;

/** A complete, valid, obviously fake source (every value is a placeholder). */
function validSource(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-placeholder',
    SUPABASE_SERVICE_ROLE_KEY: 'service-placeholder',
    NEXT_PUBLIC_SITE_URL: 'http://localhost:3000',
    CRON_SECRET: 'cron-placeholder',
    MODRINTH_USER: 'OddSense',
    MODRINTH_USER_AGENT: 'odsens.com/test (localhost)',
    YOUTUBE_CHANNEL_ID: 'UCseedchannel000000000000',
    YOUTUBE_API_KEY: 'yt-placeholder',
    CURSEFORGE_API_KEY: 'cf-placeholder',
    KOFI_PAGE: 'odsens',
    RESEND_API_KEY: 're_placeholder',
    NOTIFY_FROM_EMAIL: 'allay@odsens.com',
    DISCORD_WEBHOOK_URL: 'http://127.0.0.1:4010/discord/webhook',
    HASH_SECRET: 'hash-placeholder-0123456789abcdef0123456789abcdef',
    SENTRY_DSN: 'http://127.0.0.1:4010/sentry',
    NEXT_PUBLIC_SENTRY_DSN: 'http://127.0.0.1:4010/sentry',
    E2E: '1',
    MODRINTH_API_BASE: 'http://127.0.0.1:4010/modrinth',
    CURSEFORGE_API_BASE: 'http://127.0.0.1:4010/curseforge',
    YOUTUBE_API_BASE: 'http://127.0.0.1:4010/youtube',
    YOUTUBE_RSS_BASE: 'http://127.0.0.1:4010/youtube-rss',
    OEMBED_BASE: 'http://127.0.0.1:4010/oembed',
    DISCORD_API_BASE: 'http://127.0.0.1:4010/discord',
    RESEND_API_BASE: 'http://127.0.0.1:4010/resend',
  };
}

describe('lib/env.ts parseEnv (T-UNIT-16)', () => {
  it('T-UNIT-16 a full valid source parses', () => {
    const env = parseEnv(validSource());
    expect(env.NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3000');
    expect(env.MODRINTH_USER).toBe('OddSense');
    expect(env.E2E).toBe('1');
  });

  it.each(BOOT_REQUIRED)('T-UNIT-16 removing %s throws and names it', (name) => {
    const source = validSource();
    delete source[name];
    expect(() => parseEnv(source)).toThrow(/^Missing required environment variables: /);
    expect(() => parseEnv(source)).toThrow(name);
  });

  it.each(BOOT_REQUIRED)('T-UNIT-16 blank %s counts as missing', (name) => {
    const source = validSource();
    source[name] = '';
    expect(() => parseEnv(source)).toThrow(name);
    source[name] = '   ';
    expect(() => parseEnv(source)).toThrow(name);
  });

  it('T-UNIT-16 the boot-required set is exactly the 9 names (ADR-0002 #18 + ADR-0012)', () => {
    const throwing = Object.keys(envSchema.shape).filter((key) => {
      const source = validSource();
      source[key] = '';
      try {
        parseEnv(source);
        return false;
      } catch {
        return true;
      }
    });
    expect(throwing.sort()).toEqual([...BOOT_REQUIRED].sort());
  });

  it('T-UNIT-16 the message lists every missing name at once', () => {
    const source = validSource();
    delete source.CRON_SECRET;
    source.YOUTUBE_CHANNEL_ID = '';
    expect(() => parseEnv(source)).toThrow(
      'Missing required environment variables: CRON_SECRET, YOUTUBE_CHANNEL_ID',
    );
  });

  it('T-UNIT-16 all 9 set + every optional blank → ok (optional never crashes)', () => {
    const source = validSource();
    for (const name of OPTIONAL) source[name] = '';
    const env = parseEnv(source);
    expect(env.YOUTUBE_API_KEY).toBeUndefined();
    expect(env.CURSEFORGE_API_KEY).toBeUndefined();
    expect(env.E2E).toBeUndefined();
    expect(env.MODRINTH_API_BASE).toBeUndefined();
  });

  it('T-UNIT-16 all 9 set + every optional absent → ok', () => {
    const source = validSource();
    for (const name of OPTIONAL) delete source[name];
    expect(() => parseEnv(source)).not.toThrow();
  });

  it('T-UNIT-16 HASH_SECRET shorter than 32 chars throws and names it (ADR-0012)', () => {
    const source = validSource();
    source.HASH_SECRET = 'x'.repeat(31);
    expect(() => parseEnv(source)).toThrow(/^Missing required environment variables: HASH_SECRET$/);
    source.HASH_SECRET = 'x'.repeat(32);
    expect(parseEnv(source).HASH_SECRET).toBe('x'.repeat(32));
  });

  it('T-UNIT-16 integration key names alone satisfy the Supabase keys (ADR-0010)', () => {
    const source = validSource();
    delete source.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete source.SUPABASE_SERVICE_ROLE_KEY;
    source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_placeholder';
    source.SUPABASE_SECRET_KEY = 'sb_secret_placeholder';
    const env = parseEnv(source);
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('sb_publishable_placeholder');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('sb_secret_placeholder');
    expect(Object.keys(env)).not.toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    expect(Object.keys(env)).not.toContain('SUPABASE_SECRET_KEY');
  });

  it('T-UNIT-16 canonical Supabase key names win when both forms are set (ADR-0010)', () => {
    const source = validSource();
    source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_placeholder';
    source.SUPABASE_SECRET_KEY = 'sb_secret_placeholder';
    const env = parseEnv(source);
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon-placeholder');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('service-placeholder');
  });

  it('T-UNIT-16 blank canonical key falls back to the integration name (ADR-0010)', () => {
    const source = validSource();
    source.NEXT_PUBLIC_SUPABASE_ANON_KEY = '   ';
    source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_placeholder';
    expect(parseEnv(source).NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('sb_publishable_placeholder');
  });

  it('T-UNIT-16 preview derives NEXT_PUBLIC_SITE_URL from VERCEL_BRANCH_URL (ADR-0010)', () => {
    const preview = validSource();
    preview.VERCEL_ENV = 'preview';
    preview.VERCEL_BRANCH_URL = 'odsens-git-feat-x-studiobing.vercel.app';
    expect(parseEnv(preview).NEXT_PUBLIC_SITE_URL).toBe(
      'https://odsens-git-feat-x-studiobing.vercel.app',
    );

    const production = validSource();
    production.VERCEL_ENV = 'production';
    production.VERCEL_BRANCH_URL = 'odsens-git-main-studiobing.vercel.app';
    expect(parseEnv(production).NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3000');
  });

  it('T-UNIT-16 NOTIFY_FROM_EMAIL defaults to allay@odsens.com', () => {
    const source = validSource();
    source.NOTIFY_FROM_EMAIL = '';
    expect(parseEnv(source).NOTIFY_FROM_EMAIL).toBe('allay@odsens.com');
  });

  it('T-UNIT-16 invalid URLs in the url-typed names throw and name them', () => {
    const site = validSource();
    site.NEXT_PUBLIC_SITE_URL = 'not a url';
    expect(() => parseEnv(site)).toThrow('NEXT_PUBLIC_SITE_URL');

    const supabase = validSource();
    supabase.NEXT_PUBLIC_SUPABASE_URL = 'nope'; // no scheme → not a URL
    expect(() => parseEnv(supabase)).toThrow('NEXT_PUBLIC_SUPABASE_URL');
  });

  it.each(NOT_SCHEMA_KEYS)('T-UNIT-16 %s is not a schema key (01 §7 env matrix)', (name) => {
    expect(Object.keys(envSchema.shape)).not.toContain(name);
  });

  it('T-UNIT-16 every schema key is either boot-required or optional (no third kind)', () => {
    const keys = Object.keys(envSchema.shape).sort();
    expect(keys).toEqual([...BOOT_REQUIRED, ...OPTIONAL].sort());
  });

  it('T-UNIT-16 publicEnv exposes NEXT_PUBLIC_* names only (01 INV-29)', async () => {
    vi.resetModules();
    const { publicEnv } = await import('@/lib/env/public');
    const keys = Object.keys(publicEnv);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key.startsWith('NEXT_PUBLIC_')).toBe(true);
  });
});

/**
 * `lib/env/public.ts` reads literal `process.env.NEXT_PUBLIC_*` names at module load, so each case
 * stubs the env, resets the module registry and imports it fresh (ADR-0010 client-side mirror).
 */
describe('lib/env/public.ts publicEnv (T-UNIT-16, ADR-0010 mirror)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function loadPublicEnv() {
    vi.resetModules();
    const mod = await import('@/lib/env/public');
    return mod.publicEnv;
  }

  it('T-UNIT-16 preview derives NEXT_PUBLIC_SITE_URL from NEXT_PUBLIC_VERCEL_BRANCH_URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_BRANCH_URL', 'odsens-git-x-studiobing.vercel.app');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    const publicEnv = await loadPublicEnv();
    expect(publicEnv.NEXT_PUBLIC_SITE_URL).toBe('https://odsens-git-x-studiobing.vercel.app');
  });

  it('T-UNIT-16 production / development keep the configured NEXT_PUBLIC_SITE_URL', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_BRANCH_URL', 'odsens-git-main-studiobing.vercel.app');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    expect((await loadPublicEnv()).NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3000');

    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'development');
    expect((await loadPublicEnv()).NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3000');
  });

  it('T-UNIT-16 preview without a branch URL falls back to the configured value', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview');
    vi.stubEnv('NEXT_PUBLIC_VERCEL_BRANCH_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    expect((await loadPublicEnv()).NEXT_PUBLIC_SITE_URL).toBe('http://localhost:3000');
  });

  it('T-UNIT-16 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY fills a blank anon key; canonical wins', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_placeholder');
    expect((await loadPublicEnv()).NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe(
      'sb_publishable_placeholder',
    );

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-placeholder');
    const both = await loadPublicEnv();
    expect(both.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe('anon-placeholder');
    expect(Object.keys(both)).not.toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  });

  it('T-UNIT-16 a missing public name throws at import and names it', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    await expect(loadPublicEnv()).rejects.toThrow(
      /Missing or invalid public environment variables: NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'not a url');
    await expect(loadPublicEnv()).rejects.toThrow(/NEXT_PUBLIC_SITE_URL/);
  });

  it('T-UNIT-16 publicEnv holds no server-only name (HASH_SECRET, SUPABASE_SERVICE_ROLE_KEY, …)', async () => {
    const keys = Object.keys(await loadPublicEnv());
    for (const key of keys) expect(key.startsWith('NEXT_PUBLIC_')).toBe(true);
    expect(keys).not.toContain('HASH_SECRET');
    expect(keys).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(keys).not.toContain('SUPABASE_SECRET_KEY');
    expect(keys).not.toContain('CRON_SECRET');
  });
});
