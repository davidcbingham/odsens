/**
 * tests/fixtures/ui/select.ts — `Select` states for `/dev/components` (03 §2.2 `Select`;
 * DESIGN.md §5 Filter bar selects + Admin field). Version options use the 03 V-01 grouped
 * `major.minor.x` labels (`lib/versions.ts groupGameVersions`); sort options mirror
 * 02 §2.2 `parseProjectFilters` (default `downloads`). `onChange` omitted (function):
 * uncontrolled render, as in server-rendered admin forms.
 */
import type { SelectProps } from '@/components/primitives/Select';

export type SelectFixture = { label: string; props: Omit<SelectProps, 'onChange'> };

const versionOptions: SelectProps['options'] = [
  { value: '1.21.x', label: '1.21.x' },
  { value: '1.20.x', label: '1.20.x' },
  { value: 'snapshots', label: 'snapshots' },
];

const sortOptions: SelectProps['options'] = [
  { value: 'downloads', label: 'Downloads' },
  { value: 'updated', label: 'Updated' },
  { value: 'newest', label: 'Newest' },
  { value: 'title', label: 'Title' },
];

export const selectFixtures: SelectFixture[] = [
  {
    label: 'Select · admin',
    props: {
      label: 'Type',
      name: 'type',
      options: [
        { value: 'mod', label: 'Mod' },
        { value: 'datapack', label: 'Datapack' },
        { value: 'resourcepack', label: 'Resource pack' },
        { value: 'plugin', label: 'Plugin' },
      ],
      defaultValue: 'mod',
    },
  },
  {
    label: 'Select · compact version',
    props: {
      label: 'Version',
      name: 'version',
      options: versionOptions,
      defaultValue: '1.21.x',
      compact: true,
    },
  },
  {
    label: 'Select · compact sort',
    props: {
      label: 'Sort',
      name: 'sort',
      options: sortOptions,
      defaultValue: 'downloads',
      compact: true,
    },
  },
  {
    label: 'Select · option disabled',
    props: {
      label: 'Version',
      name: 'version',
      options: [...versionOptions, { value: '1.19.x', label: '1.19.x', disabled: true }],
      defaultValue: '1.21.x',
    },
  },
  {
    label: 'Select · disabled',
    props: {
      label: 'Sort',
      name: 'sort',
      options: sortOptions,
      defaultValue: 'downloads',
      disabled: true,
    },
  },
];
