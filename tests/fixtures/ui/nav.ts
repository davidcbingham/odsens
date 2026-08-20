/**
 * tests/fixtures/ui/nav.ts — `Nav` for `/dev/components` (03 §2.1 `Nav`, §4). `Nav` takes no props
 * (reads `FLAGS.commissions` itself); the one fixture is the S0 shell. `NavLinks` / `NavMenuButton`
 * are leaves rendered by `Nav`, so their link list is mirrored here for future leaf specimens.
 */
import type { NavProps } from '@/components/layout/Nav';
import type { NavLinksProps } from '@/components/layout/Nav.Links';

export type NavFixture = { label: string; props: NavProps };
export type NavLinksFixture = { label: string; props: NavLinksProps };

export const navFixtures: NavFixture[] = [{ label: 'Nav · shell', props: {} }];

/** DESIGN.md §12.2 order — Projects · Videos · Skins · Art · Seen on; no Commissions in v1. */
export const navLinksFixtures: NavLinksFixture[] = [
  {
    label: 'NavLinks · v1 order',
    props: {
      links: [
        { label: 'Projects', href: '/projects' },
        { label: 'Videos', href: '/videos' },
        { label: 'Skins', href: '/skins' },
        { label: 'Art', href: '/art' },
        { label: 'Seen on', href: '/seen-on' },
      ],
    },
  },
];
