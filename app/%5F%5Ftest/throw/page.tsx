/**
 * `/__test/throw` — E2E-only route that reaches `app/error.tsx` (T-E2E-15; ADR-0002 #74; 00 S0.AC13).
 *
 * On disk this folder is `app/%5F%5Ftest/throw/` because a leading underscore marks a Next.js
 * private folder (it would never route). A URL-encoded segment is the Next-documented way to serve a
 * path that starts with underscores; the served URL is `/__test/throw` (registry name; 01 §1 tree
 * notes the on-disk spelling). Exists only when `E2E=1` (`.env.test`, CI-5 `pnpm start`); everywhere
 * else it is a 404. No metadata: the error shell owns the page.
 */
import { notFound } from 'next/navigation';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default function ThrowPage(): never {
  if (env.E2E !== '1') notFound();
  throw new Error('__test/throw');
}
