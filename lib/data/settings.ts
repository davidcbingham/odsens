/**
 * lib/data/settings.ts — the ISR read of `site_settings_public` (registry Modules
 * `data/settings.ts`; ADR-0002 C6 / A3; 02 RP-23 tag `settings`): `comments_closed_default`
 * (the `/projects/[slug]` commentsEnabled rule, 02 §2.3), `owner_profile_id` (the CREATOR tag,
 * ADR-0002 #55 — `getOwnerProfileId()` per 04 §1.2), `moderation_mode` (the client
 * optimistic-insert rule, 03 §2.4) and `kofi_page` (S1.9 `/support`).
 *
 * Server-only; the cookie-less anon client (01 INV-15) — the view is readable by every role and
 * never carries the secret columns (05 T-RLS-132). Cached under tag `settings` with the pages'
 * 600 s (01 INV-38); `updateSettings` (S1.5) revalidates the tag.
 */
import 'server-only';
import { unstable_cache } from 'next/cache';
import { createAnonClient } from '@/lib/supabase/anon';
import type { Database } from '@/lib/supabase/types';

export type ModerationMode = Database['public']['Enums']['moderation_mode'];

export type PublicSettings = {
  commentsClosedDefault: boolean;
  kofiPage: string | null;
  ownerProfileId: string | null;
  moderationMode: ModerationMode;
};

const REVALIDATE_S = 600;
const TAG_SETTINGS = 'settings';

/** Column defaults of `site_settings` (20260820120100) — used only if the singleton is missing. */
const DEFAULTS: PublicSettings = {
  commentsClosedDefault: false,
  kofiPage: null,
  ownerProfileId: null,
  moderationMode: 'auto',
};

async function fetchPublicSettings(): Promise<PublicSettings> {
  const { data, error } = await createAnonClient()
    .from('site_settings_public')
    .select('comments_closed_default, kofi_page, owner_profile_id, moderation_mode')
    .maybeSingle();
  if (error) throw new Error(`lib/data/settings: read failed — ${error.message}`);
  if (data === null) return DEFAULTS;
  return {
    commentsClosedDefault: data.comments_closed_default ?? DEFAULTS.commentsClosedDefault,
    kofiPage: data.kofi_page,
    ownerProfileId: data.owner_profile_id,
    moderationMode: data.moderation_mode ?? DEFAULTS.moderationMode,
  };
}

/** The four public settings, cached under `settings` (01 INV-38; 02 RP-23). */
export const getPublicSettings = unstable_cache(fetchPublicSettings, ['data-settings-public'], {
  revalidate: REVALIDATE_S,
  tags: [TAG_SETTINGS],
});

/** `site_settings.owner_profile_id` for the CREATOR tag (04 §1.2; ADR-0002 #55). */
export async function getOwnerProfileId(): Promise<string | null> {
  return (await getPublicSettings()).ownerProfileId;
}
