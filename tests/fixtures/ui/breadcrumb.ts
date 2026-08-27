/**
 * tests/fixtures/ui/breadcrumb.ts — `Breadcrumb` for `/dev/components` (03 §2.2 `Breadcrumb`;
 * T-E2E-48): the project-detail trail (DESIGN.md §6 #3) and a one-level trail.
 */
import type { BreadcrumbProps } from '@/components/primitives/Breadcrumb';

export type BreadcrumbFixture = { label: string; props: BreadcrumbProps };

export const breadcrumbFixtures: BreadcrumbFixture[] = [
  {
    label: 'Breadcrumb · project detail',
    props: {
      items: [
        { label: 'Projects', href: '/projects' },
        { label: 'Mods', href: '/projects?type=mod' },
        { label: 'Metal Pipe Mace' },
      ],
    },
  },
  {
    label: 'Breadcrumb · one level',
    props: {
      items: [{ label: 'Projects', href: '/projects' }, { label: 'Heavy Spear' }],
    },
  },
  {
    label: 'Breadcrumb · linked current',
    props: {
      items: [
        { label: 'Projects', href: '/projects' },
        { label: 'Metal Pipe Mace', href: '/projects/metal-pipe-mace' },
      ],
    },
  },
];
