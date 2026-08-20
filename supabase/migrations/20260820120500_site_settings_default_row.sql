-- 20260820120500_site_settings_default_row.sql — slice S1.1 (Accounts), gate-round-1 fix
-- (ADR-0015 addendum; data-model §2.4; 01 INV-97; 05 SEED-1).
-- One concern (01 INV-06): the `site_settings` singleton (`id = 1`) exists on EVERY environment.
-- Production and the persistent `staging` Supabase branch (ADR-0010) receive migrations only —
-- `supabase/seed.sql` never runs there (its first line forbids it, 05 SEED-14) — so the row the app
-- reads (`site_settings_public`, later `postComment` / `comments_set_status()`) has to be created here,
-- with the column defaults: `moderation_mode 'auto'`, `admin_notify_emails '{}'`,
-- `comments_closed_default false`, everything else NULL.
-- `seed.sql` is unchanged: locally it still runs after the migrations and sets `kofi_page` /
-- `owner_profile_id` on this same row (SEED-1 `on conflict (id) do update`). On production the admin
-- fills those in through `/admin/settings` (S1.5).
-- Idempotent: `on conflict (id) do nothing` — a re-run never overwrites live settings.
-- Reversibility (removes the only settings row — explicit confirm + backup note first):
--   delete from public.site_settings where id = 1;

insert into public.site_settings (id) values (1)
on conflict (id) do nothing;
