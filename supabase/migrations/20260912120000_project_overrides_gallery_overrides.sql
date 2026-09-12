-- 20260912120000_project_overrides_gallery_overrides.sql — fix pass 3 (ADR-0038 D3)
-- Oliver's per-image curation of a SYNCED gallery: Modrinth owns `projects.gallery` (the hourly
-- sync re-writes it), so hiding an image or renaming it on odsens.com lives in the override row,
-- keyed by the image url. Shape: jsonb array of `{url, hidden?: boolean, title?: string}`;
-- `mergeGallery` (lib/data/projects.ts) applies it on every public read. Uploaded images
-- (`project_overrides.extra_gallery`, `projects.gallery` on an odsens row) carry their own title
-- and are deleted outright, so they need no row here.
-- Idempotent: `add column if not exists`. RLS on `project_overrides` unchanged (admin/service
-- writes, the column rides the existing policies).
-- Reversibility: alter table public.project_overrides drop column if exists gallery_overrides;

alter table public.project_overrides
  add column if not exists gallery_overrides jsonb not null default '[]'::jsonb;

comment on column public.project_overrides.gallery_overrides is
  'Per-image curation of the synced gallery: [{url, hidden?, title?}] keyed by projects.gallery[].url (ADR-0038 D3).';
