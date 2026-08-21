-- 20260820120300_avatars_bucket.sql — slice S1.1 (Accounts), docs/build/00-build-plan.md "S1.1 — Accounts".
-- One concern (01 INV-06): the `avatars` Storage bucket + its read policy (data-model §3; 01 INV-33,
-- INV-47; ADR-0002 C16 path `avatars/{profile_id}/{hash}.webp`). Public-read, 1 MB, WebP only
-- (the server re-encodes every upload to WebP before storing — nothing else ever lands here).
-- Writes (insert/update/delete) have NO policy: service role only (T-RLS-116).
-- Idempotent: upsert on the bucket row; `drop policy if exists` before create.
-- Reversibility (deleting the bucket deletes every avatar — explicit confirm + backup note first):
--   drop policy if exists avatars_public_read on storage.objects;
--   delete from storage.objects where bucket_id = 'avatars';
--   delete from storage.buckets where id = 'avatars';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects already has RLS enabled (Supabase). Read-only for browsers (T-RLS-115).
drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'avatars');
