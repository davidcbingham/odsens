/**
 * tests/fixtures/ui/button.ts — `Button` states for `/dev/components` (03 §2.2 `Button`; T-E2E-48).
 * Five variants × rest / disabled / pending / size sm / as link, plus ghost without the arrow.
 * Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard).
 */
import type { ButtonProps } from '@/components/primitives/Button';

export type ButtonFixture = { label: string; props: ButtonProps };

const VARIANTS = ['primary', 'secondary', 'ghost', 'gold', 'gold-ink'] as const;

const LABEL: Record<(typeof VARIANTS)[number], string> = {
  primary: 'DOWNLOAD',
  secondary: 'See all',
  ghost: 'See the projects',
  gold: '♥ SUPPORT',
  'gold-ink': 'CONTINUE ON KO-FI',
};

export const buttonFixtures: ButtonFixture[] = [
  ...VARIANTS.flatMap((variant): ButtonFixture[] => [
    { label: `Button · ${variant} rest`, props: { variant, children: LABEL[variant] } },
    {
      label: `Button · ${variant} disabled`,
      props: { variant, disabled: true, children: LABEL[variant] },
    },
    {
      label: `Button · ${variant} pending`,
      props: { variant, pending: true, children: LABEL[variant] },
    },
    { label: `Button · ${variant} sm`, props: { variant, size: 'sm', children: LABEL[variant] } },
    {
      label: `Button · ${variant} link`,
      props: { variant, href: '/projects', children: LABEL[variant] },
    },
  ]),
  {
    label: 'Button · ghost no-arrow',
    props: { variant: 'ghost', arrow: false, children: 'Cancel' },
  },
];
