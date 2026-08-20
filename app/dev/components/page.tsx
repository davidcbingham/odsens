import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isVercel, nodeEnv } from '@/lib/env';
import { SkipLink } from '@/components/layout/SkipLink';
import { Nav } from '@/components/layout/Nav';
import { NavLinks } from '@/components/layout/Nav.Links';
import { Footer } from '@/components/layout/Footer';
import { Toast } from '@/components/layout/Toast';
import { Skeleton } from '@/components/layout/Skeleton';
import { ProjectCardSkeleton } from '@/components/layout/ProjectCardSkeleton';
import { Button } from '@/components/primitives/Button';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { Icon } from '@/components/primitives/Icon';
import { Avatar } from '@/components/primitives/Avatar';
import { ViewerProvider } from '@/components/accounts/ViewerProvider';
import {
  avatarFixtures,
  buttonFixtures,
  footerFixtures,
  iconFixtures,
  navFixtures,
  navLinksFixtures,
  pixelLabelFixtures,
  projectCardSkeletonFixtures,
  skeletonFixtures,
  toastFixtures,
} from '@/tests/fixtures/ui';
import styles from './page.module.css';

/**
 * `/dev/components` — dev-only component preview (03 §7; ADR-0002 #44; ADR-0004; 05 T-E2E-48).
 * Renders every 03 §2 component built so far in every 03 §3 state from `tests/fixtures/ui/*`
 * (no DB, no network), grouped by area. Each specimen = `<section data-preview="<Name>">` labelled
 * with a `PixelLabel` "<Name> · <state>". Outside the `(public)` layout, so it mounts its own
 * SkipLink / header / `<main id="main">`. `notFound()` on every Vercel deployment (never ships).
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Components',
  robots: { index: false, follow: false },
};

type SpecimenProps = { name: string; label: string; children: ReactNode };

function Specimen({ name, label, children }: SpecimenProps) {
  return (
    <section className={styles['preview-specimen']} data-preview={name} aria-label={label}>
      <PixelLabel as="h3" tone="mute-dim" className={styles['preview-specimen-label']}>
        {label}
      </PixelLabel>
      <div className={styles['preview-specimen-body']}>{children}</div>
    </section>
  );
}

type AreaProps = { id: string; title: string; children: ReactNode };

function Area({ id, title, children }: AreaProps) {
  return (
    <section className={styles['preview-area']} aria-labelledby={id}>
      <h2 id={id} className={styles['preview-area-title']}>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function ComponentsPreviewPage() {
  // 03 §7 / ADR-0004: `notFound()` on a production build running as a Vercel deployment (preview and
  // production alike — 02 SM-32). Local `pnpm start` (05 CI-5 e2e, T-E2E-48) is a production build
  // with `VERCEL_ENV` unset, so the page renders there; `pnpm dev` renders it too.
  if (isVercel && nodeEnv === 'production') notFound();

  return (
    <>
      <SkipLink />
      <header className={styles['preview-header']}>
        <h1 className={styles['preview-title']}>COMPONENTS</h1>
        <p className={styles['preview-line']}>
          Every component built so far, in every state. Local only.
        </p>
      </header>
      <main id="main" tabIndex={-1} className={styles.preview}>
        {/* ---------------------------------------------------------------- Layout (03 §2.1) */}
        <Area id="area-layout" title="LAYOUT">
          <div className={styles['preview-group']} data-wide="">
            <Specimen name="SkipLink" label="SkipLink · focus">
              <p className={styles['preview-note']}>
                Hidden until it has keyboard focus. Press Tab from the top of the page.
              </p>
              <SkipLink />
            </Specimen>
            {navFixtures.map(({ label }) => (
              <Specimen key={label} name="Nav" label={label}>
                <Nav />
              </Specimen>
            ))}
            {navLinksFixtures.map(({ label, props }) => (
              <Specimen key={label} name="NavLinks" label={label}>
                <NavLinks {...props} />
              </Specimen>
            ))}
            {footerFixtures.map(({ label }) => (
              <Specimen key={label} name="Footer" label={label}>
                <Footer />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {toastFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Toast" label={label}>
                <Toast {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {skeletonFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Skeleton" label={label}>
                <div className={styles['preview-skeleton-well']} aria-busy="true">
                  <p className="visually-hidden">Loading…</p>
                  <Skeleton {...props} />
                </div>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {projectCardSkeletonFixtures.map(({ label, props }) => (
              <Specimen key={label} name="ProjectCardSkeleton" label={label}>
                <ProjectCardSkeleton {...props} />
              </Specimen>
            ))}
          </div>
        </Area>

        {/* ------------------------------------------------------------ Primitives (03 §2.2) */}
        <Area id="area-primitives" title="PRIMITIVES">
          <div className={styles['preview-group']}>
            {buttonFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Button" label={label}>
                <Button {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {pixelLabelFixtures.map(({ label, props }) => (
              <Specimen key={label} name="PixelLabel" label={label}>
                <PixelLabel {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-dense="">
            {iconFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Icon" label={label}>
                <Icon {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {avatarFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Avatar" label={label}>
                <Avatar {...props} />
              </Specimen>
            ))}
          </div>
        </Area>

        {/* -------------------------------------------------------------- Accounts (03 §2.5) */}
        <Area id="area-accounts" title="ACCOUNTS">
          <div className={styles['preview-group']} data-wide="">
            <Specimen name="ViewerProvider" label="ViewerProvider · context">
              <ViewerProvider>
                <p className={styles['preview-note']}>
                  Context only, no markup. The viewer slot in the nav arrives in S1.1.
                </p>
              </ViewerProvider>
            </Specimen>
          </div>
        </Area>
      </main>
    </>
  );
}
