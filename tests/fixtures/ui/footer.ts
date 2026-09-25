/**
 * tests/fixtures/ui/footer.ts — `Footer` for `/dev/components` (03 §2.1 `Footer`). No props
 * (reads `FLAGS.commissions` itself); the one fixture is the whole footer — both dry lines since
 * S1.8 ("Not affiliated with Mojang." + "Creators featuring the mods aren't affiliated with
 * odsens.", DESIGN.md §12.2).
 */
import type { FooterProps } from '@/components/layout/Footer';

export type FooterFixture = { label: string; props: FooterProps };

export const footerFixtures: FooterFixture[] = [{ label: 'Footer · static', props: {} }];
