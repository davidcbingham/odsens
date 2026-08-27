/**
 * lib/validation/slug.ts — project slug rules (04 §… "Shared" schemas: `SLUG` regex + `RESERVED_SLUGS`;
 * registry Constants `RESERVED_SLUGS`; 05 T-UNIT-20).
 *
 * `slugSchema` is the zod form 04 names here verbatim ("`lib/validation/slug.ts` `slugSchema`") —
 * unlike `lib/validation/handle.ts` this module is NOT client-safe (zod is server-side, ADR-0008
 * Decision 3): it is consumed by admin actions (`createExclusiveProject` and friends, S1.3+),
 * never by a client island. The pure pieces (`SLUG_RE`, `isValidSlug`, `slugify`) carry no zod
 * and can be split into a zod-free sibling if a client surface ever needs them.
 *
 * Rules (04, verbatim): `^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$` (3–64) and not in
 * `RESERVED_SLUGS = ['new','edit','admin','api','projects']`.
 */
import { z } from 'zod';

/** H-rule regex — 3–64 chars, lowercase alphanumeric + dashes, no leading/trailing dash. */
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/;

export const SLUG_MIN = 3;
export const SLUG_MAX = 64;

/** 04 order, verbatim — route segments a project slug must never shadow. */
export const RESERVED_SLUGS = ['new', 'edit', 'admin', 'api', 'projects'] as const;

const RESERVED_SET: ReadonlySet<string> = new Set<string>(RESERVED_SLUGS);

/** Plain-words copy (DESIGN.md §7 voice — never "invalid input"). */
export const SLUG_MESSAGE = 'Lowercase letters, numbers and dashes. 3–64 characters.';
export const SLUG_RESERVED_MESSAGE = "That one's reserved.";

/** Membership in `RESERVED_SLUGS` (already-lowercase by the regex; lowercased here anyway). */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SET.has(slug.toLowerCase());
}

/** True when `value` passes the regex AND is not reserved. */
export function isValidSlug(value: string): boolean {
  return SLUG_RE.test(value) && !isReservedSlug(value);
}

/**
 * `slugify('Metal Pipe Mace!')` → `metal-pipe-mace` (05 T-UNIT-20): NFKD-strips accents,
 * lowercases, turns every non-alphanumeric run into one dash, collapses dashes, trims them.
 * The result still goes through `slugSchema` — slugify never guarantees length or reservation.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The zod form 04 registers here — regex first, then the reserved-list refinement. */
export const slugSchema = z
  .string()
  .regex(SLUG_RE, SLUG_MESSAGE)
  .refine((value) => !isReservedSlug(value), SLUG_RESERVED_MESSAGE);
