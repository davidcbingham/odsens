/**
 * tests/e2e/flows/onboarding.spec.ts — T-E2E-21 (handle onboarding) and T-E2E-22 (picture) on
 * `/welcome` (02 §2.4, §3 M5/M6; 04 §1.1 completeOnboarding; DESIGN.md §11.1 Handle field /
 * Picture upload, §11.3 #10). `mutatesSeed`: every test onboards `seed_newbie` (`nohandle`), so the
 * file runs serially and the row is restored (handle NULL, avatar_path NULL, objects removed) before
 * each test and in `afterAll` (05 H-1).
 */
import type { Page, Locator } from '@playwright/test';
import { test, expect } from '../fixtures';
import { loadEnvTest } from '../../helpers/envTest';
import { fixturePath } from '../../helpers/fixtures';
import { loginAs } from '../../helpers/loginAs';
import { SEED_USERS } from '../../helpers/seedIds';
import { readSeedProfile, restoreSeedProfile } from '../../helpers/seedReset';
import { listObjects } from '../../helpers/storage';

test.describe.configure({ mode: 'serial' });

const NEWBIE = SEED_USERS.seed_newbie;
const UPLOAD_FAILED = "That didn't upload. Try again?";
/** Error messages rendered by the page (never Next's `#__next-route-announcer__`). */
const ALERTS = '[role="alert"]:not(#__next-route-announcer__)';

function randomHandle(): string {
  return `t_e2e_${Math.random().toString(36).slice(2, 10)}`; // 14 chars, H1-valid
}

/** The `HandleField` root (`data-state` resting/checking/available/invalid — 03 §3). */
function handleField(page: Page): Locator {
  return page.locator('div[data-state]:has(input[name="handle"])');
}

/** The `AvatarUpload` root (`data-state` empty/cropping/uploading/error/done — 03 §3). */
function avatarUpload(page: Page): Locator {
  return page.locator('div[data-state]:has(input[type="file"][name="avatar"])');
}

async function openWelcome(page: Page, path = '/welcome'): Promise<void> {
  await loginAs(page, 'nohandle');
  // `networkidle`: the panel's handlers exist only after hydration (no server fallback for the field).
  await page.goto(path, { waitUntil: 'networkidle' });
}

/** Types `handle`, waits for the server verdict `available` and DONE to arm. */
async function typeAvailableHandle(page: Page, handle: string): Promise<void> {
  await page.getByLabel('Handle', { exact: true }).fill(handle);
  await expect(handleField(page)).toHaveAttribute('data-state', 'available');
  await expect(page.getByRole('button', { name: 'DONE' })).toBeEnabled();
}

/** Waits for the post-DONE navigation; an inline error under DONE fails fast with its text. */
async function expectLanded(page: Page, pathname: string): Promise<void> {
  await expect
    .poll(
      async () => {
        // Next's route announcer is a `role="alert"` too (empty, then the new page's title).
        let texts: string[] = [];
        try {
          texts = (await page.locator(ALERTS).allTextContents()).filter((t) => t.trim());
        } catch {
          // The post-DONE document navigation (ADR-0017) tore the old execution context down
          // mid-read — poll again on whatever document is current.
          return new URL(page.url()).pathname;
        }
        if (texts.length > 0) return `alert: ${texts.join(' / ')}`;
        return new URL(page.url()).pathname;
      },
      { message: `DONE → ${pathname} (or the inline error under DONE)` },
    )
    .toBe(pathname);
}

test.beforeAll(() => {
  loadEnvTest();
});

test.beforeEach(async () => {
  await restoreSeedProfile(NEWBIE, { handle: null });
});

test.afterAll(async () => {
  await restoreSeedProfile(NEWBIE, { handle: null });
});

test.describe('onboarding', () => {
  test('T-E2E-21 nohandle → /welcome?next=/projects; taken / reserved / short / free; DONE → next; /welcome → 307 /', async ({
    page,
  }) => {
    await openWelcome(page, '/projects');
    // 02 M5: onboarding is mandatory; `next` carries the original path.
    const landed = new URL(page.url());
    expect(landed.pathname).toBe('/welcome');
    expect(landed.searchParams.get('next')).toBe('/projects');

    await expect(page.getByText('STEP 1 OF 1')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('PICK A HANDLE');

    const input = page.getByLabel('Handle', { exact: true });
    const field = handleField(page);
    const done = page.getByRole('button', { name: 'DONE' });
    const helper = field.locator('[aria-live="polite"]');
    await expect(field).toHaveAttribute('data-state', 'resting');
    await expect(done).toBeDisabled();

    // taken (server verdict via checkHandle)
    // seed_mod: a seed handle no other e2e file renames (profile.spec.ts renames seed_user in parallel — 05 H-1)
    await input.fill('seed_mod');
    await expect(field).toHaveAttribute('data-state', 'invalid');
    await expect(helper).toHaveText("That one's taken.");
    await expect(field.getByText('✕')).toBeVisible();
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(done).toBeDisabled();

    // reserved (04 H3 — instant, lib/validation/handle.ts mirrors the list)
    await input.fill('admin');
    await expect(field).toHaveAttribute('data-state', 'invalid');
    await expect(helper).toHaveText("That one's reserved.");
    await expect(done).toBeDisabled();

    // too short
    await input.fill('ab');
    await expect(field).toHaveAttribute('data-state', 'invalid');
    await expect(helper).toHaveText('Too short. 3 characters minimum.');
    await expect(done).toBeDisabled();

    // free: checking (debounce ≥ 400 ms + round trip) → available ✔, counter n / 20
    const handle = randomHandle();
    await input.fill(handle);
    await expect(field).toHaveAttribute('data-state', 'checking');
    await expect(field).toHaveAttribute('data-state', 'available');
    await expect(helper).toHaveText("That one's free.");
    await expect(field.getByText('✔')).toBeVisible();
    await expect(field.getByText(`${handle.length} / 20`)).toBeVisible();
    await expect(input).not.toHaveAttribute('aria-invalid', 'true');
    await expect(done).toBeEnabled();

    await done.click();
    await expectLanded(page, '/projects');

    // The nav's ProfileMenu shows the handle (03 N-04; ViewerProvider own-row read).
    await expect(page.locator('header nav button[aria-haspopup="menu"]')).toContainText(handle);

    // The row: handle set (case preserved), no picture.
    expect(await readSeedProfile(NEWBIE)).toMatchObject({ handle, avatar_path: null });

    // 02 M6: an onboarded user never sees /welcome again (307 `/`, the default `next`).
    const again = await page.request.get('/welcome', { maxRedirects: 0 });
    expect(again.status()).toBe(307);
    expect(new URL(again.headers()['location'] ?? '', page.url()).pathname).toBe('/');
  });

  test('T-E2E-22 avatar-600.png → crop UI → USE THIS → done (white border) → DONE stores the picture', async ({
    page,
  }) => {
    await openWelcome(page);
    const upload = avatarUpload(page);
    await expect(upload).toHaveAttribute('data-state', 'empty');
    await expect(upload.getByText('NO PICTURE')).toBeVisible();
    await expect(upload.getByText('PNG, JPG or WebP, up to 1 MB.')).toBeVisible();

    await upload
      .locator('input[type="file"]')
      .setInputFiles(fixturePath('images', 'avatar-600.png'));
    await expect(upload).toHaveAttribute('data-state', 'cropping');
    await expect(page.getByText('CROP IT SQUARE')).toBeVisible();
    await expect(page.getByRole('application', { name: 'Crop area' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeDisabled();

    await page.getByRole('button', { name: 'USE THIS' }).click();
    await expect(upload).toHaveAttribute('data-state', 'done');
    const picture = upload.locator('img[alt="Your picture"]');
    await expect(picture).toBeVisible();
    // DESIGN.md §11.1: the thumbnail sits in a 3px `--white` border.
    const border = await picture.evaluate((img) => {
      const cs = getComputedStyle(img.parentElement as HTMLElement);
      return { color: cs.borderTopColor, width: cs.borderTopWidth };
    });
    expect(border).toEqual({ color: 'rgb(255, 255, 255)', width: '3px' });
    await expect(upload.getByRole('button', { name: 'Change' })).toBeVisible();
    await expect(upload.getByRole('button', { name: 'Remove' })).toBeVisible();

    const handle = randomHandle();
    await typeAvailableHandle(page, handle);
    await page.getByRole('button', { name: 'DONE' }).click();
    await expectLanded(page, '/');

    // Stored: `avatar_path` = `<id>/<hash16>.webp` (S1.1 brief §1) and exactly that object exists.
    const row = await readSeedProfile(NEWBIE);
    expect(row?.handle).toBe(handle);
    expect(row?.avatar_path).toMatch(new RegExp(`^${NEWBIE}/[0-9a-f]{16}\\.webp$`));
    expect(await listObjects('avatars', NEWBIE)).toEqual([row?.avatar_path]);
  });

  test('T-E2E-22 DONE without a picture completes — there is no Skip button (ADR-0017)', async ({
    page,
  }) => {
    await openWelcome(page);
    await expect(page.getByRole('button', { name: /^Skip/ })).toHaveCount(0);
    const handle = randomHandle();
    await typeAvailableHandle(page, handle);
    // DONE is gated on the handle only; the picture never arms or disarms it.
    await page.evaluate(() => {
      (window as Window & { __onboardingDocument?: true }).__onboardingDocument = true;
    });
    await page.getByRole('button', { name: 'DONE' }).click();
    await expectLanded(page, '/');
    // ADR-0017 D3: success leaves with a DOCUMENT navigation (the marker set above is gone), never a
    // soft `router.replace` that the router's prefetch cache could answer with "307 → /welcome".
    expect(
      await page.evaluate(
        () => (window as Window & { __onboardingDocument?: true }).__onboardingDocument,
      ),
    ).toBeUndefined();

    expect(await readSeedProfile(NEWBIE)).toMatchObject({ handle, avatar_path: null });
    expect(await listObjects('avatars', NEWBIE)).toEqual([]);
  });

  test(`T-E2E-22 bad.svg → error "${UPLOAD_FAILED}" (client pre-check, same copy as the server)`, async ({
    page,
  }) => {
    await openWelcome(page);
    const upload = avatarUpload(page);

    // No request leaves the page for this: `validateUpload` runs on the bytes in the browser.
    const actionRequests: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST') actionRequests.push(req.url());
    });

    await upload.locator('input[type="file"]').setInputFiles(fixturePath('images', 'bad.svg'));
    await expect(upload).toHaveAttribute('data-state', 'error');
    const alert = upload.getByRole('alert');
    await expect(alert).toContainText(UPLOAD_FAILED);
    await expect(alert).toContainText("That's a .svg. Allowed: .png .jpg .webp");
    await expect(upload.getByRole('button', { name: /^Try again/ })).toBeVisible();
    expect(actionRequests).toEqual([]);

    // Still un-onboarded: nothing was submitted.
    expect(await readSeedProfile(NEWBIE)).toMatchObject({ handle: null, avatar_path: null });
  });
});
