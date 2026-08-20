/**
 * tests/fixtures/ui/icon.ts — `Icon` states for `/dev/components` (03 §2.2 `Icon`; T-E2E-48):
 * every name × 16/20/24 × decorative (`aria-hidden`) / titled (`role="img"` + <title>).
 */
import { ICON_NAMES, type IconProps } from '@/components/primitives/Icon';

export type IconFixture = { label: string; props: IconProps };

const SIZES = [16, 20, 24] as const;

export const iconFixtures: IconFixture[] = ICON_NAMES.flatMap((name) =>
  SIZES.flatMap((size): IconFixture[] => [
    { label: `Icon · ${name} ${size}`, props: { name, size } },
    { label: `Icon · ${name} ${size} titled`, props: { name, size, title: name } },
  ]),
);
