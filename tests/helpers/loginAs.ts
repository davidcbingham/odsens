/**
 * tests/helpers/loginAs.ts — `loginAs(page, role)` (docs/build/05-test-plan.md §1.3, H-9).
 * Signs a seed user in on the local stack (password auth, SEED-3) and sets the Supabase auth cookies.
 * Real implementation lands in S1.1 (05 §8); at S0 this is a typed stub.
 */
import type { Page } from '@playwright/test';

export type SeedRole = 'user' | 'banned' | 'mod' | 'admin' | 'nohandle' | 'user0';

export type LoginAs = (page: Page, role: SeedRole) => Promise<void>;

export const loginAs: LoginAs = () => {
  throw new Error('loginAs: available from S1.1');
};
