import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { ENV_TEST_PATH, parseEnvFile } from './tests/helpers/envTest';

/**
 * playwright.config.ts — projects per docs/build/05-test-plan.md §1.1 / H-7:
 *  smoke-desktop (1280×800) · smoke-phone (390×844) · e2e (1280) · admin (1280, serial). All dark.
 * Runs against `pnpm build && pnpm start` on http://localhost:3000 + the LOCAL Supabase stack.
 *
 * Environment of the app under test (05 §1.2, H-9/H-10, CI-4/CI-5): `webServer` starts `pnpm start`
 * with every name in the committed `.env.test` as a default and the shell's values on top (shell wins,
 * as in CI where the workflow sources `.env.test` first). The Supabase session cookies `loginAs` injects
 * are named from `.env.test`'s `NEXT_PUBLIC_SUPABASE_URL`, so the server MUST see the same URL/anon key
 * — otherwise every signed-in spec fails and the server could talk to a non-local project. Because Next
 * inlines `NEXT_PUBLIC_*` at BUILD time, build for e2e with the same file:
 *   set -a; source .env.test; set +a; pnpm build && pnpm test:e2e
 * (CI does exactly this.) A plain `pnpm build` uses `.env` and is not a valid e2e build.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

/** `.env.test` as defaults, shell on top, `E2E=1` always (enables `/__test/throw`, T-E2E-15). */
function webServerEnv(): Record<string, string> {
  const fromFile = parseEnvFile(readFileSync(ENV_TEST_PATH, 'utf8'));
  const fromShell: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined) fromShell[name] = value;
  }
  return { ...fromFile, ...fromShell, E2E: '1' };
}

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI), // 05 H-11
  retries: process.env.CI ? 1 : 0, // 05 CI-11
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    colorScheme: 'dark',
    trace: 'on-first-retry',
    screenshot: 'off',
  },
  webServer: process.env.PLAYWRIGHT_NO_SERVER
    ? undefined
    : {
        command: 'pnpm start',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: webServerEnv(),
      },
  projects: [
    {
      name: 'smoke-desktop',
      testMatch: /smoke\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        colorScheme: 'dark',
      },
    },
    {
      name: 'smoke-phone',
      testMatch: /smoke\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        colorScheme: 'dark',
      },
    },
    {
      name: 'e2e',
      testMatch: /flows\/.*\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        colorScheme: 'dark',
      },
    },
    {
      // Admin flows mutate seed content (curate toggles, a real fixture-server sync — 05
      // T-E2E-34/41) and restore it afterwards; running them AFTER the read-only projects keeps
      // the seed-truth smoke/e2e assertions (hero, card counts) deterministic. `dependencies`
      // orders projects without changing the 05 §1.1 project set.
      name: 'admin',
      testMatch: /admin\/.*\.spec\.ts/,
      fullyParallel: false,
      dependencies: ['smoke-desktop', 'smoke-phone', 'e2e'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        colorScheme: 'dark',
      },
    },
  ],
});
