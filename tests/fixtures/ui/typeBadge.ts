/**
 * tests/fixtures/ui/typeBadge.ts — `TypeBadge` for `/dev/components` (03 §2.2; T-E2E-48):
 * all four `project_type` values, glyph + word per DESIGN.md §4/§5 (T-UNIT-31 maps).
 */
import type { TypeBadgeProps } from '@/components/primitives/TypeBadge';
import { PROJECT_TYPES } from '@/lib/format/project';

export type TypeBadgeFixture = { label: string; props: TypeBadgeProps };

export const typeBadgeFixtures: TypeBadgeFixture[] = PROJECT_TYPES.map((type) => ({
  label: `TypeBadge · ${type}`,
  props: { type },
}));
