/**
 * tests/fixtures/ui/footer.ts — `Footer` for `/dev/components` (03 §2.1 `Footer`). No props
 * (reads `FLAGS.commissions` itself); the one fixture is the S0 footer (line 2 arrives in S1.8).
 */
import type { FooterProps } from '@/components/layout/Footer';

export type FooterFixture = { label: string; props: FooterProps };

export const footerFixtures: FooterFixture[] = [{ label: 'Footer · static', props: {} }];
