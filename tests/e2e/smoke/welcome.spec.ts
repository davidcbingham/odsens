/**
 * tests/e2e/smoke/welcome.spec.ts — `/welcome` renders the OnboardingPanel for a signed-in user
 * without a handle (02 §2.4; DESIGN.md §11.3 #10; 00 S1.1.AC2). Smoke only — the onboarding flow
 * itself is tests/e2e/flows/onboarding.spec.ts (T-E2E-21/22). axe + screenshot at both viewports.
 *
 * Uses a factory user (`makeUser({ handle: null })`, cleaned in `afterAll`) rather than
 * `seed_newbie`: the flow spec onboards `seed_newbie` in parallel in the `e2e` project, and a
 * seeded session whose handle has just been set would be bounced off `/welcome` (02 M6).
 */
import { test, expect } from '../fixtures';
import { expectNoSeriousA11y } from '../../helpers/axe';
import { loadEnvTest } from '../../helpers/envTest';
import { cleanupFactories, makeUser } from '../../helpers/factories';
import { loginAsUser } from '../../helpers/loginAs';
import { shoot } from '../../helpers/screenshots';

test.describe('welcome', () => {
  let profileId = '';

  test.beforeAll(async () => {
    loadEnvTest();
    profileId = await makeUser({ handle: null });
  });

  test.afterAll(async () => {
    await cleanupFactories();
  });

  test('/welcome → 200, STEP 1 OF 1, PICK A HANDLE, disabled DONE, noindex · axe · screenshot', async ({
    page,
  }) => {
    await loginAsUser(page, profileId);
    const response = await page.goto('/welcome');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
    await expect(page).toHaveTitle('Pick a handle — odsens');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

    await expect(page.getByText('STEP 1 OF 1')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('PICK A HANDLE');
    await expect(page.getByText("Pick a handle. It's all anyone will ever see.")).toBeVisible();
    await expect(page.getByLabel('Handle', { exact: true })).toBeVisible();
    await expect(page.getByText('3–20 characters. Letters, numbers, underscore.')).toBeVisible();
    // The guidance block is a NoteCallout (03 C-22) tagged WHAT'S A HANDLE? (DESIGN.md §12.5 line).
    const guidance = page.getByRole('complementary', { name: 'Note' });
    await expect(guidance).toHaveCount(1);
    await expect(guidance.getByText("WHAT'S A HANDLE?", { exact: true })).toBeVisible();
    await expect(guidance).toContainText(
      "Handles are made-up names. Don't use your real one — nobody here needs to know it, including us.",
    );
    await expect(page.getByRole('button', { name: 'Upload picture' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Skip/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'DONE' })).toBeDisabled();
    await expect(
      page.getByText('You can change both later. Your Google name and email stay hidden.'),
    ).toBeVisible();

    // Onboarding shell (02 RP-09): wordmark + Sign out POST form, no main nav / footer.
    await expect(page.locator('header nav[aria-label="Main"]')).toHaveCount(0);
    await expect(page.locator('form[action="/auth/sign-out"] button')).toHaveText('Sign out');
    await expect(page.locator('main#main')).toHaveCount(1);

    await expectNoSeriousA11y(page);
    await shoot(page, 'welcome');
  });
});
