import Image from 'next/image';
import Link from 'next/link';
import { Chip } from '@/components/primitives/Chip';
import { TypeBadge } from '@/components/primitives/TypeBadge';
import { ExclusiveBadge } from '@/components/primitives/ExclusiveBadge';
import { formatCount, formatCountFull } from '@/lib/format/number';
import type { ProjectType } from '@/lib/format/project';
import styles from './ProjectCard.module.css';

/**
 * ProjectCard — DESIGN.md §5 "Project card" (chips cap §12.7 #54); 03 §2.3 `ProjectCard` row;
 * 00 S1.2.AC4. Server Component (03 C-16: not on the C-16a list).
 *
 * Slab, 2px `--line-soft` outline, icon 64px (56 tight, 52 phone) in an `--ink` well with its own
 * 2px `--line` border, Bungee title, one-line `--mute` description, ≤2 chips then `+N`
 * (ADR-0002 #54), footer strip (`--slab-foot`, 2px top `--line`) with `TypeBadge` left and the
 * download count right in Silkscreen `--emerald` (≥11px — 03 C-27 informational). Hover /
 * focus-within: `--slab-raised` fill, `--indigo-lift` outline, `6px 6px 0 --indigo-deep`,
 * translate −3/−3. Whole card is ONE link; the badge is not separately clickable.
 * `data-exclusive` marks the gold outline and pins the `ExclusiveBadge` top-left, overlapping
 * the outline by 1px (DESIGN.md §5; 00 S1.3.AC1) — the badge sits OUTSIDE the `<a>`, inside the
 * `<article>`, so the whole card stays one link. Never rendered unless `exclusive` (the
 * `isExclusive` predicate computed upstream — 00 S1.3.AC8).
 */
export type ProjectCardProps = {
  project: {
    slug: string;
    title: string;
    description: string;
    iconUrl: string | null;
    type: ProjectType;
    /** Versions/loaders, already ordered by the page. */
    chips: string[];
    downloadsTotal: number;
    exclusive: boolean;
  };
  /** `tight` drops the icon well 64→56 (03 `ProjectCard` row). */
  density?: 'default' | 'tight';
  className?: string;
};

/** Chips per card: 2, then `+N` (V-05, ADR-0002 #54; DESIGN.md §12.7 #54). */
const CHIP_CAP = 2;

export function ProjectCard({ project, density = 'default', className }: ProjectCardProps) {
  const { slug, title, description, iconUrl, type, chips, downloadsTotal, exclusive } = project;
  const shown = chips.slice(0, CHIP_CAP);
  const overflow = chips.length - shown.length;
  const rootClass = className ? `${styles['project-card']} ${className}` : styles['project-card'];

  return (
    <article
      className={rootClass}
      data-density={density}
      {...(exclusive ? { 'data-exclusive': '' } : {})}
    >
      {exclusive ? <ExclusiveBadge className={styles['project-card-badge']} /> : null}
      <Link href={`/projects/${slug}`} className={styles['project-card-link']}>
        <div className={styles['project-card-body']}>
          <span className={styles['project-card-icon']} aria-hidden={iconUrl === null || undefined}>
            {iconUrl !== null ? (
              <Image src={iconUrl} alt={`${title} icon`} width={64} height={64} sizes="64px" />
            ) : null}
          </span>
          <div className={styles['project-card-text']}>
            <h3 className={styles['project-card-title']}>{title}</h3>
            <p className={styles['project-card-desc']}>{description}</p>
            {shown.length > 0 ? (
              <div className={styles['project-card-chips']}>
                {shown.map((chip) => (
                  <Chip key={chip} label={chip} />
                ))}
                {overflow > 0 ? <Chip label={`+${overflow}`} /> : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className={styles['project-card-foot']}>
          <TypeBadge type={type} />
          <span className={styles['project-card-count']}>
            <span aria-hidden="true">{formatCount(downloadsTotal)} ↓</span>
            <span className="visually-hidden">{formatCountFull(downloadsTotal)} downloads</span>
          </span>
        </div>
      </Link>
    </article>
  );
}
