# tests/fixtures — recorded upstream responses + hand-made binaries

Policy: `docs/build/05-test-plan.md` §2 (F-1..F-8). Adapters and jobs are tested **only** against these files
(H-5); nothing here is fetched at test time.

| Dir | Contents | Arrives |
|---|---|---|
| `modrinth/` `curseforge/` | recorded API JSON per F-5 (`user-projects.json`, `project-*.json`, `versions*.json`, `error-*.json`; `mod.json`, `search.json`, `error-403/404.json`). S1.5a (ADR-0037 D10): `project/sd000101.json` (the `sd000101` object of `user-projects.json`, byte-equal — an alias for the adapter's `GET /project/{id}`) and `project/sd000199.json` (hand-made from the same shape: id `sd000199`, slug `e2e-cross-post`, title `E2E Cross Post`, 4321 downloads, `versions: []` — a listing absent from the 18-project list, so no sync run ever imports it; no `.meta.json`, like the S1.5 discord/resend shapes); `versions-adopt.json` (hand-made, `versions.json` shape, listing `sd000197` versions `sdv00901..sdv00907` — the T-ACT-82 adoption / tie-break / re-parent set) and `versions-modrinth-first.json` (hand-made, `sd000102` version `sdv00499` `9.9.0` — adoption on a Modrinth-first row); neither has a `.meta.json`. | S1.2 / S1.5a |
| `youtube/` | `rss.xml`, `rss-malformed.xml`, `videos-list.json`, `playlist-items.json`, `channels.json`, `oembed.json`, `videos-mentions.json` (+ the aliases `videos.json`, `playlistItems.json` — below). **Hand-made** in the public upstream shapes (Atom feed with `yt:videoId` / `media:group`; Data API `videos.list` / `playlistItems.list` / `channels.list` with counts as strings; YouTube oEmbed) — not recordings, no `.meta.json`, nothing scrubbed because nothing was recorded: the Data API is key-authenticated (F-7) and the test channel `UCseedchannel000000000000` does not exist (ADR-0043). One fictional channel of **21 uploads** `fixvid00001..fixvid00021` — never a `seedvid…` id, and every `publishedAt` (2026-01-17 … 2026-05-30) is older than SEED-11's oldest row, so a sync over these files never changes which seed video is newest. `videos-list.json` carries all 21: `…08` `liveBroadcastContent: live` and `…09` `upcoming` (dropped by `listVideos` → 19 mapped), Shorts `…03` (`PT45S`), `…04` (`#shorts` in the title, `PT1M30S`), `…05` (`#Shorts` in the description, `PT2M`) → 16 long; `…06` has no `statistics`, `…07` no `likeCount`, `…11` an empty description, `…20` only a `default` thumbnail, `…21` is `PT1M1S` (61 s, long). `rss.xml` = the newest 15 (`…01..…15`, live + upcoming included — the feed has no live flag); the `…03` entry's `media:thumbnail` is on `i3.ytimg.com` (the job must ignore it — 04 §3.3 step 1), `…01`'s title carries `&amp;`. `rss-malformed.xml` = the same feed cut off inside the first entry. `playlist-items.json` = all 21 ids on ONE page (no `nextPageToken`; paging variants are derived in memory, F-6). `channels.json` = the channel's `statistics`. `videos-mentions.json` (`fixmen00001..2`, another creator's channel) and `oembed.json` (`fixmen00001`) back the S1.8 mention paths. S1.8 (ADR-0045): `videos/seedvid0009.json` — hand-made, `videos.list` shape, ONE item `seedvid0009` ("I tried the Metal Pipe Mace in hardcore", channel `Fixture Creator` / `UCfixturecreator000000001`, `2026-07-04T15:00:00Z`, 48213 views, `i.ytimg.com` thumbnails, not live); no `.meta.json`. It is the one `seedvid…` id in this directory and lives OUTSIDE the 21-upload set on purpose: it is what the e2e mention preview pastes (05 T-E2E-39, `getVideoMeta`), served only through the single-`id` rule below, and it must never be added to `videos-list.json` / `videos.json` (a sync would insert it into `videos`; `tests/unit/adapters/youtube.test.ts` asserts it is absent). | S1.6 (mentions consumed S1.8) |
| `oembed/` | `og-page.html`, `no-og.html`, `tiktok.html` — the Open Graph reader's pages (05 T-ADP-16, T-ACT-62). **Hand-made**, not recordings, no `.meta.json` (a recorded article / TikTok page would carry real names, tracking ids and inline scripts — F-2/F-7); every host is fictional (`*.example`) except the SEED-10 TikTok URL. `og-page.html`: a full head — `og:title` with `&amp;`, `&#39;` and a run of spaces, a DIFFERENT `<title>` (precedence), `og:site_name` written `name='…'` in single quotes with `content` first, `<META PROPERTY=… CONTENT=article>` upper-case + unquoted, `og:image` / `og:url` absolute https, a second `og:title` that must lose, decoy tags inside an HTML comment, a `<script>` string and a `<style>` rule, and `article:published_time` (`+02:00`) on a `<meta>` inside `<body>`. `no-og.html`: no `og:*` at all, a multi-line `<title>` with `&mdash;`. `tiktok.html`: TikTok-shaped head (`og:site_name` TikTok, `og:type` `video.other`, `og:url` = the SEED-10 url `https://www.tiktok.com/@seedtok/video/1`, an `og:image` whose query carries `&amp;`, no `article:published_time`) + a rehydration-JSON `<script>` holding a decoy tag. The files pass `prettier --check` (it formats `.html`); the three hand-shaped tags sit under `<!-- prettier-ignore -->` so they stay exotic. Variants prettier cannot even parse (an unquoted URL value) and everything hostile — redirect chains, > 1 MB bodies, other media types, broken markup — are derived in memory by the tests (F-6). | S1.8 |
| `discord/` `resend/` | `webhook-ok.json` (the message object a `?wait=true` post returns), `429.json` (`retry_after: 250`, ms per 04 §4.6), POST alias `webhooks/123.json` (= `webhook-ok.json` byte for byte) · `send-ok.json` (`{id}`), `422.json` (Resend `validation_error`) (+ `__snapshots__/` for T-ADP-19). Hand-made minimal shapes (04 §4.5/§4.6), not recordings — no `.meta.json`. | S1.5 |
| `files/` | hand-made binaries ≤ 100 KB (F-4): `png-as.jar` (PNG bytes, `.jar` name — S1.1); `pack.zip`, `bad.exe` | S1.1 / S1.3 |
| `images/` | hand-made PNG/JPG/WEBP/SVG/GIF ≤ 100 KB per F-4. S1.1: `avatar-600.png` (600×600 RGBA + tEXt metadata), `tiny.jpg` (32×32, below the 64×64 avatar minimum), `exif.jpg` (128×96, EXIF Orientation=6), `tiny.webp` (1×1 lossless), `bad.svg`, `bad.gif` (1×1). Later: `icon-256.png`, `skin-64.png`, … | S1.1 (avatar) / S1.3 |
| `emails/` | React Email render snapshots (`__snapshots__/`) | S1.5 |
| `ui/` | `*.ts` component fixture data for `/dev/components` (03 O-1; T-E2E-48) | S0 onward |
| `kofi/` | Phase 2 (S2.1) | — |

Recording: `node scripts/record-fixture.mjs <adapter> <name> <url>` (human-run, once; writes `<name>.json|.xml|.html`
+ `<name>.meta.json {url, recorded_at, scrubbed}`) — then scrub per F-2 (no emails, real names, IPs, tokens, keys,
`Set-Cookie`, request ids; Modrinth `team`/`members` → `user.username` only; YouTube drops `contentOwnerDetails`),
set `scrubbed: true`, and list what was scrubbed in the PR. Recording anything with PII or from an authenticated
endpoint is a stop-and-ask (F-7).

Checks: `node scripts/check-fixtures.mjs` (in `pnpm lint`) enforces F-3 (no email except `allay@odsens.com`,
`*@localhost.test`), F-4 (≤ 200 KB; `files/`, `images/` ≤ 100 KB) and F-8 (`<hash16 of …>` literals in
`supabase/seed.sql` match sha256 of the fixture bytes). Never edit fixture values by hand to make a test pass (F-6).

Serving in e2e: `node scripts/fixture-server.mjs [4010]` (or `startFixtureServer()` from `tests/helpers/fixtureServer.ts`)
maps `GET http://127.0.0.1:4010/<source>/<path>` → `tests/fixtures/<source>/<path>`; the test-only `*_API_BASE` names in
`.env.test` point the adapters there (ADR-0002 #73). POST routes (S1.5, ADR-0030 D8 — the request body is read and
discarded): `POST /discord/webhooks/<id>/<token>` → `discord/webhooks/<id>.json` (200; unknown id → 404, which the
Settings Test line shows as `✕ Discord said no: 404`) and `POST /resend/emails` → `resend/send-ok.json` (200); every
other POST → 405. `.json` fallback (S1.5a, ADR-0037 D10): a GET whose resolved path is a directory or does not exist is
served from `<path>.json` when that file exists — `GET /modrinth/project/sd000101` → `project/sd000101.json` beside the
`project/sd000101/version` alias directory, `GET /modrinth/project/sd000199` → `project/sd000199.json`.
Single-`id` rule (S1.8, ADR-0045): the query string is otherwise ignored, but a GET whose query carries EXACTLY ONE `id` value (one `id=`
param holding a bare id — no comma list) is served from `<path>/<id>.json` when that file exists — `GET /youtube/videos?part=snippet,statistics&id=seedvid0009&key=test`
→ `youtube/videos/seedvid0009.json` (a file beside its same-named `.json` sibling, like `modrinth/project/sd000101.json` beside `project/sd000101/`).
Every other request is answered exactly as before: a multi-id sync batch (`id=a,b,c`), two `id` params, an id with no file, or no id all get
`videos.json`. `scripts/fixture-server.mjs` (dependency-free, CI-5) and the `.ts` helper stay in step — `tests/unit/fixture-server.test.ts` runs
the same requests against both.

Mention preview in e2e (S1.8): `OEMBED_BASE=http://127.0.0.1:4010/youtube/oembed` (`.env.test`) is the YouTube oEmbed ENDPOINT that
`lib/adapters/youtube.ts` calls — it lands on `youtube/oembed.json` through the `.json` fallback. It is not a base for the Open Graph page read:
`lib/adapters/oembed.ts` has no override of any kind, so nothing under `oembed/` is ever requested from this server by the app (the HTML files are
unit / db-test inputs). e2e never exercises the Open Graph read — T-E2E-39 pastes a YouTube URL only.
Offline note (ADR-0045): the SSRF guard resolves the pasted host for real. T-E2E-39 therefore needs working DNS for `www.youtube.com` (CI has
it); run offline, the preview step fails with "Couldn't read that page…" at the DNS check — that is the guard working, not a fixture problem. No
SSRF relaxation is ever keyed on `E2E`, `NODE_ENV` or any env name.

API-path aliases (S1.2, e2e only): the server maps URL paths verbatim, but the adapters request real API shapes
(`/user/<user>/projects`, `/project/<id>/version`, `/mods/<id>` — 04 §4), so those paths exist as byte-for-byte
copies of the canonical F-5 files: `modrinth/user/OddSense/projects` = `user-projects.json`,
`modrinth/project/<id>/version` = `versions-empty.json` (each of the 18 fixture ids; versions absent upstream are
kept, ADR-0002 #66, so the seeded versions survive an e2e sync — 05 T-E2E-41), `curseforge/mods/900001` = `mod.json`,
`discord/webhooks/123.json` = `webhook-ok.json` (S1.5 — the POST route above serves it for webhook id `123`, any token).
S1.6 (YouTube, via the `.json` fallback — no server change): `youtube/videos.json` = `videos-list.json` (`GET <YOUTUBE_API_BASE>/videos?…`) and
`youtube/playlistItems.json` = `playlist-items.json` (`GET …/playlistItems?…`); `GET …/channels?…` falls back to `channels.json` itself, and
`YOUTUBE_RSS_BASE=http://127.0.0.1:4010/youtube/rss.xml` serves the feed directly. Apart from the single-`id` rule above the server ignores the query string, so every multi-id `id=` /
`pageToken=` gets the same answer — which is why `playlist-items.json` must stay a last page (`tests/unit/adapters/youtube.test.ts` asserts
both the byte equality and the missing token).
The canonical flat files stay the unit/db-test source of truth (H-5 `mockFetch`); never edit either copy alone.
