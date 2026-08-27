/**
 * lib/jobs/cronAuth.ts — the SC-12 cron bearer check (04 §2.4; 05 T-UNIT-24; registry Modules
 * `jobs/*`; the name `cronAuth(req)` is 05's — T-UNIT-24 "cron bearer check").
 *
 * `Authorization: Bearer ${CRON_SECRET}` → true; missing header, wrong scheme (`Basic …`), wrong
 * value or wrong length → false. The comparison is `crypto.timingSafeEqual` AFTER an explicit length
 * check (`timingSafeEqual` throws on unequal lengths; the length itself is not secret). Pure over the
 * request — no I/O, so a 401 route response has no side effects (SC-12).
 */
import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

const SCHEME = 'Bearer ';

export function cronAuth(request: Request): boolean {
  const header = request.headers.get('authorization');
  if (header === null || !header.startsWith(SCHEME)) return false;
  const given = Buffer.from(header.slice(SCHEME.length), 'utf8');
  const expected = Buffer.from(env.CRON_SECRET, 'utf8');
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
