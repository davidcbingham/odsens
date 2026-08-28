-- S1.3 — project_versions identity split (ADR-0026).
-- One concern: version identity. The live Modrinth catalogue ships two versions of one
-- project sharing a version_number (docs/questions.md 2026-08-27 finding), so the S1.2
-- unique (project_id, version_number) rejects real upstream data and — worse — the sync
-- job's version_number fallback match ping-pongs the two upstream versions over one row.
-- Decision (ADR-0026): synced versions are identified by external_id alone (the Modrinth
-- version id; the 04 §3.1 idempotency key, now a real DB unique); exclusives (external_id
-- IS NULL) keep per-project version_number uniqueness via a partial unique index, which
-- uploadProjectFile relies on to find-or-create a version.
-- Reversibility: drop the two new constraints/indexes, re-add the old unique (only valid
-- while no project carries duplicate version_numbers).

alter table public.project_versions
  drop constraint if exists project_versions_project_id_version_number_key;

-- Modrinth version ids are globally unique; NULLs (exclusives) never collide in a
-- plain unique index, so no partial predicate is needed here (and supabase-js
-- upsert onConflict inference keeps working).
alter table public.project_versions
  add constraint project_versions_external_id_key unique (external_id);

-- Exclusive versions (external_id IS NULL) stay unique per (project_id, version_number):
-- the S1.3 uploadProjectFile flow keys find-or-create on this pair (04 §1.4).
create unique index if not exists project_versions_exclusive_version_key
  on public.project_versions (project_id, version_number)
  where external_id is null;
