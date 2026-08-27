# tests/fixtures — recorded upstream responses + hand-made binaries

Policy: `docs/build/05-test-plan.md` §2 (F-1..F-8). Adapters and jobs are tested **only** against these files
(H-5); nothing here is fetched at test time.

| Dir | Contents | Arrives |
|---|---|---|
| `modrinth/` `curseforge/` | recorded API JSON per F-5 (`user-projects.json`, `project-*.json`, `versions*.json`, `error-*.json`; `mod.json`, `search.json`, `error-403/404.json`) | S1.2 |
| `youtube/` | `rss.xml`, `rss-malformed.xml`, `videos-list.json`, `playlist-items.json`, `oembed.json`, `videos-mentions.json`, `channels.json` | S1.6 (mentions S1.8) |
| `oembed/` | `og-page.html`, `no-og.html`, `tiktok.html` | S1.8 |
| `discord/` `resend/` | `webhook-ok.json`, `429.json` · `send-ok.json`, `422.json` (+ `__snapshots__/`) | S1.5 |
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
maps `http://127.0.0.1:4010/<source>/<path>` → `tests/fixtures/<source>/<path>`; the test-only `*_API_BASE` names in
`.env.test` point the adapters there (ADR-0002 #73).

API-path aliases (S1.2, e2e only): the server maps URL paths verbatim, but the adapters request real API shapes
(`/user/<user>/projects`, `/project/<id>/version`, `/mods/<id>` — 04 §4), so those paths exist as byte-for-byte
copies of the canonical F-5 files: `modrinth/user/OddSense/projects` = `user-projects.json`,
`modrinth/project/<id>/version` = `versions-empty.json` (each of the 18 fixture ids; versions absent upstream are
kept, ADR-0002 #66, so the seeded versions survive an e2e sync — 05 T-E2E-41), `curseforge/mods/900001` = `mod.json`.
The canonical flat files stay the unit/db-test source of truth (H-5 `mockFetch`); never edit either copy alone.
