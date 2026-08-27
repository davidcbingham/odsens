/**
 * tests/fixtures/ui/trackedLink.ts — `TrackedLink` for `/dev/components` (03 §2.2 `TrackedLink`;
 * T-E2E-48). S1.2 wires only the `download` event (ADR-0002 A10); payload values verbatim from
 * 04 §5.6 — never a handle, id of a person, email or URL. Children are plain strings so the
 * fixtures stay serialisable across the Server-Component boundary.
 */
import type { TrackedLinkProps } from '@/components/primitives/TrackedLink';

export type TrackedLinkFixture = { label: string; props: TrackedLinkProps };

export const trackedLinkFixtures: TrackedLinkFixture[] = [
  {
    label: 'TrackedLink · download versions',
    props: {
      event: 'download',
      props: { project: 'metal-pipe-mace', source: 'direct', from: 'versions' },
      href: '/api/download/00000000-0000-4000-8000-000000000001',
      download: true,
      children: 'Download',
    },
  },
  {
    label: 'TrackedLink · download new-tab',
    props: {
      event: 'download',
      props: { project: 'metal-pipe-mace', source: 'modrinth', from: 'get-it' },
      href: 'https://modrinth.com/mod/metal-pipe-mace',
      target: '_blank',
      children: 'Modrinth',
    },
  },
];
