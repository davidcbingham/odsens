/**
 * tests/fixtures/ui/nav.ts — `Nav` for `/dev/components` (03 §2.1 `Nav`, §4). `Nav` takes no props
 * (reads `FLAGS.commissions` itself); the one fixture is the S0 shell. `NavLinks` / `NavMenuButton`
 * are leaves rendered by `Nav`, so their link list is mirrored here for future leaf specimens.
 */
import type { NavProps } from '@/components/layout/Nav';
import type { NavLinksProps } from '@/components/layout/Nav.Links';
import type { NavMenuButtonProps } from '@/components/layout/Nav.MenuButton';

export type NavFixture = { label: string; props: NavProps };
export type NavLinksFixture = { label: string; props: NavLinksProps };
export type NavMenuButtonFixture = { label: string; props: NavMenuButtonProps };

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

/**
 * Phone menu (03 N-05/N-08): closed at rest; the smoke spec clicks the burger at 390 and shoots
 * the `components-menu` capture at 390 px for the `data-state="open"` panel (ADR-0004 D3). `panelId` keeps the
 * preview instance's id distinct from the one inside the `Nav` specimen.
 */
export const navMenuButtonFixtures: NavMenuButtonFixture[] = [
  {
    label: 'NavMenuButton · closed (click for open)',
    props: {
      links: navLinksFixtures[0]?.props.links ?? [],
      support: { label: '♥ SUPPORT', href: '/support' },
      panelId: 'nav-menu-preview',
    },
  },
];
