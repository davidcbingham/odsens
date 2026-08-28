-- S1.3 — Storage buckets project-files (private) + project-media (public-read)
-- (docs/data-model.md §3; 01 INV-33, INV-51/52; 00 S1.3; ADR-0002 #31, C10, C16).
-- One concern: the two exclusive-project buckets and their read policies.
-- Writes (insert/update/delete) get NO policy on either bucket — service role only
-- (T-RLS-119/120); browser uploads happen only via a server-issued signed upload URL
-- (04 §1.4.5 two-phase; signed upload tokens are not policies, 01 INV-33).
-- project-files is private: no select policy at all — objects are reachable only via the
-- 60 s signed URLs minted by /api/download/[fileId] (T-RLS-117/118).
-- MIME allow-lists are a first fence only; the commit phase re-validates magic bytes and
-- deletes the object on failure (SC-19; lib/validation/files.ts). The UploadWell PUTs
-- project files with Content-Type application/zip (jar/zip/mrpack share the ZIP container).
-- Reversibility: delete objects, then the policies, then the bucket rows.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-files', 'project-files', false, 104857600, array['application/zip'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-media', 'project-media', true, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects already has RLS enabled (Supabase).
-- project-media: public read, like avatars (T-RLS-120).
drop policy if exists project_media_public_read on storage.objects;
create policy project_media_public_read
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'project-media');

-- project-files: no select policy (private — T-RLS-117); no write policies on either
-- bucket (service role only — T-RLS-119/120).
