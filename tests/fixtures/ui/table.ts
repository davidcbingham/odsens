/**
 * tests/fixtures/ui/table.ts — `Table` states for `/dev/components` (03 §2.2 `Table`; DESIGN.md
 * §5 Admin table). Cell nodes are strings here (no DB, no network); real callers put
 * `StatusPill`s and action buttons in cells (≤ one accent per row is the caller's duty).
 * Empty line per 03 G-05 voice ("No projects yet. Run a sync.").
 */
import type { TableProps } from '@/components/primitives/Table';

export type TableFixture = { label: string; props: TableProps };

const projectColumns: TableProps['columns'] = [
  { key: 'title', header: 'Project' },
  { key: 'type', header: 'Type' },
  { key: 'status', header: 'Status' },
  { key: 'downloads', header: 'Downloads', align: 'end', width: '130px' },
];

export const tableFixtures: TableFixture[] = [
  {
    label: 'Table · rows',
    props: {
      caption: 'Projects',
      columns: projectColumns,
      rowKey: 'title',
      rows: [
        { title: 'Metal Pipe Mace', type: 'Mod', status: 'LIVE', downloads: '3,209' },
        { title: 'Heavy Spear', type: 'Mod', status: 'LIVE', downloads: '2,147' },
        { title: 'Troll Resources', type: 'Resource pack', status: 'HIDDEN', downloads: '812' },
      ],
    },
  },
  {
    label: 'Table · empty',
    props: {
      caption: 'Projects',
      columns: projectColumns,
      rowKey: 'title',
      rows: [],
      empty: 'No projects yet. Run a sync.',
    },
  },
];
