# Google Cloud setup — OAuth (sign-in) + YouTube Data API key

Owner: **david@studiobing.com**. One Google Cloud project serves both needs. ~20 minutes. Do this when we're ready to
build auth; nothing here blocks the design phase.

## 0. Create the project
1. https://console.cloud.google.com → project picker → **New Project** → name `odsens` → Create. (No billing needed for either feature.)

## 1. OAuth consent screen (what users see on "Sign in with Google")
Google Cloud → **APIs & Services → OAuth consent screen** (now under "Google Auth Platform → Branding/Audience").
- User type: **External**.
- App name: `odsens`. User support email: david@studiobing.com. App logo: optional (adding a logo triggers Google verification — **skip the logo** initially).
- **Authorized domains:** `odsens.com` and `supabase.co`.
- Developer contact: david@studiobing.com.
- Scopes: only the defaults — `openid`, `email`, `profile` (non-sensitive → **no Google verification review needed**).
- Audience/Publishing status: **In production** (so anyone can sign in, not just test users). With only non-sensitive scopes there's no review; the "unverified app" warning does not appear.

## 2. OAuth client (the credentials Supabase uses)
**APIs & Services → Credentials → Create credentials → OAuth client ID**
- Application type: **Web application**. Name: `odsens-web`.
- **Authorized JavaScript origins:**
  - `https://odsens.com`
  - `https://www.odsens.com`
  - `http://localhost:3000` (local dev)
- **Authorized redirect URIs** — Supabase handles the callback, so this is the Supabase project's URL, not ours:
  - `https://<SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback`
  (Get the exact value from Supabase → Authentication → Providers → Google → "Callback URL".)
- Create → copy **Client ID** and **Client secret** → paste into `.env` (`GOOGLE_OAUTH_CLIENT_ID/SECRET`) **and** into Supabase → Authentication → Providers → **Google** → enable, paste, save.

Supabase side (same time): Authentication → URL Configuration → Site URL `https://odsens.com`; Redirect URLs are exactly `https://odsens.com/**`, `https://www.odsens.com/**`, `https://odsens-git-*-studiobing.vercel.app/**` (this project's Vercel preview aliases), `http://localhost:3000/**` (ADR-0011; never a bare `*.vercel.app`). They live in `supabase/config.toml` (`[remotes.production.auth].additional_redirect_urls`), not the dashboard — see Status below.

## 3. YouTube Data API v3 key
1. **APIs & Services → Library** → search "YouTube Data API v3" → **Enable**.
2. **Credentials → Create credentials → API key** → name `odsens-youtube-server`.
3. **Restrict the key:** API restrictions → *Restrict key* → YouTube Data API v3 only. Application restrictions → **None** (the key is only used server-side from Vercel; HTTP-referrer restriction would break server calls). Never ship it to the browser.
4. Paste into `.env` as `YOUTUBE_API_KEY`. Channel ID is already there (`UCo3X_c7MqfC_ub-sMJZmmOA`).
Quota: 10,000 units/day free; a channel-videos sync costs a few units — negligible.

## 4. Later, in Vercel
Add the same values as Environment Variables (Production + Preview) in the Vercel project. `.env` is only for local dev.

## Status (2026-08-17) — DONE
- Google Cloud project `odsens` (org studiobing.com) · OAuth Web client `782276308547-…apps.googleusercontent.com` with redirect `https://dllbekulbimblrsrxuyv.supabase.co/auth/v1/callback` and JS origins odsens.com / www / localhost:3000 · YouTube Data API key created.
- Values in David's `.env` (`GOOGLE_OAUTH_CLIENT_ID/SECRET`, `YOUTUBE_API_KEY`).
- **Supabase side configured from the repo, not the dashboard:** `supabase/config.toml` has `[auth.external.google]` (secret via `env(GOOGLE_OAUTH_CLIENT_SECRET)`) and `[remotes.production.auth]` with `site_url = https://odsens.com` + redirect allow-list (odsens.com, www, `odsens-git-*-studiobing.vercel.app`, localhost — allow-list narrowed 2026-08-20, ADR-0011). Applied with `set -a; source .env; set +a; supabase config push`. Verified: `/auth/v1/settings` shows google enabled; remote site_url = odsens.com.
- Re-run `supabase config push` after any auth config change; it prints a diff first.

## Checklist
- [x] Project `odsens` created
- [x] Consent screen: External, odsens.com + supabase.co authorized, non-sensitive scopes, In production
- [x] OAuth Web client with Supabase callback URI; ID/secret in `.env` + Supabase Google provider
- [x] Supabase Site URL / redirect URLs set
- [x] YouTube Data API enabled; restricted API key in `.env`
- [ ] Values mirrored to Vercel env vars at build time
