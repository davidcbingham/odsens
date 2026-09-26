import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense, type ReactNode } from 'react';
import { isVercel, nodeEnv } from '@/lib/env';
import { CHART_TITLE } from '@/lib/stats';
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
import { FlatBarChart } from '@/components/primitives/FlatBarChart';
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
import { KofiCard } from '@/components/support/KofiCard';
import { KofiPanelSlot } from '@/components/support/KofiPanelSlot';
import { Leaderboard } from '@/components/support/Leaderboard';
import { FloatingSupportButton } from '@/components/layout/FloatingSupportButton';
import { VersionsTable } from '@/components/projects/VersionsTable';
import { ShortsRow } from '@/components/videos/ShortsRow';
import { UpNextList } from '@/components/videos/UpNextList';
import { VideoCard } from '@/components/videos/VideoCard';
import { VideoFacade } from '@/components/videos/VideoFacade';
import { VideoStage } from '@/components/videos/VideoStage';
import { InTheWildStrip } from '@/components/seen-on/InTheWildStrip';
import { MentionCard } from '@/components/seen-on/MentionCard';
import { MentionPreview } from '@/components/seen-on/MentionPreview';
import { ReachLine } from '@/components/seen-on/ReachLine';
import { SeenOnGrid } from '@/components/seen-on/SeenOnGrid';
import { SeenOnRow } from '@/components/seen-on/SeenOnRow';
import { SkinCard } from '@/components/skins-art/SkinCard';
import { SkinsStageView } from '@/components/skins-art/SkinsStage';
import { SkinViewer3D } from '@/components/skins-art/SkinViewer3D';
import { ArtCard } from '@/components/skins-art/ArtCard';
import { ArtGallery } from '@/components/skins-art/ArtGallery';
import { ArtMasonry } from '@/components/skins-art/ArtMasonry';
import { ArtForm } from '@/components/admin/ArtForm';
import { SkinForm } from '@/components/admin/SkinForm';
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
  kofiCardFixtures,
  kofiPanelSlotFixtures,
  leaderboardFixtures,
  floatingSupportButtonFixtures,
  videoFacadeFixtures,
  videoFacadeLiveStates,
  upNextListFixtures,
  shortsRowFixtures,
  videoCardFixtures,
  videoStageFixtures,
  mentionCardFixtures,
  reachLineFixtures,
  seenOnRowFixtures,
  inTheWildStripFixtures,
  seenOnGridFixtures,
  seenOnDescribedStates,
  mentionPreviewFixtures,
  skinViewer3dFixtures,
  skinCardFixtures,
  skinsStageFixtures,
  skinsDescribedStates,
  artCardFixtures,
  artMasonryFixtures,
  artGalleryFixtures,
  skinFormFixtures,
  artFormFixtures,
  flatBarChartFixtures,
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
            {flatBarChartFixtures.map(({ label, props }, index) => {
              // ADR-0049 D24: the chart renders no heading of its own — the gallery supplies the
              // visually-hidden <h3 id> its SVGs are labelled by, one id per specimen.
              const headingId = `flat-bar-chart-specimen-${index}-title`;
              return (
                <Specimen key={label} name="FlatBarChart" label={label}>
                  <div>
                    <h3 id={headingId} className="visually-hidden">
                      {CHART_TITLE}
                    </h3>
                    <FlatBarChart {...props} titleId={headingId} />
                  </div>
                </Specimen>
              );
            })}
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

        <Area id="area-support" title="SUPPORT">
          <div className={styles['preview-group']} data-wide="">
            {kofiCardFixtures.map(({ label, props }) => (
              <Specimen key={label} name="KofiCard" label={label}>
                {/* The open card (TIP ON KO-FI → Ko-fi iframe in its place) lives on /support — the
                    gallery never frames Ko-fi (01 INV-58). */}
                <KofiCard {...props} />
              </Specimen>
            ))}
            {kofiPanelSlotFixtures.map(({ label, props }) => (
              <Specimen key={label} name="KofiPanelSlot" label={label}>
                <KofiPanelSlot {...props} />
              </Specimen>
            ))}
            {leaderboardFixtures.map(({ label, props }) => (
              <Specimen key={label} name="Leaderboard" label={label}>
                <Leaderboard {...props} />
              </Specimen>
            ))}
            {floatingSupportButtonFixtures.map(({ label, props }) => (
              <Specimen key={label} name="FloatingSupportButton" label={label}>
                <p className={styles['preview-note']}>
                  Fixed to the bottom-right of this page; scroll down and up to see it hide and
                  return.
                </p>
                <FloatingSupportButton {...props} />
              </Specimen>
            ))}
          </div>
        </Area>

        <Area id="area-videos" title="VIDEOS">
          <div className={styles['preview-group']}>
            {videoFacadeFixtures.map(({ label, props }) => (
              <Specimen key={label} name="VideoFacade" label={label}>
                <VideoFacade {...props} />
              </Specimen>
            ))}
            {videoFacadeLiveStates.map(({ label, note }) => (
              <Specimen key={label} name="VideoFacade" label={label}>
                {/* `loading` / `playing` need a live YouTube frame — the gallery never frames
                    YouTube (01 INV-57; ADR-0014 live-state exception): described, not rendered.
                    The `upnext` and `short` variants sit in the UpNextList / ShortsRow specimens
                    below, at their real 132px / 104px widths. */}
                <p className={styles['preview-note']}>{note}</p>
              </Specimen>
            ))}
            {videoCardFixtures.map(({ label, props }) => (
              <Specimen key={label} name="VideoCard" label={label}>
                <VideoCard {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {upNextListFixtures.map(({ label, props }) => (
              <Specimen key={label} name="UpNextList" label={label}>
                <UpNextList {...props} />
              </Specimen>
            ))}
            {shortsRowFixtures.map(({ label, props }) => (
              <Specimen key={label} name="ShortsRow" label={label}>
                <ShortsRow {...props} />
              </Specimen>
            ))}
            {videoStageFixtures.map(({ label, props }) => (
              <Specimen key={label} name="VideoStage" label={label}>
                {/* Reads `?v=` from this page's URL (`/dev/components?v=gallery0003` selects the
                    third video); its Up next rows rewrite it. */}
                <Suspense fallback={null}>
                  <VideoStage {...props} />
                </Suspense>
              </Specimen>
            ))}
          </div>
        </Area>

        {/* ---------------------------------------------------------------- Seen on (03 §2.8) */}
        <Area id="area-seen-on" title="SEEN ON">
          <div className={styles['preview-group']}>
            {mentionCardFixtures.map(({ label, props }) => (
              <Specimen key={label} name="MentionCard" label={label}>
                <MentionCard {...props} />
              </Specimen>
            ))}
            {reachLineFixtures.map(({ label, props }) => (
              <Specimen key={label} name="ReachLine" label={label}>
                <ReachLine {...props} />
              </Specimen>
            ))}
            {seenOnDescribedStates.map(({ name, label, note }) => (
              <Specimen key={label} name={name} label={label}>
                {/* `playing` needs a live YouTube frame — the gallery never frames YouTube (01
                    INV-57; ADR-0014 live-state exception) — and the "renders nothing" states
                    have nothing to show: described, not rendered. */}
                <p className={styles['preview-note']}>{note}</p>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {seenOnRowFixtures.map(({ label, props }) => (
              <Specimen key={label} name="SeenOnRow" label={label}>
                <SeenOnRow {...props} />
              </Specimen>
            ))}
            {inTheWildStripFixtures.map(({ label, props }) => (
              <Specimen key={label} name="InTheWildStrip" label={label}>
                <InTheWildStrip {...props} />
              </Specimen>
            ))}
            {seenOnGridFixtures.map(({ label, props }) => (
              <Specimen key={label} name="SeenOnGrid" label={label}>
                {/* Reads `?platform=` / `?project=` from this page's URL
                    (`/dev/components?platform=tiktok&project=metal-pipe-mace` shows the
                    "NOTHING HERE" state); its filter bar rewrites them. */}
                <Suspense fallback={null}>
                  <SeenOnGrid {...props} />
                </Suspense>
              </Specimen>
            ))}
          </div>

          {/* The admin half of the area (03 §2.8 `MentionPreview` — it lives in `components/seen-on/`). */}
          <div className={styles['preview-group']} data-wide="">
            {mentionPreviewFixtures.map(({ label, props }) => (
              <Specimen key={label} name="MentionPreview" label={label}>
                {/* "Fetch" / PUBLISH call the real `fetchMentionPreview` / `createMention` — signed
                    out they answer with their inline error (interaction-only pending / error
                    states, the SyncStatus precedent). */}
                <MentionPreview {...props} />
              </Specimen>
            ))}
          </div>
        </Area>

        {/* ---------------------------------------------------------------- Skins + Art (03 §2.7) */}
        <Area id="area-skins-art" title="SKINS + ART">
          <div className={styles['preview-group']}>
            {skinViewer3dFixtures.map(({ label, props, note }) => (
              <Specimen key={label} name="SkinViewer3D" label={label}>
                {/* The one WebGL specimen family: the chunk is lazy (03 C-18), the texture is the
                    LOCAL Supabase object of seed-skin-b (SEED-13) — see the fixture header. */}
                {note !== undefined ? <p className={styles['preview-note']}>{note}</p> : null}
                <SkinViewer3D {...props} />
              </Specimen>
            ))}
          </div>

          {/* Skins (03 §2.7 `SkinCard` + the `SkinsStage` island — S1.7 ADR-0048 D13 / ADR-0048 D14 / D15 / ADR-0048 D16). */}
          <div className={styles['preview-group']}>
            {skinCardFixtures.map(({ label, props, note }) => (
              <Specimen key={label} name="SkinCard" label={label}>
                {/* Busts and textures are LOCAL Supabase seed objects (SEED-13); `no bust` is
                    the one card that opens a WebGL context — see the fixture header. */}
                {note !== undefined ? <p className={styles['preview-note']}>{note}</p> : null}
                <SkinCard {...props} />
              </Specimen>
            ))}
            {skinsDescribedStates.map(({ name, label, note }) => (
              <Specimen key={label} name={name} label={label}>
                {/* The page-level empty state: the island is not mounted — described, not rendered. */}
                <p className={styles['preview-note']}>{note}</p>
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {skinsStageFixtures.map(({ label, props, note }) => (
              <Specimen key={label} name="SkinsStageView" label={label}>
                {/* The View takes `selectedSlug` as a prop and reads no URL (the VideoStage
                    precedent) — the gallery shows one fixed selection; card clicks rewrite
                    `?skin=` on this page's URL without re-rendering the specimen. */}
                {note !== undefined ? <p className={styles['preview-note']}>{note}</p> : null}
                <SkinsStageView {...props} />
              </Specimen>
            ))}
          </div>

          {/* Art (03 §2.7 `ArtCard` / `ArtMasonry` + `ArtMasonryLightbox` / the `ArtGallery`
              island — S1.7 ADR-0048 D13 / ADR-0048 D17). Pieces are LOCAL Supabase seed objects (SEED-13) and
              the local brand images — see the fixture header. */}
          <div className={styles['preview-group']}>
            {artCardFixtures.map(({ label, props, note }) => (
              <Specimen key={label} name="ArtCard" label={label}>
                {/* Outside a masonry the link opens the image itself (no delegated listener). */}
                {note !== undefined ? <p className={styles['preview-note']}>{note}</p> : null}
                <ArtCard {...props} />
              </Specimen>
            ))}
          </div>

          <div className={styles['preview-group']} data-wide="">
            {artMasonryFixtures.map(({ label, props, note }) => (
              <Specimen key={label} name="ArtMasonry" label={label}>
                {/* A card click opens the lazy `Lightbox` (03 §3 `open` → `closing` on Esc). */}
                {note !== undefined ? <p className={styles['preview-note']}>{note}</p> : null}
                <ArtMasonry {...props} />
              </Specimen>
            ))}
            {artGalleryFixtures.map(({ label, props, note }) => (
              <Specimen key={label} name="ArtGallery" label={label}>
                {/* Reads `?kind=` from this page's URL (`/dev/components?kind=icon` shows the
                    "NO ART HERE YET" state); its filter bar rewrites it. */}
                {note !== undefined ? <p className={styles['preview-note']}>{note}</p> : null}
                <Suspense fallback={null}>
                  <ArtGallery {...props} />
                </Suspense>
              </Specimen>
            ))}
          </div>

          {/* The admin half of the area (the `/admin/skins` + `/admin/art` form islands — 03 §2.10,
              ADR-0048 D19 / D27 / D19 / D27). Save (and the art well's `begin`) call the real actions —
              signed out they answer with their inline error (interaction-only states, the
              MentionPreview precedent); `edit` pictures are LOCAL Supabase seed objects. */}
          <div className={styles['preview-group']} data-wide="">
            {skinFormFixtures.map(({ label, props }) => (
              <Specimen key={label} name="SkinForm" label={label}>
                <SkinForm {...props} />
              </Specimen>
            ))}
            {artFormFixtures.map(({ label, props }) => (
              <Specimen key={label} name="ArtForm" label={label}>
                <ArtForm {...props} />
              </Specimen>
            ))}
          </div>
        </Area>
      </main>
    </>
  );
}
