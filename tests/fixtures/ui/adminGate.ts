/**
 * tests/fixtures/ui/adminGate.ts — `AdminGate` for `/dev/components` (03 §2.10; DESIGN.md §11.3 #18).
 * One variant only (ADR-0002 C4): ADMINS ONLY + the chalk Google button.
 */
import type { AdminGateProps } from '@/components/admin/AdminGate';

export type AdminGateFixture = { label: string; props: AdminGateProps };

export const adminGateFixtures: AdminGateFixture[] = [{ label: 'AdminGate · anon', props: {} }];
