# Framework & Stack Decision (Q17)

**Decision: Next.js (App Router, TypeScript) on Vercel + Supabase.** Recorded 2026-08-17. Details and the rejected
alternatives below so the reasoning survives.

## What the spec + DESIGN.md demand of the stack
| Need | Weight |
|---|---|
| Google sign-in, handles, roles (user/mod/admin), server-enforced auth on comments/admin | high |
| File **uploads** (exclusive project files, skins, art) with progress + validation | high |
| An **admin app** (forms, tables, moderation queue, settings, stats) | high |
| Threaded comments + likes, live-ish | high |
| Scheduled **sync jobs** (Modrinth / CurseForge / YouTube) + daily stats snapshots | high |
| Webhook receiver (Ko-fi) | med |
| Mostly-static public pages that should be fast and cacheable | high |
| 3D skin viewer (skinview3d) — client-side WebGL | med |
| A design system that is plain CSS tokens, flat shadows, three self-hosted fonts | — |
| Oliver + Claude Code maintain it; a large ecosystem/knowledge base matters | high |

## Options considered
| | Next.js (App Router) | Astro (+ islands) | SvelteKit / Remix / Nuxt |
|---|---|---|---|
| Vercel fit | first-class (ISR, cron, edge/serverless, Analytics) | good | good |
| Supabase fit | first-class (`@supabase/ssr`, official examples) | fine | fine |
| Auth + admin + uploads + comments | natural — one app, server actions / route handlers | possible, but this much interactive/authenticated UI turns Astro into "React app inside Astro" | fine, smaller ecosystem |
| Static-ish public pages | ISR / `revalidate` + cron sync → cached HTML | best-in-class static | fine |
| Claude Code / community depth | deepest | good | smaller |
| Risk | App Router complexity; keep patterns simple | two mental models (Astro + React) for Oliver | fewer examples for Oliver to lean on |

**Why Next.js wins:** the site is not a content site with a comment widget — it's a content site *plus* an authenticated
app (accounts, admin, uploads, moderation, orders). One framework, one mental model, and the strongest Vercel + Supabase
integration. Astro's static advantage is neutralized by ISR + cron sync; its cost (two frameworks for Oliver) is real.

## Stack
| Layer | Choice | Notes |
|---|---|---|
| Framework | **Next.js 15+ App Router, TypeScript** | Server Components for public pages; Server Actions / Route Handlers for mutations; ISR for project/video pages |
| Styling | **Plain CSS with custom properties** from `DESIGN.md` (CSS Modules per component); **no Tailwind, no UI kit** | The design is tokens + flat rules — a utility framework adds noise and fights the "0 radius / offset shadow" look. Keeps CSS readable for Oliver. |
| Fonts | `next/font/local` — self-hosted Bungee, Space Grotesk, Silkscreen (WOFF2) | per DESIGN.md §2 |
| DB / Auth / Storage | **Supabase** — Postgres + RLS, Auth (Google provider), Storage buckets (`project-files`, `skins`, `art`, `avatars`) | `@supabase/ssr` for cookie sessions; service-role key only in server code |
| Data access | Supabase JS + generated types; SQL migrations in `supabase/migrations/` (Supabase CLI) | Skills wrap the CLI |
| Sync jobs | **Vercel Cron** → route handlers: Modrinth (hourly), CurseForge (hourly), YouTube (hourly), stats snapshot (daily) | Idempotent upserts into `external_*` tables |
| Webhooks | Route handler `/api/webhooks/kofi` verifying `verification_token` | Phase 2 |
| Markdown | `react-markdown` + `remark-gfm`, sanitized | Modrinth bodies + admin write-ups |
| 3D skins | `skinview3d` (client component, lazy) + a build/cron step that renders cached bust PNGs | Skins page + grid |
| Charts | Small hand-rolled flat bar chart (SVG) — matches DESIGN.md; no chart lib | Admin Stats |
| Email | **Resend** (Vercel-friendly, generous free tier) for admin notifications | per-event toggles |
| Analytics | Vercel Web Analytics + Speed Insights + custom events | `docs/analytics-options.md` |
| Errors | Sentry (post-launch) | |
| Lint/format/test | ESLint + Prettier; Vitest for units; Playwright for a few smoke flows | Keep light |
| Package manager | pnpm | |
| Node | 22 LTS | |

## Repo layout (planned)
```
app/            Next.js routes (public + /admin + /api)
components/     UI components mapped 1:1 to DESIGN.md §5/§11
lib/            supabase clients, sync adapters (modrinth/curseforge/youtube), kofi, markdown, auth helpers
styles/         tokens.css (from DESIGN.md), globals.css
supabase/       migrations/, seed.sql, config
public/fonts/   self-hosted WOFF2
.claude/skills/ site-management skills
docs/  design/  assets/brand/  DESIGN.md
```

## Guardrails (so it stays maintainable by Oliver + Claude Code)
- Prefer Server Components + Server Actions; reach for client state only for the viewer, comments composer, uploads, admin forms.
- Every DB table has RLS; the browser only ever uses the anon key.
- Component names and CSS variables mirror `DESIGN.md` names verbatim (`--slab`, `.type-badge`, `.exclusive-badge`).
- No abstraction until it's needed twice.
