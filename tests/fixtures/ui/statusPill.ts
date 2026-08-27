/**
 * tests/fixtures/ui/statusPill.ts — `StatusPill` for `/dev/components` (03 §2.2; T-E2E-48):
 * every status in the 03 fill map (ADR-0002 #47, O-4) — `published` renders the LIVE word.
 */
import { STATUS_PILL_STATUSES, type StatusPillProps } from '@/components/primitives/StatusPill';

export type StatusPillFixture = { label: string; props: StatusPillProps };

export const statusPillFixtures: StatusPillFixture[] = STATUS_PILL_STATUSES.map((status) => ({
  label: `StatusPill · ${status}`,
  props: { status },
}));
