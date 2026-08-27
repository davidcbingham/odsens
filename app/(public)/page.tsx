import type { Metadata } from 'next';
import { Avatar } from '@/components/primitives/Avatar';
import { Button } from '@/components/primitives/Button';
import { FeaturedHero } from '@/components/projects/FeaturedHero';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { getHomeFeatured, isNewProject, listPublishedProjects } from '@/lib/data/projects';
import styles from './page.module.css';

/**
 * Home `/` — S1.2 hero + Featured 4-up (02 §2.1 #1/#2; 00 S1.2.AC7 = 00-O-3 DECIDED;
 * DESIGN.md §6.1). ISR(600) — reads via `lib/data/projects.ts` on the cookie-less anon client
 * only (01 INV-09/INV-12/INV-15); the data cache carries tag `projects` (02 §5/RP-23 — Home's
 * other tags, `videos`/`mentions`, arrive with their data modules in S1.6/S1.8).
 *
 * Sections in DOM order (02 §2.1): 1. `FeaturedHero` (`h1`; NEW badge computed HERE server-side
 * — `published_at` < 30 days, ADR-0002 #41 — so the clock never bakes into the data cache);
 * 2. Featured 4-up (`ProjectCard density="tight"`; next featured by `featured_order`, hero
 * excluded, NO back-fill when anything is featured); later slices append `InTheWildStrip`
 * (S1.8) and Latest videos + `TipPanel` (S1.6/S1.9). Empty state (0 published, pre-first-sync):
 * hero not rendered, intro strip renders alone, Featured hidden (02 §2.1 States; transient).
 *
 * Metadata per 02 RP-05: `title.absolute = 'odsens'`, canonical `/`; description + OG default
 * image inherit from `app/layout.tsx`. Loading: `app/(public)/loading.tsx` (03 G-01).
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: { absolute: 'odsens' },
  alternates: { canonical: '/' },
};

/** 02 §2.1 #1 intro strip line (DESIGN.md §6.1), shared with `FeaturedHero`'s rail. */
const INTRO_LINE = 'OddSense makes things for Minecraft.';

export default async function HomePage() {
  const [{ hero, screenshot, featured }, projects] = await Promise.all([
    getHomeFeatured(),
    listPublishedProjects(),
  ]);

  // 02 §2.1 States — empty (no published projects, pre-first-sync): hero not rendered,
  // intro strip renders alone, Featured hidden (transient; no design).
  if (hero === null) {
    return (
      <section className={styles['home-empty']}>
        <h1 className={styles['home-empty-title']}>ODSENS</h1>
        <div className={styles['home-intro']}>
          <Avatar src="/brand/avatar-80.png" alt="OddSense" size={56} />
          <p className={styles['home-intro-line']}>{INTRO_LINE}</p>
        </div>
      </section>
    );
  }

  const total = projects.length;

  return (
    <div className={styles.home}>
      {/* The ONE page-side assembly step (03 C-17a / FeaturedHero doc): isNew at render time. */}
      <FeaturedHero
        project={{ ...hero, isNew: isNewProject(hero.publishedAt) }}
        screenshot={screenshot}
      />
      {featured.length > 0 ? (
        <section aria-labelledby="featured-projects" className={styles['home-featured']}>
          <div className={styles['home-featured-head']}>
            <h2 id="featured-projects" className={styles['home-featured-title']}>
              FEATURED PROJECTS
            </h2>
            {/* Ghost link per pass-3 Home mockup ("All 18 projects →"); arrow via Button ghost. */}
            <Button variant="ghost" href="/projects">
              All {total} {total === 1 ? 'project' : 'projects'}
            </Button>
          </div>
          <ul className={styles['home-featured-grid']}>
            {featured.map((project) => (
              <li key={project.slug} className={styles['home-featured-item']}>
                <ProjectCard project={project} density="tight" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
