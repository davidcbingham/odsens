/**
 * tests/fixtures/ui/avatarUpload.ts — `AvatarUpload` for `/dev/components` (03 §2.5, §3; T-E2E-48).
 * `empty` at 88 and 120, `done` with a stored picture (the brand avatar). `cropping` / `uploading` /
 * `error` are reached by picking a file in the empty specimen (a .svg → error; a PNG → crop step).
 */
import type { AvatarUploadProps } from '@/components/accounts/AvatarUpload';

export type AvatarUploadFixture = { label: string; props: AvatarUploadProps };

export const avatarUploadFixtures: AvatarUploadFixture[] = [
  { label: 'AvatarUpload · empty 88', props: { name: 'avatar', current: null, size: 88 } },
  { label: 'AvatarUpload · empty 120', props: { name: 'avatar', current: null, size: 120 } },
  {
    label: 'AvatarUpload · done 88',
    props: { name: 'avatar', current: '/brand/avatar-160.png', size: 88 },
  },
  {
    label: 'AvatarUpload · done 120',
    props: { name: 'avatar', current: '/brand/avatar-160.png', size: 120 },
  },
];
