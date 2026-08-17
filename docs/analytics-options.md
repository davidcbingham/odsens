# Analytics options (Q20) — what's useful for a creator/portfolio site, and how hard on Vercel

| # | What you'd learn | Tool | Effort on Vercel | Notes |
|---|---|---|---|---|
| 1 | Page views, top pages, referrers (where visitors come from — YouTube? Modrinth? Discord?), countries, devices | **Vercel Web Analytics** | **Trivial** — toggle on in Vercel dashboard + add one component | Cookie-less, privacy-friendly, no consent banner needed. Included with Pro plan (event allowance; overage cheap). **Recommended baseline.** |
| 2 | Site speed / Core Web Vitals per page | **Vercel Speed Insights** | **Trivial** — same as above | Helps keep the site snappy on phones. **Recommended.** |
| 3 | Clicks that matter: download-button clicks per project, Modrinth vs CurseForge vs direct, tip-button clicks, video plays, sign-ins | **Vercel Analytics custom events** (`track('download', {project, source})`) | **Easy** — a few one-line calls in the UI | Turns #1 into "which projects drive downloads from *my* site". **Recommended.** |
| 4 | Direct downloads of exclusive files, comments/likes counts, active users | **Our own Supabase tables** (increment on download route; count comments/likes) | **Easy** — part of building those features anyway | Shown on project pages and in the admin. |
| 5 | Growth over time of external numbers: Modrinth + CurseForge downloads per project, YouTube views/subs | **Daily snapshot job** (Vercel Cron → Supabase `stats_daily`) + admin chart | **Moderate** — a cron route + a chart in the admin | Modrinth/YouTube only give *current* totals; storing daily snapshots is the only way to see trends. High value for Oliver ("Metal Pipe Mace jumped after the video"). |
| 6 | Deep behavior: funnels, session replay, heatmaps, feature flags | PostHog / Plausible / Umami | **Moderate** — script + account (Umami/Plausible can self-host on Vercel; PostHog cloud free tier) | Overkill for now; PostHog is nice later if the Custom Orders funnel matters. |
| 7 | Google Analytics 4 | GA4 | **Moderate** + **cookie consent banner** burden (EU visitors) | Not recommended — heavier, privacy tradeoffs, and #1+#3 cover the needs. |
| 8 | Uptime / errors | Vercel logs + Sentry (optional) | Trivial (logs) / Easy (Sentry) | Sentry free tier is fine; add when the site is live. |

**Recommendation:** ship with **1 + 2 + 3 + 4** at launch (all trivial/easy), add **5** as the first post-launch enhancement
(a "Stats" tab in the admin — Oliver will love it), skip 6–7, add Sentry (8) once live.
