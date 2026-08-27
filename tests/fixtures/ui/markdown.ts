/**
 * tests/fixtures/ui/markdown.ts — `Markdown` for `/dev/components` (03 §2.2 `Markdown`;
 * T-E2E-48): the `about` variant (h2 Bungee gold, list, external link, `> NOTE:` callout,
 * inline code) and the `changelog` variant (15px, h1/h2 demoted to h4). Sanitisation itself
 * is proven by 05 T-UNIT-14 (tests/unit/markdown.test.ts); no DB, no network.
 */
import type { MarkdownProps } from '@/components/primitives/Markdown';

export type MarkdownFixture = { label: string; props: MarkdownProps };

const ABOUT_SOURCE = [
  '## What it does',
  '',
  'A mace made out of a metal pipe. It does the sound. That is the whole mod.',
  '',
  "### What's in it",
  '',
  '- One mace. Metal. Pipe-shaped.',
  '- The sound, at full volume.',
  '- A recipe. `1 pipe + 1 stick`.',
  '',
  '> NOTE: Works on 1.21. Probably works on 1.20. Untested.',
  '',
  'Made with [Fabric](https://fabricmc.net/).',
].join('\n');

const CHANGELOG_SOURCE = [
  '## v1.3.0',
  '',
  '- The sound is louder.',
  '- Fixed the pipe clipping through shields.',
  '- Removed a duck. It knows what it did.',
].join('\n');

export const markdownFixtures: MarkdownFixture[] = [
  { label: 'Markdown · about', props: { source: ABOUT_SOURCE, variant: 'about' } },
  { label: 'Markdown · changelog', props: { source: CHANGELOG_SOURCE, variant: 'changelog' } },
];
