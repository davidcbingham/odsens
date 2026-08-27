/**
 * tests/fixtures/ui/toggle.ts — `Toggle` states for `/dev/components` (03 §2.2 `Toggle`;
 * DESIGN.md §11.1 Square toggle). `onChange` is a function so fixtures omit it — the component
 * renders the input read-only, which is exactly the moderator display state (§2.10). Both
 * accents, both roles, disabled ("COMING LATER" rows).
 */
import type { ToggleProps } from '@/components/primitives/Toggle';

export type ToggleFixture = { label: string; props: Omit<ToggleProps, 'onChange'> };

export const toggleFixtures: ToggleFixture[] = [
  {
    label: 'Toggle · off',
    props: {
      name: 'featured',
      checked: false,
      role: 'switch',
      accent: 'indigo',
      label: 'Featured',
    },
  },
  {
    label: 'Toggle · on indigo',
    props: { name: 'featured', checked: true, role: 'switch', accent: 'indigo', label: 'Featured' },
  },
  {
    label: 'Toggle · on emerald',
    props: {
      name: 'notify_comment',
      checked: true,
      role: 'switch',
      accent: 'emerald',
      label: 'Email on new comment',
    },
  },
  {
    label: 'Toggle · radio on',
    props: {
      name: 'moderation_mode',
      value: 'hold-first',
      checked: true,
      role: 'radio',
      accent: 'indigo',
      label: 'Hold first comment',
    },
  },
  {
    label: 'Toggle · radio off',
    props: {
      name: 'moderation_mode',
      value: 'open',
      checked: false,
      role: 'radio',
      accent: 'indigo',
      label: 'Open comments',
    },
  },
  {
    label: 'Toggle · disabled',
    props: {
      name: 'notify_discord',
      checked: false,
      role: 'switch',
      accent: 'emerald',
      label: 'Discord pings',
      disabled: true,
    },
  },
];
