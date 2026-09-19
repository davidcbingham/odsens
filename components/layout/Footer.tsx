import Link from 'next/link';
import { FLAGS } from '@/lib/flags';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { PlatformMark, type PlatformMarkPlatform } from '@/components/primitives/PlatformMark';
import styles from './Footer.module.css';

/**
 * Footer — DESIGN.md §5 Footer, §11.6, §12.2 footer line; 03 §2.1 `Footer`; 02 RP-13.
 * Server, no props: reads `FLAGS.commissions` directly for the "Custom orders" link (01 INV-74).
 * "Find me" rows carry the Modrinth / CurseForge / YouTube marks from S1.2 (03 §2.1 Footer row:
 * "via `PlatformMark` + word") — mark without `withWord` so the slab keeps `role="img"
 * aria-label="<Platform>"` (03 §2.2 `PlatformMark` Tests cell) while the link text stays the
 * word, the `GetItPanel` rows precedent.
 *
 * `FIND_ME` is exported: Home's "Find me" column (02 §2.1 #4, S1.6 — inline in the route per
 * 03 C-21) prints the same three RP-13 links, so the URLs live in ONE list. The footer column
 * itself is unchanged.
 */
export type FooterProps = Record<string, never>;

type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
  /** "Find me" rows only — renders the `PlatformMark` slab before the word (S1.2, 03 §2.1). */
  platform?: PlatformMarkPlatform;
};

/** A "Find me" row — always external, always with its platform mark (02 RP-13). */
export type FindMeLink = FooterLink & { external: true; platform: PlatformMarkPlatform };

/** 02 RP-13 — the three places OddSense posts. Shared by this footer and Home (02 §2.1 #4). */
export const FIND_ME: readonly FindMeLink[] = [
  {
    label: 'Modrinth',
    href: 'https://modrinth.com/user/OddSense/mods',
    external: true,
    platform: 'modrinth',
  },
  {
    label: 'CurseForge',
    href: 'https://www.curseforge.com/members/oddsense/projects',
    external: true,
    platform: 'curseforge',
  },
  {
    label: 'YouTube',
    href: 'https://www.youtube.com/@OdSens',
    external: true,
    platform: 'youtube',
  },
];

const SITE: FooterLink[] = [
  { label: 'Projects', href: '/projects' },
  { label: 'Seen on', href: '/seen-on' },
  ...(FLAGS.commissions ? [{ label: 'Custom orders', href: '/commissions' }] : []),
  { label: 'Support', href: '/support' },
  { label: 'How comments work', href: '/how-comments-work' },
  { label: 'Privacy', href: '/privacy' },
];

function FooterColumn({ title, links }: { title: string; links: readonly FooterLink[] }) {
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
                {link.platform ? <PlatformMark platform={link.platform} size={24} /> : null}
                {link.label}
                <span className="visually-hidden"> (opens in new tab)</span>
              </a>
            ) : (
              <Link href={link.href} className={styles['footer-link']}>
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
