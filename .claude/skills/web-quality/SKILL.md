---
name: web-quality
description: Front-end engineering standards for odsens.com (Next.js App Router) — Server/Client boundaries, data fetching and caching, bundle discipline, images/fonts, accessibility beyond contrast, Core Web Vitals, route-level loading/error/not-found. Use when building or changing any page or component; the frontend-reviewer agent verifies against it. Distinct from design-fidelity (look) — this is how it's built.
---

# web-quality

## Standards
- **Server Components by default.** `'use client'` only for: skin viewer, comment composer/likes (optimistic), uploads, admin forms with live validation, filter bar interactions. Client components receive data as props; they don't fetch.
- **Data**: fetch in Server Components/route handlers via `lib/`; public pages `revalidate` + tags (see `docs/build/02-routes-and-pages.md`); anything with a session is dynamic.
- **Mutations**: Server Actions from `lib/actions/*` only (contracts in `docs/build/04-server-contracts.md`); forms progressively enhance; `useOptimistic` for likes/comments; return `{ok,error}` and render errors in the design's plain-language style.
- **Bundle**: lazy-load skinview3d, markdown renderer, charts, lightbox; no moment/lodash-style kitchen sinks; check `next build` route table on every PR.
- **Images**: `next/image` with explicit `sizes`; Modrinth/YouTube CDN hosts allow-listed; pixel art (`skins`, icons) rendered with `image-rendering: pixelated` at integer scales; avatars fixed square.
- **Fonts**: `next/font/local` (Bungee, Space Grotesk, Silkscreen WOFF2), `display: swap`, subsetting where possible.
- **Third-party**: YouTube via `youtube-nocookie` behind a click-to-load facade; Ko-fi iframe only on Support behind the wrapper; no analytics beyond Vercel's.
- **A11y**: semantic landmarks; one `h1`; heading order; labels + `aria-describedby` for helper/error text; focus ring per DESIGN.md; skip link; `prefers-reduced-motion`; live region for toasts; dialogs trap focus and restore it.
- **Route files**: every route segment with data has `loading.tsx` (design skeleton), and the app has `error.tsx` + `not-found.tsx` matching DESIGN.md §11.
- **Metadata**: `generateMetadata` per page (title pattern "X — odsens"), OG image (design's OG asset when it exists), canonical.
- **Web Vitals targets**: LCP < 2.5s, CLS < 0.1, INP < 200ms on a mid-range phone.

## Steps
Build the page from `docs/build/02` + `03` → run `pnpm build` and read the route table → run axe + keyboard walk (Playwright) → Lighthouse on the preview → fix → hand to `frontend-reviewer` for the verdict.

## Boundaries & hand-offs
- **Owns:** how UI is engineered. **Does not own:** the look (`design-fidelity`), server contracts (`backend-robustness`), deploy config (`vercel-ops`).
- **Hand off:** contract mismatch → `backend-robustness` · rule conflict with DESIGN.md → `design-fidelity` + `keep-docs` · caching/env questions → `vercel-ops`.
- **Stop & ask:** adding a client-side dependency > 50 KB gz, or any analytics/tracking beyond Vercel.
