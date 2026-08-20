/**
 * tests/e2e/flows/profile.spec.ts — T-E2E-23 (S1.1 part): `/profile` for `seed_user` (02 §2.5;
 * 04 §1.1 updateProfile / deleteAccount; ADR-0002 #27 / #28; DESIGN.md §11.3 #11). Rename → toast
 * "Saved." + consequence line + the proactive 7-day line; a second rename → the 7-day reason;
 * picture upload + Remove; the Delete account control behind an inline confirm (not executed).
 * The "comment shows the new handle" clause lands with comments (S1.4).
 * `mutatesSeed`: serial; `seed_user` is restored (handle, handle_changed_at NULL, avatar_path NULL,
 * objects removed) before the file and in `afterAll` (05 H-1).
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

const USER = SEED_USERS.seed_user;
const SEED_HANDLE = 'seed_user';
const SEVEN_DAY_LINE = /You can change it again on \d{4}-\d{2}-\d{2}\./;
const DANGER = 'rgb(240, 131, 107)'; // --danger #f0836b
/** Error messages rendered by the page (never Next's `#__next-route-announcer__`). */
const ALERTS = '[role="alert"]:not(#__next-route-announcer__)';

function randomHandle(): string {
  return `t_e2e_${Math.random().toString(36).slice(2, 10)}`;
}

function handleField(page: Page): Locator {
  return page.locator('div[data-state]:has(input[name="handle"])');
}

function avatarUpload(page: Page): Locator {
  return page.locator('div[data-state]:has(input[type="file"][name="avatar"])');
}

function menuTrigger(page: Page): Locator {
  return page.locator('header nav button[aria-haspopup="menu"]');
}

/**
 * Resolves once React has hydrated the element `selector` points at: host instances carry a
 * `__reactFiber$…` property only after hydration (or a client render) attached them. The `/profile`
 * segment sits behind `loading.tsx`, a Suspense boundary React hydrates lazily after the root, and an
 * event that lands on it before that is dropped — so every interaction waits for this first.
 */
async function waitForHydrated(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel);
    return el !== null && Object.keys(el).some((key) => key.startsWith('__reactFiber$'));
  }, selector);
}

type DetachedTracker = Window & { __detachedHandleInputs?: Element[] };

/** Signed-in `/profile`; the ProfileMenu trigger appears only after hydration + the viewer read. */
async function openProfile(page: Page): Promise<void> {
  await loginAs(page, 'user');
  await page.goto('/profile');
  await expect(menuTrigger(page)).toBeVisible();
  // The page streams behind `loading.tsx`; wait until exactly one HandleField is mounted and hydrated.
  await expect(page.locator('input[name="handle"]')).toHaveCount(1);
  await waitForHydrated(page, 'input[name="handle"]');
}

/**
 * Types a handle and waits for the live field to react. No retry: the `/profile` segment hydrates in
 * place (ViewerProvider publishes through an external store, never a context update that would make
 * React client-render the still-dehydrated `loading.tsx` boundary — ADR-0014 addendum).
 */
async function typeHandle(page: Page, value: string): Promise<void> {
  await page.getByLabel('Handle', { exact: true }).fill(value);
  await expect(handleField(page)).toHaveAttribute('data-state', /checking|available|invalid/);
}

test.beforeAll(async () => {
  loadEnvTest();
  await restoreSeedProfile(USER, { handle: SEED_HANDLE });
});

test.afterAll(async () => {
  await restoreSeedProfile(USER, { handle: SEED_HANDLE });
});

test.describe('profile', () => {
  test('T-E2E-23 /profile hydrates in place — the server-rendered handle input is never replaced (ADR-0014 addendum)', async ({
    page,
  }) => {
    await loginAs(page, 'user');
    // From the first byte on, remember every `input[name=handle]` that leaves the document. React's
    // streaming script moves the segment out of its hidden holder (a removal that stays connected);
    // the old context-based ViewerProvider made React discard the server HTML of the still-dehydrated
    // segment and client-render it (the SSR input ends up detached, keystrokes lost). A store update
    // reaches only its subscribers, so the SSR input must still be connected after the viewer read.
    await page.addInitScript(() => {
      const w = window as DetachedTracker;
      w.__detachedHandleInputs = [];
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (!(node instanceof Element)) continue;
            const inputs = node.matches('input[name="handle"]')
              ? [node]
              : Array.from(node.querySelectorAll('input[name="handle"]'));
            w.__detachedHandleInputs?.push(...inputs);
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto('/profile');
    await expect(menuTrigger(page)).toBeVisible(); // the viewer read has published
    await expect(page.locator('input[name="handle"]')).toHaveCount(1);
    await waitForHydrated(page, 'input[name="handle"]');
    await page.waitForLoadState('networkidle'); // let any late re-render land
    const detached = await page.evaluate(
      () =>
        ((window as DetachedTracker).__detachedHandleInputs ?? []).filter((el) => !el.isConnected)
          .length,
    );
    expect(detached, 'server-rendered handle inputs left detached').toBe(0);
    // Hydrated in place: the live input keeps its server `useId` (`_R_…_`), not a client one (`_r_…_`).
    await expect(page.locator('input[name="handle"]')).toHaveAttribute('id', /^_R_/);
  });

  test('T-E2E-23 rename → Saved. toast, consequence + 7-day line; second rename → 7-day reason', async ({
    page,
  }) => {
    await openProfile(page);
    const input = page.getByLabel('Handle', { exact: true });
    const save = page.getByRole('button', { name: 'SAVE' });
    await expect(input).toHaveValue(SEED_HANDLE);
    await expect(save).toBeDisabled();
    await expect(
      page.getByText("Changing it renames you on every comment you've left."),
    ).toBeVisible();
    await expect(page.getByText(SEVEN_DAY_LINE)).toHaveCount(0);

    const handle = randomHandle();
    await typeHandle(page, handle);
    await expect(handleField(page)).toHaveAttribute('data-state', 'available');
    await expect(save).toBeEnabled();
    // Mark the pre-save field: `router.refresh()` after the save remounts `HandleField`
    // (`key={handle}`), and the second attempt must be typed into the remounted one.
    await input.evaluate((el) => {
      el.setAttribute('data-e2e', 'before-save');
    });
    await save.click();

    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await expect(page.getByText(SEVEN_DAY_LINE)).toBeVisible();
    // The refreshed page carries the new handle everywhere (00 S1.1.AC6: ProfileMenu updates).
    await expect(menuTrigger(page)).toContainText(handle);
    await expect(page.locator('input[name="handle"][data-e2e="before-save"]')).toHaveCount(0);
    await expect(page.getByLabel('Handle', { exact: true })).toHaveValue(handle);
    await expect(page.getByRole('button', { name: 'SAVE' })).toBeDisabled();

    const row = await readSeedProfile(USER);
    expect(row?.handle).toBe(handle);
    expect(row?.handle_changed_at).not.toBeNull();

    // Second attempt within 7 days: the action answers `rate_limited` with the same sentence.
    await typeHandle(page, `${handle}b`);
    await expect(handleField(page)).toHaveAttribute('data-state', 'available');
    await page.getByRole('button', { name: 'SAVE' }).click();
    await expect(page.locator(ALERTS).filter({ hasText: SEVEN_DAY_LINE })).toBeVisible();
    expect((await readSeedProfile(USER))?.handle).toBe(handle);
  });

  test('T-E2E-23 picture: upload → crop → saved; Remove → cleared', async ({ page }) => {
    await openProfile(page);
    const upload = avatarUpload(page);
    await expect(upload).toHaveAttribute('data-state', 'empty');

    await upload
      .locator('input[type="file"]')
      .setInputFiles(fixturePath('images', 'avatar-600.png'));
    await expect(upload).toHaveAttribute('data-state', 'cropping');
    // USE THIS hands the cropped WebP to the form, which submits straight away (02 §2.5).
    await page.getByRole('button', { name: 'USE THIS' }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
    await expect(page.locator(ALERTS).filter({ hasText: /\S/ })).toHaveCount(0);
    await expect(upload).toHaveAttribute('data-state', 'done');
    await expect
      .poll(async () => (await readSeedProfile(USER))?.avatar_path)
      .toMatch(new RegExp(`^${USER}/[0-9a-f]{16}\\.webp$`));
    const stored = (await readSeedProfile(USER))?.avatar_path;
    expect(await listObjects('avatars', USER)).toEqual([stored]);

    await upload.getByRole('button', { name: 'Remove' }).click();
    await expect(upload).toHaveAttribute('data-state', 'empty');
    await expect
      .poll(
        async () => {
          const texts = (await page.locator(ALERTS).allTextContents()).filter((t) => t.trim());
          if (texts.length > 0) return `alert: ${texts.join(' / ')}`;
          return (await readSeedProfile(USER))?.avatar_path ?? null;
        },
        { message: 'Remove → updateProfile clears avatar_path (or the inline error)' },
      )
      .toBeNull();
    await expect.poll(() => listObjects('avatars', USER)).toEqual([]);
    await expect(upload.getByText('NO PICTURE')).toBeVisible();
  });

  test('T-E2E-23 Delete account: danger control, inline confirm, Keep it (never executed)', async ({
    page,
  }) => {
    await openProfile(page);
    const trigger = page.getByRole('button', { name: 'Delete account' });
    await expect(trigger).toBeVisible();
    expect(await trigger.evaluate((el) => getComputedStyle(el).color)).toBe(DANGER);

    const confirm = page.locator('[data-state]:has(> [role="group"])');
    await expect(confirm).toHaveCount(0);
    await trigger.click();
    const group = page.getByRole('group', {
      name: 'Delete your account? Your handle, picture and comments go with it.',
    });
    await expect(group).toBeVisible();
    await expect(page.locator('[data-state="open"][data-tone="danger"]')).toHaveCount(1);
    const keep = group.getByRole('button', { name: /^Keep it/ });
    await expect(group.getByRole('button', { name: 'Delete it' })).toBeVisible();
    await expect(keep).toBeFocused();

    await keep.click();
    await expect(group).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete account' })).toBeFocused();

    // Nothing happened: the row is still there and the session still works.
    expect(await readSeedProfile(USER)).not.toBeNull();
    expect((await page.request.get('/profile', { maxRedirects: 0 })).status()).toBe(200);
  });
});
