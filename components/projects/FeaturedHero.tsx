import Image from 'next/image';
import { Avatar } from '@/components/primitives/Avatar';
import { Button } from '@/components/primitives/Button';
import buttonStyles from '@/components/primitives/Button.module.css';
import { Chip } from '@/components/primitives/Chip';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { TrackedLink } from '@/components/primitives/TrackedLink';
import type { ProjectType } from '@/lib/format/project';
import styles from './FeaturedHero.module.css';

/**
 * FeaturedHero — the Home featured-project takeover (DESIGN.md §6.1; 03 §2.3 `FeaturedHero`;
 * 02 §2.1 #1). Server Component. Indigo hatched slab: badges (`PixelLabel` NEW when the page
 * computed `published_at` < 30 days — ADR-0002 #41; `ExclusiveBadge` lands in S1.3 and is not
 * rendered here yet), 64px Bungee `h1` (36 phone, leading .9), one-line description, gold
 * DOWNLOAD + secondary "See the project", `Chip`s max 4 then `+N` (ADR-0002 #54). Right rail:
 * 16:9 screenshot well + intro strip (`Avatar` 56 + the dry line). `project` null → renders
 * nothing; the fallback ordering (featured → highest downloads) lives in the page (02 §2.1).
 *
 * `isNew` arrives as a prop — the page computes it server-side; no `Date.now()` in render
 * (the `ProfilePanel` precedent: client/render code never reads the clock).
 *
 * DOWNLOAD is a `TrackedLink event="download"` (`{project: slug, source: downloadKind,
 * from:'hero'}` — 04 §5.6). `TrackedLink` renders a bare `<a>` (03 §2.2: "nothing else"), so the
 * gold-button face is an inner `<span>` carrying `Button.module.css`'s `.button` +
 * `data-variant="gold"` — reusing the one gold recipe (03 C-20: never re-implement a gold
 * button) and keeping `data-variant="gold"` in the DOM for 05's hero e2e assertion.
 */
export type FeaturedHeroProject = {
  slug: string;
  title: string;
  description: string;
  type: ProjectType;
  exclusive: boolean;
  /** Computed server-side by the page: `published_at` < 30 days (ADR-0002 #41). */
  isNew: boolean;
  /** Version/loader chips, already ordered by the page. */
  chips: string[];
  downloadHref: string;
  downloadKind: 'direct' | 'modrinth';
};

export type FeaturedHeroProps = {
  project: FeaturedHeroProject | null;
  screenshot: { url: string; alt: string } | null;
};

/** 03 §2.2 `Chip` cap on the hero: 4, then `+N` (V-05, ADR-0002 #54). */
const CHIP_CAP = 4;

const DOWNLOAD_LABEL = 'DOWNLOAD';
const SECONDARY_LABEL = 'See the project';
const NEW_LABEL = 'NEW';
const INTRO_LINE = 'OddSense makes things for Minecraft.';

export function FeaturedHero({ project, screenshot }: FeaturedHeroProps) {
  if (project === null) return null;

  const chips = project.chips.slice(0, CHIP_CAP);
  const overflow = project.chips.length - chips.length;

  return (
    <section className={styles['featured-hero']}>
      <div className={styles['featured-hero-slab']}>
        {project.isNew ? (
          <div className={styles['featured-hero-badges']}>
            {/* `ExclusiveBadge` (S1.3) will sit first in this row; S1.2 heroes are Modrinth-synced. */}
            <PixelLabel size={10} tone="chalk">
              {NEW_LABEL}
            </PixelLabel>
          </div>
        ) : null}
        <h1 className={styles['featured-hero-title']}>{project.title}</h1>
        <p className={styles['featured-hero-description']}>{project.description}</p>
        <div className={styles['featured-hero-cta']}>
          <TrackedLink
            event="download"
            props={{ project: project.slug, source: project.downloadKind, from: 'hero' }}
            href={project.downloadHref}
            className={styles['featured-hero-download']}
          >
            <span
              className={`${buttonStyles.button} ${styles['featured-hero-download-face']}`}
              data-variant="gold"
              data-size="md"
            >
              {DOWNLOAD_LABEL}
            </span>
          </TrackedLink>
          <Button variant="secondary" href={`/projects/${project.slug}`}>
            {SECONDARY_LABEL}
          </Button>
        </div>
        {chips.length > 0 ? (
          <ul className={styles['featured-hero-chips']} aria-label="Versions and loaders">
            {chips.map((chip) => (
              <li key={chip}>
                <Chip label={chip} />
              </li>
            ))}
            {overflow > 0 ? (
              <li>
                <Chip label={`+${overflow}`} />
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      <div className={styles['featured-hero-rail']}>
        <div className={styles['featured-hero-screenshot']}>
          {screenshot ? (
            <Image
              className={styles['featured-hero-screenshot-picture']}
              src={screenshot.url}
              alt={screenshot.alt}
              fill
              sizes="(max-width: 899px) 100vw, 440px"
            />
          ) : null}
        </div>
        <div className={styles['featured-hero-intro']}>
          <Avatar src="/brand/avatar-80.png" alt="OddSense" size={56} />
          <p className={styles['featured-hero-intro-line']}>{INTRO_LINE}</p>
        </div>
      </div>
    </section>
  );
}
