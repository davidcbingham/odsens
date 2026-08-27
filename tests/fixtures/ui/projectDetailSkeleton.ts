/**
 * tests/fixtures/ui/projectDetailSkeleton.ts — `ProjectDetailSkeleton` for `/dev/components`
 * (03 §2.1, G-01; T-E2E-48): the `/projects/[slug]/loading.tsx` shell. One state only —
 * skeletons have no props beyond `className`.
 */
import type { ProjectDetailSkeletonProps } from '@/components/layout/ProjectDetailSkeleton';

export type ProjectDetailSkeletonFixture = { label: string; props: ProjectDetailSkeletonProps };

export const projectDetailSkeletonFixtures: ProjectDetailSkeletonFixture[] = [
  { label: 'ProjectDetailSkeleton · loading', props: {} },
];
