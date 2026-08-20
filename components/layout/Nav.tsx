import Link from 'next/link';
import { FLAGS } from '@/lib/flags';
import { Avatar } from '@/components/primitives/Avatar';
import { Button } from '@/components/primitives/Button';
import { NavLinks } from './Nav.Links';
import { NavMenuButton } from './Nav.MenuButton';
import styles from './Nav.module.css';

/**
 * Nav — sticky top bar (DESIGN.md §5 Nav, §12.2; 03 §4 N-01..N-09). Server shell, no props:
 * the link list is a constant here and `FLAGS.commissions` is read directly (01 INV-74).
 * Client leaves: `NavLinks` (aria-current via usePathname) and `NavMenuButton` (burger + panel).
 */
export type NavProps = Record<string, never>;

export type NavLink = { label: string; href: string };

const LINKS: NavLink[] = [
  { label: 'Projects', href: '/projects' },
  { label: 'Videos', href: '/videos' },
  { label: 'Skins', href: '/skins' },
  { label: 'Art', href: '/art' },
  { label: 'Seen on', href: '/seen-on' },
  ...(FLAGS.commissions ? [{ label: 'Commissions', href: '/commissions' }] : []),
];

const SUPPORT: NavLink = { label: '♥ SUPPORT', href: '/support' };

export function Nav() {
  return (
    <header className={styles.nav}>
      <nav aria-label="Main" className={styles['nav-inner']}>
        <Link href="/" aria-label="odsens home" className={styles['nav-home']}>
          <Avatar src="/brand/avatar-80.png" alt="OddSense" size={40} />
          <span className={styles['nav-wordmark']}>ODSENS</span>
        </Link>

        <NavLinks links={LINKS} />

        <div className={styles['nav-right']}>
          {/* Viewer slot (S1.1): ProfileMenu reading useViewer(); GoogleSignInButton "Sign in" while anon/loading. */}
          <Button variant="gold" size="sm" href={SUPPORT.href} className={styles['nav-support']}>
            {SUPPORT.label}
          </Button>
          <NavMenuButton links={LINKS} support={SUPPORT} />
        </div>
      </nav>
    </header>
  );
}
