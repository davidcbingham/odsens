/**
 * tests/fixtures/ui/sourceSwatch.ts — `SourceSwatch` for `/dev/components` (03 §2.2; T-E2E-48):
 * the three fixed source colours (DESIGN.md §11.1) plus a `word` override.
 */
import type { SourceSwatchProps } from '@/components/primitives/SourceSwatch';
import { DOWNLOAD_SOURCES } from '@/lib/format/project';

export type SourceSwatchFixture = { label: string; props: SourceSwatchProps };

export const sourceSwatchFixtures: SourceSwatchFixture[] = [
  ...DOWNLOAD_SOURCES.map((source) => ({
    label: `SourceSwatch · ${source}`,
    props: { source },
  })),
  { label: 'SourceSwatch · custom word', props: { source: 'direct', word: 'odsens' } },
];
