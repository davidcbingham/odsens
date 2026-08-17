import { defineConfig, devices } from '@playwright/test';

/**
 * playwright.config.ts — projects per docs/build/05-test-plan.md §1.1 / H-7:
 *  smoke-desktop (1280×800) · smoke-phone (390×844) · e2e (1280) · admin (1280, serial). All dark.
 * Runs against `pnpm build && pnpm start` on http://localhost:3000 (+ local Supabase for later slices).
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

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
        env: { E2E: '1' },
      },
  projects: [
    {
      name: 'smoke-desktop',
      testMatch: /smoke\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, colorScheme: 'dark' },
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
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, colorScheme: 'dark' },
    },
    {
      name: 'admin',
      testMatch: /admin\/.*\.spec\.ts/,
      fullyParallel: false,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, colorScheme: 'dark' },
    },
  ],
});
