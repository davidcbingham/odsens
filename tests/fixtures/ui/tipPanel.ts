/**
 * tests/fixtures/ui/tipPanel.ts — `TipPanel` for `/dev/components` (03 §2.3; T-E2E-48):
 * the S1.2 placeholder slab pointing at /support (00 S1.2; final copy lands in S1.9).
 */
import type { TipPanelProps } from '@/components/projects/TipPanel';

export type TipPanelFixture = { label: string; props: TipPanelProps };

export const tipPanelFixtures: TipPanelFixture[] = [
  { label: 'TipPanel · rail', props: {} },
  { label: 'TipPanel · compact', props: { compact: true } },
];
