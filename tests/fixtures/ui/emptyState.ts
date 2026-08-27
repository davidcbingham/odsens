/**
 * tests/fixtures/ui/emptyState.ts — `EmptyState` for `/dev/components` (03 §2.2 `EmptyState`;
 * T-E2E-48). Copy verbatim from DESIGN.md §11.7: /projects "NOTHING MATCHES / Try fewer
 * filters." → Clear filters (05 T-E2E-2), plus a no-action state and an `as="h3"` state.
 */
import type { EmptyStateProps } from '@/components/primitives/EmptyState';

export type EmptyStateFixture = { label: string; props: EmptyStateProps };

export const emptyStateFixtures: EmptyStateFixture[] = [
  {
    label: 'EmptyState · projects filtered',
    props: {
      title: 'NOTHING MATCHES',
      line: 'Try fewer filters.',
      action: { label: 'Clear filters', href: '/projects', variant: 'ghost' },
    },
  },
  {
    label: 'EmptyState · no action',
    props: {
      title: 'NO SKINS YET',
      line: 'Working on it. Check the projects meanwhile.',
    },
  },
  {
    label: 'EmptyState · h3 heading',
    props: {
      as: 'h3',
      title: 'NO ART HERE YET',
      line: 'Nothing in this filter. Try "all".',
      action: { label: 'Show all', href: '/art' },
    },
  },
];
