#!/usr/bin/env node
/**
 * scripts/check-bundle-secrets.mjs — 05 CI-4 / 01 INV-29 (runs in the CI `build` job after `pnpm build`).
 * Reads every file under .next/static/** as text and fails when any secret-bearing env name leaks into
 * the client bundle. Exit 1 listing file + match; exit 0 otherwise; exit 1 if .next/static is missing.
 * Zero deps.
 *
 * One ignored match (ADR-0007): `@supabase/supabase-js` ships a key-format guard
 * (`key.startsWith("sb_secret_")`) that warns when a secret key is used in a browser; the browser
 * client is in the bundle by design (03 C-17a `ViewerProvider`), so that literal — `sb_secret`
 * immediately followed by `_` and a quote — is skipped. A real value (`sb_secret_<key>`) or the bare
 * word anywhere else still fails.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const STATIC = path.join(ROOT, '.next', 'static');
// 01 INV-29 list (superset of 05 CI-4).
const SECRET_RE =
  /SERVICE_ROLE|sb_secret|CURSEFORGE_API_KEY|YOUTUBE_API_KEY|RESEND_API_KEY|DISCORD_WEBHOOK|KOFI_|CRON_SECRET|GOOGLE_OAUTH|HASH_SECRET|[^_]SENTRY_DSN/g;

/** The supabase-js key-format literal `sb_secret_"` / `sb_secret_'` (ADR-0007) — the only ignored match. */
function isSupabaseKeyFormatLiteral(text, match, at) {
  if (match !== 'sb_secret') return false;
  const next = text.slice(at + match.length, at + match.length + 2);
  return next === '_"' || next === "_'";
}

if (!existsSync(STATIC)) {
  console.error('check-bundle-secrets: .next/static is missing — run `pnpm build` first.');
  process.exit(1);
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(STATIC, []);
const hits = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(SECRET_RE)) {
    const at = m.index ?? 0;
    if (isSupabaseKeyFormatLiteral(text, m[0], at)) continue;
    const context = text.slice(Math.max(0, at - 40), at + m[0].length + 40).replace(/\s+/g, ' ');
    hits.push({ file: path.relative(ROOT, file), match: m[0].trim(), context });
  }
}

if (hits.length > 0) {
  console.error(
    `check-bundle-secrets: ${hits.length} secret-bearing name(s) found in .next/static (01 INV-29 / 05 CI-4):`,
  );
  for (const h of hits) console.error(`  - ${h.file}: "${h.match}"  …${h.context}…`);
  process.exit(1);
}
console.log(
  `check-bundle-secrets: OK — ${files.length} file(s) in .next/static, no secret-bearing names.`,
);
