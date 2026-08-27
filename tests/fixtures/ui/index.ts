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
