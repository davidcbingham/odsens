/**
 * tests/fixtures/ui/pixelLabel.ts — `PixelLabel` states for `/dev/components` (03 §2.2; T-E2E-48).
 * Sizes 10/11/12, every tone, every fill, and informational labels (≥ 11px; size 10 would throw in dev).
 */
import type { PixelLabelProps } from '@/components/primitives/PixelLabel';

export type PixelLabelFixture = { label: string; props: PixelLabelProps };

const SIZES = [10, 11, 12] as const;
const TONES = ['mute-dim', 'gold', 'emerald', 'chalk', 'gold-ink'] as const;
const FILLS = ['gold', 'indigo-wash', 'neutral'] as const;

const FILL_TEXT: Record<(typeof FILLS)[number], string> = {
  gold: 'CREATOR',
  'indigo-wash': 'MOD',
  neutral: 'CLIENT',
};

export const pixelLabelFixtures: PixelLabelFixture[] = [
  ...SIZES.map((size): PixelLabelFixture => ({
    label: `PixelLabel · size ${size}`,
    props: { size, tone: 'mute-dim', children: 'FEATURED' },
  })),
  ...TONES.map((tone): PixelLabelFixture => ({
    label: `PixelLabel · tone ${tone}`,
    // `--gold-ink` is "text on gold fills" (DESIGN.md §1) — never on ink — so that specimen sits on a gold fill.
    props:
      tone === 'gold-ink'
        ? { tone, fill: 'gold', children: 'SIGNED IN' }
        : { tone, children: 'SIGNED IN' },
  })),
  ...FILLS.map((fill): PixelLabelFixture => ({
    label: `PixelLabel · fill ${fill}`,
    props: { fill, children: FILL_TEXT[fill] },
  })),
  {
    label: 'PixelLabel · informational 11',
    props: { informational: true, tone: 'emerald', children: '8.9K DOWNLOADS' },
  },
  {
    label: 'PixelLabel · informational 12',
    props: { size: 12, informational: true, tone: 'gold', children: 'HELD FOR REVIEW' },
  },
];
