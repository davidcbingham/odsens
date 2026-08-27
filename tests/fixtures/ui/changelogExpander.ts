/**
 * tests/fixtures/ui/changelogExpander.ts — `ChangelogExpander` copy for `/dev/components`
 * (03 §2.3, §3). `children` is server-rendered `Markdown` and the component renders a `<tr>`
 * that only makes sense inside its parent `<table>` (03 C-19), so the page shows it through
 * the `VersionsTable` specimen ("Changes ▾" → open; opening a second closes the first).
 * These rows document the prop shapes the S1.2 call site uses.
 */
import type { ChangelogExpanderProps } from '@/components/projects/ChangelogExpander';

export type ChangelogExpanderFixture = {
  label: string;
  props: Omit<ChangelogExpanderProps, 'children'>;
};

export const changelogExpanderFixtures: ChangelogExpanderFixture[] = [
  {
    label: 'ChangelogExpander · collapsed',
    props: {
      groupName: 'changelog-fixture-project-1', // 'changelog-<projectId>' (03)
      id: 'changelog-v-130',
    },
  },
  {
    label: 'ChangelogExpander · same group',
    props: {
      groupName: 'changelog-fixture-project-1', // one open at a time per group
      id: 'changelog-v-121',
    },
  },
];
