/**
 * tests/fixtures/ui/chip.ts — `Chip` states for `/dev/components` (03 §2.2 `Chip`, §3; T-E2E-48):
 * rest (version / loader / `+N` overflow), selected link (`aria-current`), unavailable
 * (`aria-disabled`). `onRemove` is a function, so a Server Component cannot pass it — the
 * removable ✕ state renders through `ActiveFilterChips` on `/projects` (05 T-E2E-2) and, with
 * `removeLabel` ("Remove <email>", ADR-0030 D19), through `NotificationMatrix` on this page.
 * Chip caps (2 on `ProjectCard`, 4 elsewhere — ADR-0002 #54) are the surfaces' concern.
 */
import type { ChipProps } from '@/components/primitives/Chip';

export type ChipFixture = { label: string; props: Omit<ChipProps, 'onRemove' | 'removeLabel'> };

export const chipFixtures: ChipFixture[] = [
  { label: 'Chip · version', props: { label: '1.21.x' } },
  { label: 'Chip · loader', props: { label: 'Fabric' } },
  { label: 'Chip · overflow', props: { label: '+2' } },
  { label: 'Chip · link', props: { label: '1.20.x', href: '/projects?version=1.20.x' } },
  {
    label: 'Chip · selected link',
    props: { label: '1.21.x', href: '/projects?version=1.21.x', selected: true },
  },
  { label: 'Chip · unavailable', props: { label: 'Forge', unavailable: true } },
];
