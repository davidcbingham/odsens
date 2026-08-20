/**
 * tests/fixtures/ui/skeleton.ts — `Skeleton` (media 16:9, text lines, custom geometry) and
 * `ProjectCardSkeleton` (count) for `/dev/components` (03 §2.1; DESIGN.md §11.1 Skeleton).
 */
import type { SkeletonProps } from '@/components/layout/Skeleton';
import type { ProjectCardSkeletonProps } from '@/components/layout/ProjectCardSkeleton';

export type SkeletonFixture = { label: string; props: SkeletonProps };
export type ProjectCardSkeletonFixture = { label: string; props: ProjectCardSkeletonProps };

export const skeletonFixtures: SkeletonFixture[] = [
  { label: 'Skeleton · media 16:9', props: { kind: 'media' } },
  { label: 'Skeleton · text 3 lines', props: { kind: 'text', lines: 3 } },
  { label: 'Skeleton · media custom', props: { kind: 'media', width: '240px', height: '120px' } },
  { label: 'Skeleton · text custom', props: { kind: 'text', width: '160px', height: '12px' } },
];

export const projectCardSkeletonFixtures: ProjectCardSkeletonFixture[] = [
  { label: 'ProjectCardSkeleton · count 3', props: { count: 3 } },
];
