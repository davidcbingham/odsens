import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { isVercel, nodeEnv } from '@/lib/env';
import { SkipLink } from '@/components/layout/SkipLink';
import { Nav } from '@/components/layout/Nav';
import { NavLinks } from '@/components/layout/Nav.Links';
import { NavMenuButton } from '@/components/layout/Nav.MenuButton';
import { Footer } from '@/components/layout/Footer';
import { Toast } from '@/components/layout/Toast';
import { Skeleton } from '@/components/layout/Skeleton';
import { ProjectCardSkeleton } from '@/components/layout/ProjectCardSkeleton';
import { ProjectDetailSkeleton } from '@/components/layout/ProjectDetailSkeleton';
import { Button } from '@/components/primitives/Button';
import { PixelLabel } from '@/components/primitives/PixelLabel';
import { Icon } from '@/components/primitives/Icon';
import { Avatar } from '@/components/primitives/Avatar';
import { Breadcrumb } from '@/components/primitives/Breadcrumb';
import { Chip } from '@/components/primitives/Chip';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Field } from '@/components/primitives/Field';
import { Markdown } from '@/components/primitives/Markdown';
import { PlatformMark } from '@/components/primitives/PlatformMark';
import { SearchBox } from '@/components/primitives/SearchBox';
import { SectionTitle } from '@/components/primitives/SectionTitle';
import { Select } from '@/components/primitives/Select';
import { SourceSwatch } from '@/components/primitives/SourceSwatch';
import { StatTile } from '@/components/primitives/StatTile';
import { StatusPill } from '@/components/primitives/StatusPill';
import { Table } from '@/components/primitives/Table';
import { Toggle } from '@/components/primitives/Toggle';
import { TrackedLink } from '@/components/primitives/TrackedLink';
import { TypeBadge } from '@/components/primitives/TypeBadge';
import { ActiveFilterChips } from '@/components/projects/ActiveFilterChips';
import { DetailsList } from '@/components/projects/DetailsList';
import { FeaturedHero } from '@/components/projects/FeaturedHero';
import { FilterBar } from '@/components/projects/FilterBar';
import { Gallery } from '@/components/projects/Gallery';
import { GetItPanel } from '@/components/projects/GetItPanel';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { ProjectGrid } from '@/components/projects/ProjectGrid';
import { TipPanel } from '@/components/projects/TipPanel';
import { VersionsTable } from '@/components/projects/VersionsTable';
import { ViewerProvider } from '@/components/accounts/ViewerProvider';
import { ProfileMenu } from '@/components/accounts/ProfileMenu';
import { HandleField } from '@/components/accounts/HandleField';
import { AvatarUpload } from '@/components/accounts/AvatarUpload';
import { OnboardingPanel } from '@/components/accounts/OnboardingPanel';
import { ProfilePanel } from '@/components/accounts/ProfilePanel';
import { BannedDelete } from '@/components/accounts/BannedDelete';
import { GoogleSignInButton } from '@/components/primitives/GoogleSignInButton';
import { NoteCallout } from '@/components/primitives/NoteCallout';
import { AdminGate } from '@/components/admin/AdminGate';
import { AdminShell } from '@/components/admin/AdminShell';
import { SyncStatus } from '@/components/admin/SyncStatus';
import { NotificationMatrix } from '@/components/admin/NotificationMatrix';
import {
  adminGateFixtures,
  adminShellFixtures,
  avatarFixtures,
  bannedDeleteFixtures,
  avatarUploadFixtures,
  buttonFixtures,
  googleSignInButtonFixtures,
  handleFieldFixtures,
  inlineConfirmFixtures,
  noteCalloutFixtures,
  onboardingPanelFixtures,
  profileMenuFixtures,
  profilePanelFixtures,
  footerFixtures,
  iconFixtures,
  navFixtures,
  navLinksFixtures,
  navMenuButtonFixtures,
  pixelLabelFixtures,
  projectCardSkeletonFixtures,
  skeletonFixtures,
  toastFixtures,
  activeFilterChipsFixtures,
  breadcrumbFixtures,
  changelogExpanderFixtures,
  chipFixtures,
  detailsListFixtures,
  emptyStateFixtures,
  featuredHeroFixtures,
  fieldFixtures,
  filterBarFixtures,
  galleryFixtures,
  getItPanelFixtures,
  lightboxFixtures,
  markdownFixtures,
  platformMarkFixtures,
  projectCardFixtures,
  projectDetailSkeletonFixtures,
  projectGridFixtures,
  reorderableListFixtures,
  searchBoxFixtures,
  sectionTitleFixtures,
  selectFixtures,
  sourceSwatchFixtures,
  statTileFixtures,
  statusPillFixtures,
  syncStatusFixtures,
  notificationMatrixFixtures,
  tableFixtures,
  tipPanelFixtures,
  toggleFixtures,
  trackedLinkFixtures,
  typeBadgeFixtures,
  versionsTableFixtures,
} from '@/tests/fixtures/ui';
import styles from './page.module.css';

/**
 * `/dev/components` — dev-only component preview (03 §7; ADR-0002 #44; ADR-0004; 05 T-E2E-48).
 * Renders every 03 §2 component built so far in every 03 §3 state from `tests/fixtures/ui/*`
 * (no DB, no network), grouped by area. Components whose states are internal (HandleField checking /
 * available, AvatarUpload cropping, InlineConfirm open) are reached by interacting with the specimen. Each specimen = `<section data-preview="<Name>">` labelled
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
            {navMenuButtonFixtures.map(({ label, props }) => (
              <Specimen key={label} name="NavMenuButton" label={label}>
                <p className={styles['preview-note']}>
                  Visible under 900px. Tap the burger to open the panel (Esc closes).
                </p>
                {/* A slab bar stands in for the Nav so the absolute panel drops below it. */}
                <div className={styles['preview-menu-host']}>
                  <NavMenuButton {...props} />
                </div>
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

          <div className={styles['preview-group']} data-wide="">
            {projectDetailSkeletonFixtures.map(({ label, props }) => (
              <Specimen key={label} name="ProjectDetailSkeleton" label={label}>
                <ProjectDetailSkeleton {...props} />
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

          <div className={styles['preview-group']}>
            {googleSignInButtonFixtures.map(({ label, props }) => (
              <Specimen key={label} name="GoogleSignInButton" label={label}>
                <GoogleSignInButton {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {noteCalloutFixtures.map(({ label, props }) => (
              <Specimen key={label} name="NoteCallout" label={label}>
                <NoteCallout {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {inlineConfirmFixtures.map(({ label, props }) => (
              <Specimen key={label} name="InlineConfirm" label={label}>
                {/* Render-prop + onConfirm are functions (not passable from this Server Component):
                    the live strip is on the ProfilePanel specimen (Delete account). Copy shown here. */}
                <p className={styles['preview-note']}>
                  {props.question} — {props.confirmLabel} / {props.cancelLabel} ({props.tone})
                </p>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-dense="">
            {typeBadgeFixtures.map(({ label, props }) => (
              <Specimen key={label} name="TypeBadge" label={label}>
                <TypeBadge {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-dense="">
            {statusPillFixtures.map(({ label, props }) => (
              <Specimen key={label} name="StatusPill" label={label}>
                <StatusPill {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-dense="">
            {sourceSwatchFixtures.map(({ label, props }) => (
              <Specimen key={label} name="SourceSwatch" label={label}>
                <SourceSwatch {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-dense="">
            {platformMarkFixtures.map(({ label, props }) => (
              <Specimen key={label} name="PlatformMark" label={label}>
                <PlatformMark {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-dense="">
            {chipFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Chip" label={label}>
                <Chip {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {breadcrumbFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Breadcrumb" label={label}>
                <Breadcrumb {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {fieldFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Field" label={label}>
                <form className={styles['preview-form']}>
                  <Field {...props} />
                </form>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {selectFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Select" label={label}>
                <form className={styles['preview-form']}>
                  <Select {...props} />
                </form>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {toggleFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Toggle" label={label}>
                {/* No `onChange` from this Server Component — the square renders its fixture
                    state; live toggling is on /admin/projects. */}
                <Toggle {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {searchBoxFixtures.map(({ label, props }) => (
              <Specimen key={label} name="SearchBox" label={label}>
                {props.placement === 'nav' ? (
                  <p className={styles['preview-note']}>
                    Renders nothing off /projects (RP-12, usePathname) — exactly what shows here.
                  </p>
                ) : null}
                <SearchBox {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {trackedLinkFixtures.map(({ label, props }) => (
              <Specimen key={label} name="TrackedLink" label={label}>
                <TrackedLink {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {tableFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Table" label={label}>
                <Table {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {markdownFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Markdown" label={label}>
                <Markdown {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {emptyStateFixtures.map(({ label, props }) => (
              <Specimen key={label} name="EmptyState" label={label}>
                <EmptyState {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {sectionTitleFixtures.map(({ label, props }) => (
              <Specimen key={label} name="SectionTitle" label={label}>
                <SectionTitle {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {statTileFixtures.map(({ label, props }) => (
              <Specimen key={label} name="StatTile" label={label}>
                <StatTile {...props} />
              </Specimen>
            ))}
          </div>
        </Area>

        {/* -------------------------------------------------------------- Projects (03 §2.3) */}
        <Area id="area-projects" title="PROJECTS">
          <div className={styles['preview-group']}>
            {projectCardFixtures.map(({ label, props }) => (
              <Specimen key={label} name="ProjectCard" label={label}>
                <ProjectCard {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {projectGridFixtures.map(({ label, props }) => (
              <Specimen key={label} name="ProjectGrid" label={label}>
                <ProjectGrid {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {filterBarFixtures.map(({ label, props }) => (
              <Specimen key={label} name="FilterBar" label={label}>
                <FilterBar {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {activeFilterChipsFixtures.map(({ label, props }) => (
              <Specimen key={label} name="ActiveFilterChips" label={label}>
                <p className={styles['preview-note']}>
                  Reads the URL — add ?type=mod&amp;version=1.21.x to this page to see chips +
                  Clear. No params → renders nothing (its empty behaviour).
                </p>
                <ActiveFilterChips {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {galleryFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Gallery" label={label}>
                <Gallery {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {lightboxFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Lightbox" label={label}>
                {/* onClose / onIndex are functions (not passable from this Server Component):
                    open it through the Gallery specimen above — click the big well; Esc closes. */}
                <p className={styles['preview-note']}>
                  Opens from the Gallery specimen above (click the big well; Esc closes, arrows
                  move). This fixture: {props.images.length}{' '}
                  {props.images.length === 1 ? 'image, arrows hidden' : 'images'}, starting at index{' '}
                  {props.index}.
                </p>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {versionsTableFixtures.map(({ label, props }) => (
              <Specimen key={label} name="VersionsTable" label={label}>
                <VersionsTable {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {changelogExpanderFixtures.map(({ label, props }) => (
              <Specimen key={label} name="ChangelogExpander" label={label}>
                {/* `children` is server-rendered Markdown inside a `<tr>` (03 C-19) — the live
                    expander is in the VersionsTable specimen above ("Changes ▾"). */}
                <p className={styles['preview-note']}>
                  Lives inside VersionsTable above — press Changes ▾ there. Group {props.groupName},
                  row id {props.id}; opening one closes the other in the same group.
                </p>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {getItPanelFixtures.map(({ label, props }) => (
              <Specimen key={label} name="GetItPanel" label={label}>
                <GetItPanel {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {detailsListFixtures.map(({ label, props }) => (
              <Specimen key={label} name="DetailsList" label={label}>
                <DetailsList {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {tipPanelFixtures.map(({ label, props }) => (
              <Specimen key={label} name="TipPanel" label={label}>
                <TipPanel {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {featuredHeroFixtures.map(({ label, props }) => (
              <Specimen key={label} name="FeaturedHero" label={label}>
                <FeaturedHero {...props} />
              </Specimen>
            ))}
          </div>
        </Area>

        {/* -------------------------------------------------------------- Accounts (03 §2.5) */}
        <Area id="area-accounts" title="ACCOUNTS">
          <div className={styles['preview-group']} data-wide="">
            <Specimen name="ViewerProvider" label="ViewerProvider · store">
              <ViewerProvider>
                <p className={styles['preview-note']}>
                  No markup — an external store behind `useViewer()`. `ProfileMenu` below reads it
                  (anon without a session).
                </p>
                <ProfileMenu />
              </ViewerProvider>
            </Specimen>
          </div>

          <div className={styles['preview-group']}>
            {profileMenuFixtures.map(({ label, props }) => (
              <Specimen key={label} name="ProfileMenu" label={label}>
                <div className={styles['preview-menu-host']}>
                  <ProfileMenu {...props} />
                </div>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {handleFieldFixtures.map(({ label, props }) => (
              <Specimen key={label} name="HandleField" label={label}>
                <form className={styles['preview-form']}>
                  <HandleField {...props} />
                </form>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {avatarUploadFixtures.map(({ label, props }) => (
              <Specimen key={label} name="AvatarUpload" label={label}>
                <form className={styles['preview-form']}>
                  <AvatarUpload {...props} />
                </form>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {onboardingPanelFixtures.map(({ label, props }) => (
              <Specimen key={label} name="OnboardingPanel" label={label}>
                <OnboardingPanel {...props} />
              </Specimen>
            ))}
            {profilePanelFixtures.map(({ label, props }) => (
              <Specimen key={label} name="ProfilePanel" label={label}>
                <ProfilePanel {...props} />
              </Specimen>
            ))}
            {bannedDeleteFixtures.map(({ label }) => (
              <Specimen key={label} name="BannedDelete" label={label}>
                <BannedDelete />
              </Specimen>
            ))}
          </div>
        </Area>

        {/* ----------------------------------------------------------------- Admin (03 §2.10) */}
        <Area id="area-admin" title="ADMIN">
          <div className={styles['preview-group']} data-wide="">
            {adminGateFixtures.map(({ label, props }) => (
              <Specimen key={label} name="AdminGate" label={label}>
                <div className={styles['preview-shell-host']}>
                  <AdminGate {...props} />
                </div>
              </Specimen>
            ))}
            {adminShellFixtures.map(({ label, props }) => (
              <Specimen key={label} name="AdminShell" label={label}>
                <div className={styles['preview-shell-host']}>
                  <AdminShell {...props} mainLandmark={false} />
                </div>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']}>
            {reorderableListFixtures.map(({ label, props }) => (
              <Specimen key={label} name="ReorderableList" label={label}>
                {/* `onReorder` is a function (not passable from this Server Component — the
                    InlineConfirm precedent): the live list is on /admin/projects. Copy shown here. */}
                <p className={styles['preview-note']}>
                  {props.label} — {props.items.map((item) => item.title ?? item.id).join(' · ')}
                  {props.disabled
                    ? ' (moderator view: handles disabled, "Admin only")'
                    : ' (Space grabs, arrows move, Space drops, Esc cancels)'}
                </p>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {syncStatusFixtures.map(({ label, props }) => (
              <Specimen key={label} name="SyncStatus" label={label}>
                {/* "Sync now" calls the real `triggerSync` — signed out it answers with its
                    inline error (interaction-only pending/error states, the Toggle precedent). */}
                <SyncStatus {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {notificationMatrixFixtures.map(({ label, props }) => (
              <Specimen key={label} name="NotificationMatrix" label={label}>
                {/* SAVE / Test call the real actions — signed out they answer with their inline
                    error (interaction-only dirty / pending states, the Toggle precedent). The
                    Moderators slot is the page's server-rendered section on /admin/settings. */}
                <NotificationMatrix {...props}>
                  <p className={styles['preview-note']}>
                    Moderators table — server-rendered on /admin/settings.
                  </p>
                </NotificationMatrix>
              </Specimen>
            ))}
          </div>
        </Area>
      </main>
    </>
  );
}
