/**
 * tests/fixtures/ui — component fixture data for `/dev/components` (03 §7, ADR-0004; 05 T-E2E-48).
 * One file per component: typed `{ label: string; props: <Name>Props }[]`; no DB, no network.
 * Each slice appends its components here.
 */
export { buttonFixtures, type ButtonFixture } from './button';
export { pixelLabelFixtures, type PixelLabelFixture } from './pixelLabel';
export { iconFixtures, type IconFixture } from './icon';
export { avatarFixtures, type AvatarFixture } from './avatar';
export {
  navFixtures,
  navLinksFixtures,
  navMenuButtonFixtures,
  type NavFixture,
  type NavLinksFixture,
  type NavMenuButtonFixture,
} from './nav';
export { footerFixtures, type FooterFixture } from './footer';
export { toastFixtures, type ToastFixture } from './toast';
export {
  skeletonFixtures,
  projectCardSkeletonFixtures,
  type SkeletonFixture,
  type ProjectCardSkeletonFixture,
} from './skeleton';
// ---- S1.1 Accounts ----
export { googleSignInButtonFixtures, type GoogleSignInButtonFixture } from './googleSignInButton';
export { noteCalloutFixtures, type NoteCalloutFixture } from './noteCallout';
export { inlineConfirmFixtures, type InlineConfirmFixture } from './inlineConfirm';
export { handleFieldFixtures, type HandleFieldFixture } from './handleField';
export { avatarUploadFixtures, type AvatarUploadFixture } from './avatarUpload';
export { profileMenuFixtures, type ProfileMenuFixture } from './profileMenu';
export { onboardingPanelFixtures, type OnboardingPanelFixture } from './onboardingPanel';
export { profilePanelFixtures, type ProfilePanelFixture } from './profilePanel';
export { bannedDeleteFixtures, type BannedDeleteFixture } from './bannedDelete';
export { adminGateFixtures, type AdminGateFixture } from './adminGate';
export { adminShellFixtures, type AdminShellFixture } from './adminShell';
// ---- S1.2 Layout ----
export {
  projectDetailSkeletonFixtures,
  type ProjectDetailSkeletonFixture,
} from './projectDetailSkeleton';
// ---- S1.2 Primitives ----
export { breadcrumbFixtures, type BreadcrumbFixture } from './breadcrumb';
export { chipFixtures, type ChipFixture } from './chip';
export { emptyStateFixtures, type EmptyStateFixture } from './emptyState';
export { fieldFixtures, type FieldFixture } from './field';
export { markdownFixtures, type MarkdownFixture } from './markdown';
export { platformMarkFixtures, type PlatformMarkFixture } from './platformMark';
export { searchBoxFixtures, type SearchBoxFixture } from './searchBox';
export { selectFixtures, type SelectFixture } from './select';
export { sourceSwatchFixtures, type SourceSwatchFixture } from './sourceSwatch';
export { statusPillFixtures, type StatusPillFixture } from './statusPill';
export { tableFixtures, type TableFixture } from './table';
export { toggleFixtures, type ToggleFixture } from './toggle';
export { trackedLinkFixtures, type TrackedLinkFixture } from './trackedLink';
export { typeBadgeFixtures, type TypeBadgeFixture } from './typeBadge';
// ---- S1.2 Projects ----
export { activeFilterChipsFixtures, type ActiveFilterChipsFixture } from './activeFilterChips';
export { changelogExpanderFixtures, type ChangelogExpanderFixture } from './changelogExpander';
export { detailsListFixtures, type DetailsListFixture } from './detailsList';
export { featuredHeroFixtures, type FeaturedHeroFixture } from './featuredHero';
export { filterBarFixtures, type FilterBarFixture } from './filterBar';
export { galleryFixtures, type GalleryFixture } from './gallery';
export { getItPanelFixtures, type GetItPanelFixture } from './getItPanel';
export { lightboxFixtures, type LightboxFixture } from './lightbox';
export { projectCardFixtures, type ProjectCardFixture } from './projectCard';
export { projectGridFixtures, type ProjectGridFixture } from './projectGrid';
export { tipPanelFixtures, type TipPanelFixture } from './tipPanel';
export { versionsTableFixtures, type VersionsTableFixture } from './versionsTable';
// ---- S1.2 Admin ----
export { reorderableListFixtures, type ReorderableListFixture } from './reorderableList';
