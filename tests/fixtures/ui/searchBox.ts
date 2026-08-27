/**
 * tests/fixtures/ui/searchBox.ts — `SearchBox` for `/dev/components` (03 §2.2 `SearchBox`;
 * 02 RP-02/RP-12; T-E2E-48). `placement="page"` renders the slab-sunk search input (visible
 * under 900px — 02 §2.2); `placement="nav"` renders NOTHING off `/projects` (RP-12,
 * `usePathname`), which is exactly what the dev route shows for it.
 * Labels: "<Name> · <state>" (≤ 5 words — PixelLabel guard).
 */
import type { SearchBoxProps } from '@/components/primitives/SearchBox';

export type SearchBoxFixture = { label: string; props: SearchBoxProps };

export const searchBoxFixtures: SearchBoxFixture[] = [
  { label: 'SearchBox · page', props: { placement: 'page' } },
  { label: 'SearchBox · nav elsewhere', props: { placement: 'nav' } },
];
