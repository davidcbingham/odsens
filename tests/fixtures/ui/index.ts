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
