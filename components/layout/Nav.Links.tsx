'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Nav.module.css';

/**
 * NavLinks — desktop link row (03 N-03). Client leaf: `usePathname` sets `aria-current="page"`
 * when the pathname is the href or starts with `href + '/'` (02 RP-12). Hidden under 900px.
 */
export type NavLinksProps = {
  links: { label: string; href: string }[];
};

function isCurrentPath(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ links }: NavLinksProps) {
  const pathname = usePathname();
  return (
    <ul className={styles['nav-links']}>
      {links.map((link) => (
        <li key={link.href}>
          <Link
            href={link.href}
            className={styles['nav-link']}
            aria-current={isCurrentPath(pathname, link.href) ? 'page' : undefined}
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
