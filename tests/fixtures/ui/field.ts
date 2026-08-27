/**
 * tests/fixtures/ui/field.ts — `Field` states for `/dev/components` (03 §2.2 `Field`; DESIGN.md
 * §5 Admin field). Error copy is DESIGN.md's verbatim plain-words example. The counter row shows
 * the render-time `n / max`; live counting needs a client parent controlling `inputProps.value`.
 */
import type { FieldProps } from '@/components/primitives/Field';

export type FieldFixture = { label: string; props: FieldProps };

export const fieldFixtures: FieldFixture[] = [
  {
    label: 'Field · rest',
    props: {
      label: 'Title',
      name: 'title',
      defaultValue: 'Metal Pipe Mace',
      helper: 'Shown on the card and the page.',
    },
  },
  {
    label: 'Field · invalid',
    props: {
      label: 'Download count',
      name: 'download_count',
      type: 'number',
      defaultValue: 'twelve',
      error: 'Needs to be a number. Digits only.',
    },
  },
  {
    label: 'Field · counter',
    props: {
      label: 'Description',
      name: 'description',
      defaultValue: 'Long reach, real weight, no shield.',
      maxLength: 140,
      counter: true,
    },
  },
  {
    label: 'Field · prefix',
    props: {
      label: 'Source',
      name: 'source_url',
      type: 'url',
      prefix: 'https://',
      defaultValue: 'github.com/odsens/heavy-spear',
    },
  },
  {
    label: 'Field · textarea',
    props: {
      label: 'Notes',
      name: 'notes',
      type: 'textarea',
      helper: 'Admin-only. Never shown on the site.',
    },
  },
  {
    label: 'Field · disabled',
    props: {
      label: 'Slug',
      name: 'slug',
      defaultValue: 'metal-pipe-mace',
      disabled: true,
      helper: 'Set by the sync.',
    },
  },
];
