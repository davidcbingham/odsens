import Link from 'next/link';
import { FLAGS } from '@/lib/flags';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import styles from './Footer.module.css';

/**
 * Footer — DESIGN.md §5 Footer, §11.6, §12.2 footer line; 03 §2.1 `Footer`; 02 RP-13.
 * Server, no props: reads `FLAGS.commissions` directly for the "Custom orders" link (01 INV-74).
 */
export type FooterProps = Record<string, never>;

type FooterLink = { label: string; href: string; external?: boolean; prefetch?: false };

// PlatformMark (Modrinth / CurseForge / YouTube marks) joins these rows in S1.2 (03 §2.2).
const FIND_ME: FooterLink[] = [
  { label: 'Modrinth', href: 'https://modrinth.com/user/OddSense/mods', external: true },
  {
    label: 'CurseForge',
    href: 'https://www.curseforge.com/members/oddsense/projects',
    external: true,
  },
  { label: 'YouTube', href: 'https://www.youtube.com/@OdSens', external: true },
];

const SITE: FooterLink[] = [
  { label: 'Projects', href: '/projects' },
  { label: 'Seen on', href: '/seen-on' },
  ...(FLAGS.commissions ? [{ label: 'Custom orders', href: '/commissions' }] : []),
  { label: 'Support', href: '/support' },
  // S1.1 ships these two pages — until then no prefetch, so the footer does not request a 404 on every page.
  { label: 'How comments work', href: '/how-comments-work', prefetch: false },
  { label: 'Privacy', href: '/privacy', prefetch: false },
];

function FooterColumn({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div className={styles['footer-column']}>
      <h2 className="visually-hidden">{title}</h2>
      <span aria-hidden="true">
        <PixelLabel tone="mute-dim" as="span">
          {title}
        </PixelLabel>
      </span>
      <ul className={styles['footer-list']}>
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a
                href={link.href}
                className={styles['footer-link']}
                target="_blank"
                rel="noopener noreferrer"
              >
                {link.label}
                <span className="visually-hidden"> (opens in new tab)</span>
              </a>
            ) : (
              <Link href={link.href} className={styles['footer-link']} prefetch={link.prefetch}>
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles['footer-inner']}>
        <div className={styles['footer-brand']}>
          <p className={styles['footer-wordmark']}>ODSENS</p>
          <p className={styles['footer-line']}>
            Mods and other odd things, made by OddSense. Not affiliated with Mojang.
          </p>
          {/* S1.8 adds the second dry line: "Creators featuring the mods aren't affiliated with odsens." */}
        </div>
        <FooterColumn title="Find me" links={FIND_ME} />
        <FooterColumn title="Site" links={SITE} />
      </div>
    </footer>
  );
}
