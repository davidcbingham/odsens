-- 20260903090100_comment_likes_reports.sql — slice S1.4 (Comments), docs/build/00-build-plan.md
-- "S1.4 — Comments". One concern (01 INV-06): the two side tables of a comment — `comment_likes`
-- (+ the `like_count` maintenance trigger `comment_likes_count()`) and `comment_reports`
-- (+ enum `report_reason`), with RLS per data-model §2.5 / §4 (05 T-RLS-79..89, 126;
-- ADR-0028 D4). Both insert policies reuse `can_comment()` on the comment's target.
-- Idempotent: `if not exists` / `create or replace` / `drop … if exists` throughout.
-- Reversibility (likes and reports are lost — explicit backup note first):
--   drop trigger if exists comment_likes_count on public.comment_likes;
--   drop function if exists public.comment_likes_count();
--   drop table if exists public.comment_reports;
--   drop table if exists public.comment_likes;
--   drop type if exists public.report_reason;

-- ---------------------------------------------------------------------------------------------
-- public.comment_likes — PK (comment_id, user_id); a like row per (comment, user). The FK to
-- profiles cascades: a deleted account's likes go with it (04 §1.1 deleteAccount, T-ACT-65).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);

comment on table public.comment_likes is
  'One row per (comment, user) like (data-model §2.5); comments.like_count is trigger-maintained.';

create index if not exists comment_likes_user_id_idx
  on public.comment_likes (user_id);

-- Privileges + RLS (01 INV-28). Matrix: 05 T-RLS-79..84 — select all; insert own + can_comment;
-- no update for anyone but service; delete own.
revoke all on table public.comment_likes from public, anon, authenticated, service_role;
grant select on table public.comment_likes to anon, authenticated;
-- Column-level insert: `created_at` is the server's (a JWT caller cannot name it).
grant insert (comment_id, user_id) on table public.comment_likes to authenticated;
grant delete on table public.comment_likes to authenticated;
grant all on table public.comment_likes to service_role;

alter table public.comment_likes enable row level security;

drop policy if exists comment_likes_select_all on public.comment_likes;
create policy comment_likes_select_all
  on public.comment_likes
  for select
  to anon, authenticated
  using (true);

-- The comment lookup runs under `comments` RLS as the caller, so a held/hidden row the caller
-- cannot see cannot be liked either (04 §1.2 toggleLike precondition, second line of defence).
drop policy if exists comment_likes_insert_own_can_comment on public.comment_likes;
create policy comment_likes_insert_own_can_comment
  on public.comment_likes
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.comments c
      where c.id = comment_id
        and public.can_comment(c.target_type::text, c.target_id)
    )
  );

drop policy if exists comment_likes_delete_own on public.comment_likes;
create policy comment_likes_delete_own
  on public.comment_likes
  for delete
  to authenticated
  using (user_id = auth.uid());
-- (no update policy — T-RLS-82: nothing to update.)

-- ---------------------------------------------------------------------------------------------
-- public.comment_likes_count() — AFTER INSERT / DELETE: `comments.like_count` ± 1 (data-model §2.5
-- "Trigger updates comments.like_count"; 05 T-RLS-126). Security definer — the liked comment is
-- someone else's row; `comments_guard()` lets this nested write through (pg_trigger_depth() > 1).
-- ---------------------------------------------------------------------------------------------
create or replace function public.comment_likes_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.comments
       set like_count = like_count + 1
     where id = new.comment_id;
    return null;
  end if;
  update public.comments
     set like_count = greatest(like_count - 1, 0)
   where id = old.comment_id;
  return null;
end;
$$;

revoke all on function public.comment_likes_count() from public;
grant execute on function public.comment_likes_count() to anon, authenticated, service_role;

drop trigger if exists comment_likes_count on public.comment_likes;
create trigger comment_likes_count
  after insert or delete on public.comment_likes
  for each row execute function public.comment_likes_count();

-- ---------------------------------------------------------------------------------------------
-- enum public.report_reason (data-model §2.5).
-- ---------------------------------------------------------------------------------------------
do $$
begin
  create type public.report_reason as enum ('spam', 'rude', 'other');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- public.comment_reports — one report per (comment, reporter) (unique — the action maps the
-- 23505 to an idempotent ok, 04 §1.2 reportComment); `resolved_at/by` are set by
-- `moderateComment` on approve/hide/delete. The reporter FK cascades (deleteAccount).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.comment_reports (
  id          uuid primary key default gen_random_uuid(),
  comment_id  uuid not null references public.comments (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      public.report_reason not null,
  note        text
              constraint comment_reports_note_length check (note is null or char_length(note) <= 300),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  constraint comment_reports_one_per_reporter unique (comment_id, reporter_id)
);

comment on table public.comment_reports is
  'Reports on comments (data-model §2.5); moderators read/resolve them, the service role purges.';

create index if not exists comment_reports_unresolved_idx
  on public.comment_reports (comment_id)
  where resolved_at is null;

-- Privileges + RLS (01 INV-28). Matrix: 05 T-RLS-85..89 — select mods; insert own reporter +
-- can_comment; update mods (resolved_at/by); delete service only (no JWT grant at all).
revoke all on table public.comment_reports from public, anon, authenticated, service_role;
grant select on table public.comment_reports to authenticated;
-- Column-level insert: a reporter names the comment, themselves, a reason and a note — never
-- `resolved_at` / `resolved_by` / `created_at` (the moderator columns and the server's clock).
grant insert (id, comment_id, reporter_id, reason, note) on table public.comment_reports to authenticated;
grant update (resolved_at, resolved_by) on table public.comment_reports to authenticated;
grant all on table public.comment_reports to service_role;

alter table public.comment_reports enable row level security;

drop policy if exists comment_reports_select_mod on public.comment_reports;
create policy comment_reports_select_mod
  on public.comment_reports
  for select
  to authenticated
  using (public.is_moderator());

drop policy if exists comment_reports_insert_own_can_comment on public.comment_reports;
create policy comment_reports_insert_own_can_comment
  on public.comment_reports
  for insert
  to authenticated
  with check (
    reporter_id = auth.uid()
    and exists (
      select 1
      from public.comments c
      where c.id = comment_id
        and public.can_comment(c.target_type::text, c.target_id)
    )
  );

drop policy if exists comment_reports_update_mod on public.comment_reports;
create policy comment_reports_update_mod
  on public.comment_reports
  for update
  to authenticated
  using (public.is_moderator())
  with check (public.is_moderator());
-- (no delete policy — T-RLS-89: service only.)
