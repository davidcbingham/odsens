/**
 * tests/fixtures/ui/noteCallout.ts — `NoteCallout` for `/dev/components` (03 §2.2; T-E2E-48):
 * the Privacy NOTE (DESIGN.md §12.7 #24) and a custom label.
 */
import type { NoteCalloutProps } from '@/components/primitives/NoteCallout';

export type NoteCalloutFixture = { label: string; props: NoteCalloutProps };

export const noteCalloutFixtures: NoteCalloutFixture[] = [
  {
    label: 'NoteCallout · privacy',
    props: {
      children:
        "Sign-in needs a Google account; Google's age rules apply. You can still download everything without an account.",
    },
  },
  {
    label: 'NoteCallout · custom label',
    props: { label: 'WIP', children: 'Works on 1.21. Probably works on 1.20. Untested.' },
  },
];
