/**
 * lib/markdown.ts — the ONE markdown renderer (01 INV-65 / INV-86; ADR-0002 A12 + #34;
 * 03 §2.2 `Markdown`; 05 T-UNIT-14). Server-only: the `Markdown` Server Component
 * (components/primitives/Markdown.tsx) is a thin wrapper over `renderMarkdown()` and imports
 * nothing from these packages, so they never enter a client bundle (03 C-18).
 *
 * Rules implemented here, all asserted by T-UNIT-14:
 *  - raw HTML is skipped (`skipHtml: true`; `rehype-raw` is banned everywhere — INV-65/INV-86),
 *    which removes `<script>`, `<iframe>`, `<style>` and every `on*=` attribute wholesale;
 *  - `rehype-sanitize` with the GitHub `defaultSchema` runs as defence in depth on the generated
 *    tree (ADR-0002 A12 — on the 01 INV-78 dependency allowlist);
 *  - `urlTransform` allows only `http:`, `https:`, `mailto:` and same-origin relative refs;
 *    `javascript:` and `data:` URLs are dropped (INV-65);
 *  - external (absolute http/https) links always get `target="_blank"
 *    rel="noopener noreferrer nofollow ugc"` plus an `↗` `Icon` (aria-hidden) and the
 *    sr text "(opens in new tab)" (03 `Markdown` a11y row);
 *  - `<img>` only for the 01 INV-54 five-host allowlist (ADR-0002 #34), via `next/image`
 *    (C-29); any other host renders as a plain external link. The wrapper's module CSS is
 *    expected to set `img { width: 100%; height: auto; }` — the intrinsic 1200×675 here is a
 *    placeholder ratio, not a layout decision;
 *  - heading demotion keeps the page's one `h1` (INV-65): `about`/`note` demote h1 → h2,
 *    `changelog` demotes h1/h2 → h4 (03 §2.2 `Markdown` variants);
 *  - a `> NOTE:` blockquote maps to `NoteCallout` (DESIGN.md §6.3 "note callout with a
 *    Silkscreen NOTE tag"), with the `NOTE:` prefix stripped from the body.
 */
import 'server-only';
import { createElement, type ReactElement, type ReactNode, type ComponentProps } from 'react';
import Markdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import Image from 'next/image';
import { Icon } from '@/components/primitives/Icon';
import { NoteCallout } from '@/components/primitives/NoteCallout';
import { env } from '@/lib/env';

export type MarkdownVariant = 'about' | 'changelog' | 'note';

// ---- image host allowlist — 01 INV-54 / ADR-0002 #34 (five hosts, verbatim) ----

const SUPABASE_HOST = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname;

/** The 01 INV-54 hosts: Supabase project host + the four CDN hosts. Widening needs an ADR. */
export const MARKDOWN_IMAGE_HOSTS: readonly string[] = [
  SUPABASE_HOST,
  'cdn.modrinth.com',
  'cdn-raw.modrinth.com',
  'i.ytimg.com',
  'yt3.ggpht.com',
];

const IMAGE_HOST_SET: ReadonlySet<string> = new Set(MARKDOWN_IMAGE_HOSTS);

/** True when `url` is an absolute http(s) URL on an INV-54 host. */
export function isAllowedImageHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return IMAGE_HOST_SET.has(parsed.hostname);
  } catch {
    return false;
  }
}

// ---- URL policy — INV-65: only http:, https:, mailto: (else dropped) ----

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto']);

function urlTransform(value: string): string | null {
  const url = value.trim();
  if (url === '') return null;
  const match = SCHEME_RE.exec(url);
  if (match === null) {
    // No scheme: a relative path / fragment resolves against our own origin — safe.
    // Protocol-relative (`//host`) hides its scheme, so it is dropped like an unknown scheme.
    return url.startsWith('//') ? null : url;
  }
  const scheme = match[1]?.toLowerCase() ?? '';
  return ALLOWED_SCHEMES.has(scheme) ? url : null;
}

// ---- note-callout marker — a tiny rehype pass AFTER sanitize (so no schema widening) ----

type HastNode = {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const NOTE_PREFIX_RE = /^NOTE:\s*/;

/** Marks `<blockquote>`s whose first paragraph starts with `NOTE:` and strips the prefix. */
function markNote(node: HastNode): void {
  const children = node.children ?? [];
  const firstElement = children.find((child) => child.type === 'element');
  if (!firstElement || firstElement.tagName !== 'p') return;
  const firstChild = firstElement.children?.[0];
  if (!firstChild || firstChild.type !== 'text' || typeof firstChild.value !== 'string') return;
  const match = NOTE_PREFIX_RE.exec(firstChild.value);
  if (match === null) return;
  node.properties = { ...node.properties, dataNote: '' };
  const rest = firstChild.value.slice(match[0].length);
  if (rest === '') firstElement.children?.shift();
  else firstChild.value = rest;
}

function rehypeNoteCallout() {
  return (tree: HastNode): void => {
    const walk = (node: HastNode): void => {
      if (node.type === 'element' && node.tagName === 'blockquote') markNote(node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

// ---- element renderers (03 `Markdown` row) ----

type AnchorProps = ComponentProps<'a'> & ExtraProps;
type ImgProps = ComponentProps<'img'> & ExtraProps;
type BlockquoteProps = ComponentProps<'blockquote'> & ExtraProps;
type HeadingProps = ComponentProps<'h1'> & ExtraProps;

const EXTERNAL_RE = /^https?:\/\//i;

/** Strips the react-markdown `node` prop so spreads onto DOM elements stay clean. */
function withoutNode<T extends ExtraProps>(props: T): Omit<T, 'node'> {
  const { node, ...rest } = props;
  void node;
  return rest;
}

/** External link markup: new tab + full rel + ↗ Icon (aria-hidden) + sr "(opens in new tab)". */
function externalAnchor(
  href: string,
  children: ReactNode,
  rest: Record<string, unknown> = {},
): ReactElement {
  return createElement(
    'a',
    { ...rest, href, target: '_blank', rel: 'noopener noreferrer nofollow ugc' },
    children,
    createElement(Icon, { name: 'external', size: 16 }),
    createElement('span', { className: 'visually-hidden' }, '(opens in new tab)'),
  );
}

function MarkdownAnchor(props: AnchorProps): ReactElement {
  const { href, children, ...rest } = withoutNode(props);
  if (typeof href === 'string' && EXTERNAL_RE.test(href)) {
    return externalAnchor(href, children, rest);
  }
  return createElement('a', { ...rest, href }, children);
}

function MarkdownImage(props: ImgProps): ReactNode {
  const { src, alt, title } = props;
  const url = typeof src === 'string' ? src : '';
  if (url === '') return null;
  const altText = typeof alt === 'string' ? alt : '';
  if (isAllowedImageHost(url)) {
    return createElement(Image, {
      src: url,
      alt: altText,
      ...(typeof title === 'string' ? { title } : {}),
      // Placeholder intrinsic ratio; the wrapper CSS makes it responsive (width 100%, height auto).
      width: 1200,
      height: 675,
      sizes: '(max-width: 599px) 100vw, 680px',
    });
  }
  // Disallowed host → the image renders as a plain (external) link — INV-65 / T-UNIT-14.
  return externalAnchor(url, altText.trim() === '' ? url : altText);
}

function MarkdownBlockquote(props: BlockquoteProps): ReactElement {
  const { node, children, ...rest } = props;
  if (node?.properties && 'dataNote' in node.properties) {
    return createElement(NoteCallout, null, children);
  }
  return createElement('blockquote', rest, children);
}

function demoteTo(tag: 'h2' | 'h4') {
  return function DemotedHeading(props: HeadingProps): ReactElement {
    const { children, ...rest } = withoutNode(props);
    return createElement(tag, rest, children);
  };
}

const BASE_COMPONENTS: Components = {
  a: MarkdownAnchor,
  img: MarkdownImage,
  blockquote: MarkdownBlockquote,
};

/** Heading demotion per variant (03 §2.2 `Markdown`; 05 T-UNIT-14). */
const COMPONENTS: Record<MarkdownVariant, Components> = {
  about: { ...BASE_COMPONENTS, h1: demoteTo('h2') },
  note: { ...BASE_COMPONENTS, h1: demoteTo('h2') },
  changelog: { ...BASE_COMPONENTS, h1: demoteTo('h4'), h2: demoteTo('h4') },
};

// ---- renderMarkdown — 03 §2.2: the `Markdown` Server Component wraps exactly this ----

/**
 * Renders sanitised markdown to a React tree. The caller (the `Markdown` Server Component)
 * owns the wrapping element, variant class and all styling; nothing here emits a class of
 * its own except the global `.visually-hidden` sr text on external links.
 */
export function renderMarkdown(source: string, variant: MarkdownVariant = 'about'): ReactElement {
  return createElement(
    Markdown,
    {
      remarkPlugins: [remarkGfm],
      rehypePlugins: [[rehypeSanitize, defaultSchema], rehypeNoteCallout],
      components: COMPONENTS[variant],
      skipHtml: true,
      urlTransform,
    },
    source,
  );
}
