-- 20260911120000_project_links_unique_listing.sql — slice S1.5a (Cross-posted projects), ADR-0037
-- Decision 1 + Decision 9 (05 T-RLS-135; 00 S1.5a.AC1). One concern (01 INV-06): one listing links
-- to at most one project — the unique index `project_links_platform_external_id_key
-- (platform, external_id)`. It is the atomic backstop behind `linkProjectListing`'s "That listing is
-- already linked to <title>." check: a 23505 on the link upsert maps to `conflict` (ADR-0037 D1),
-- and `syncModrinth` step 2 (i) can resolve a listing to exactly one canonical row (D2). The PK
-- `(project_id, platform)` is unchanged (one link per platform per project, data-model §2.2).
-- The seed carries one link row (SEED-6) and every factory link uses a per-project external_id, so
-- the index builds on any existing local/production state.
-- RLS on `project_links` is unchanged (select via `project_is_visible()` or admin; writes admin/service).
-- Idempotent: `create unique index if not exists`. No data change.
-- Reversibility (no data loss):
--   drop index if exists public.project_links_platform_external_id_key;

create unique index if not exists project_links_platform_external_id_key
  on public.project_links (platform, external_id);
