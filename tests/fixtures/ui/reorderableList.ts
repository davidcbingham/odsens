/**
 * tests/fixtures/ui/reorderableList.ts — `ReorderableList` rows for `/dev/components` (03 §2.10
 * `ReorderableList`; ADR-0002 A11). `onReorder` is a function, so a Server Component cannot pass
 * it — the dev page supplies a no-op (or renders descriptive copy, the `InlineConfirm`
 * precedent); the real caller is `/admin/projects` (`curateProject` batch `reorder`). `node`
 * values are strings here; real rows carry title + toggles. The disabled row is the moderator
 * view (§2.10: rendered disabled, `title="Admin only"`, never hidden).
 */
import type { ReorderableListProps } from '@/components/admin/ReorderableList';

export type ReorderableListFixture = {
  label: string;
  props: Omit<ReorderableListProps, 'onReorder'>;
};

const featured: ReorderableListProps['items'] = [
  { id: 'p-1', node: 'Metal Pipe Mace', title: 'Metal Pipe Mace' },
  { id: 'p-2', node: 'Heavy Spear', title: 'Heavy Spear' },
  { id: 'p-3', node: 'Pixel Chameleon', title: 'Pixel Chameleon' },
  { id: 'p-4', node: 'Duck Crosshair', title: 'Duck Crosshair' },
];

export const reorderableListFixtures: ReorderableListFixture[] = [
  {
    label: 'ReorderableList · rest',
    props: { items: featured, label: 'Featured projects' },
  },
  {
    label: 'ReorderableList · single',
    props: { items: featured.slice(0, 1), label: 'Featured projects' },
  },
  {
    label: 'ReorderableList · moderator',
    props: { items: featured, label: 'Featured projects', disabled: true },
  },
];
