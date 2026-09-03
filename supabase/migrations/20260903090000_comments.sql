-- 20260903090000_comments.sql — slice S1.4 (Comments), docs/build/00-build-plan.md "S1.4 — Comments".
-- One concern (01 INV-06): the `comments` table — enums `comment_target` / `comment_status`, the
-- visibility helper `comment_target_visible()`, the insert precondition `can_comment()`, the three
-- trigger functions the table needs (`comments_set_status()` BEFORE INSERT, `comments_guard()`
-- BEFORE UPDATE, `comments_bump_comment_count()` AFTER INSERT/UPDATE OF status), and its RLS
-- (docs/data-model.md §2.5 / §2.11 / §4; 04 §1.2 shared definitions + §5.1; 05 T-RLS-63..78, 126,
-- 131, 133; ADR-0002 #72 / A4 / C21; ADR-0028 D3 / D4). Likes, reports, the public view and the
-- moderator RPC follow in the next migrations (they reference this table).
-- Idempotent: `if not exists` / `create or replace` / `drop … if exists` throughout; grants are
-- revoked and re-stated after each replace so a re-run can never widen them.
-- Reversibility (all comments are lost — only with an explicit backup note; the later S1.4
-- migrations must be reverted first because they reference this table):
--   drop trigger if exists comments_bump_comment_count on public.comments;
--   drop trigger if exists comments_guard on public.comments;
--   drop trigger if exists comments_set_status on public.comments;
--   drop trigger if exists comments_set_updated_at on public.comments;
--   drop function if exists public.comments_bump_comment_count(), public.comments_guard(),
--     public.comments_set_status(), public.can_comment(text, uuid),
--     public.comment_target_visible(text, uuid);
--   drop table if exists public.comments;
--   drop type if exists public.comment_status; drop type if exists public.comment_target;

-- ---------------------------------------------------------------------------------------------
-- Enums (data-model §2.5). The polymorphic target enum keeps all four values; v1 threads exist on
-- projects only (ADR-0002 C21) — `comment_target_visible()` answers false for the other three.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  create type public.comment_target as enum ('project', 'skin', 'art', 'video');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.comment_status as enum ('published', 'held', 'hidden', 'deleted');
exception
  when duplicate_object then null;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- public.comment_target_visible(p_target_type, p_target_id) — the ONE v1 target-visibility
-- predicate (ADR-0028 D4; registry add-first): project → `project_is_visible()` (ADR-0022);
-- every other target type → false until its thread opens (ADR-0002 C21). Called by the
-- `comments` SELECT policy, `can_comment()`, the `comments_public` view and `moderator_thread`.
-- Security definer so the policy layer never recurses into `projects` RLS (the ADR-0022 lesson).
-- ---------------------------------------------------------------------------------------------
create or replace function public.comment_target_visible(p_target_type text, p_target_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_target_type = 'project' then
    return public.project_is_visible(p_target_id);
  end if;
  return false;
end;
$$;

revoke all on function public.comment_target_visible(text, uuid) from public;
grant execute on function public.comment_target_visible(text, uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- public.can_comment(p_target_type, p_target_id) — the insert precondition for `comments`,
-- `comment_likes` and `comment_reports` (data-model §2.5 / §4; 04 §1.2; 05 T-RLS-133):
-- a signed-in, not-banned caller · a visible target · comments enabled — project:
-- `coalesce(project_overrides.comments_enabled, not site_settings.comments_closed_default)`;
-- non-project targets → false in v1. No JWT (anon, service) → false: the service client never
-- inserts on a user's behalf through RLS, and anon cannot comment.
-- ---------------------------------------------------------------------------------------------
create or replace function public.can_comment(p_target_type text, p_target_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_banned  boolean;
  v_enabled boolean;
begin
  if v_uid is null then
    return false;
  end if;

  select p.is_banned into v_banned
  from public.profiles p
  where p.id = v_uid;
  if v_banned is null or v_banned then
    return false; -- no profile row, or banned (04 SC-05)
  end if;

  if not public.comment_target_visible(p_target_type, p_target_id) then
    return false;
  end if;

  if p_target_type = 'project' then
    select coalesce(o.comments_enabled, not s.comments_closed_default) into v_enabled
    from public.site_settings s
    left join public.project_overrides o on o.project_id = p_target_id
    where s.id = 1;
    return coalesce(v_enabled, false);
  end if;

  return false;
end;
$$;

revoke all on function public.can_comment(text, uuid) from public, anon;
grant execute on function public.can_comment(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- public.comments — data-model §2.5. `author_id` is NULLABLE with `on delete set null`: when an
-- account is deleted its comments survive as "Deleted." slots (04 §1.1 deleteAccount; 05
-- T-ACT-65) — the insert policy and the status trigger require it non-null on insert.
-- `parent_id` is one level deep by contract (replies to replies store the root — 04 §1.2).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.comments (
  id           uuid primary key default gen_random_uuid(),
  target_type  public.comment_target not null,
  target_id    uuid not null,
  author_id    uuid references public.profiles (id) on delete set null,
  parent_id    uuid references public.comments (id) on delete cascade,
  body         text not null
               constraint comments_body_length check (char_length(body) <= 1000),
  status       public.comment_status not null default 'published',
  like_count   integer not null default 0,
  edited_at    timestamptz,
  moderated_by uuid references public.profiles (id) on delete set null,
  moderated_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.comments is
  'Comment threads (data-model §2.5). Public reads go through comments_public; bodies are plain text (01 INV-66).';

-- The thread read (data-model §2.5 index) + the FK/queue lookups.
create index if not exists comments_target_created_at_idx
  on public.comments (target_type, target_id, created_at);
create index if not exists comments_author_id_idx
  on public.comments (author_id);
create index if not exists comments_parent_id_idx
  on public.comments (parent_id);
create index if not exists comments_held_idx
  on public.comments (created_at)
  where status = 'held';

-- Privileges (revoke-first house pattern): anon select; authenticated select/insert/update/delete
-- subject to the policies below; service_role all. Matrix: 05 T-RLS-63..78.
revoke all on table public.comments from public, anon, authenticated, service_role;
grant select on table public.comments to anon, authenticated;
-- Column-level insert: a JWT caller may name only the columns the action sends (+ `id`, a
-- client-chosen uuid is harmless and lets a caller pick its own key); counters, moderation
-- fields and timestamps are not even insertable (the trigger below pins them too).
grant insert (id, target_type, target_id, author_id, parent_id, body, status)
  on table public.comments to authenticated;
grant update, delete on table public.comments to authenticated;
grant all on table public.comments to service_role;

alter table public.comments enable row level security;

-- select: published rows of a visible target to everyone; own rows (any status) to the author;
-- every row to moderators (data-model §4 "published to all; own held/hidden rows to author;
-- mods/admins all"; the target-visibility clause keeps a hidden project's thread private).
drop policy if exists comments_select_published_own_or_mod on public.comments;
create policy comments_select_published_own_or_mod
  on public.comments
  for select
  to anon, authenticated
  using (
    (status = 'published' and public.comment_target_visible(target_type::text, target_id))
    or (auth.uid() is not null and author_id = auth.uid())
    or public.is_moderator()
  );

-- insert: own row on a target the caller may comment on (T-RLS-67..70; the status trigger
-- below decides held/published, ignoring the client value — ADR-0002 #72).
drop policy if exists comments_insert_own_can_comment on public.comments;
create policy comments_insert_own_can_comment
  on public.comments
  for insert
  to authenticated
  with check (author_id = auth.uid() and public.can_comment(target_type::text, target_id));

-- update: authors and moderators reach the row; the column rules (body window, status
-- transitions, immutable counters) are enforced by the `comments_guard()` trigger (T-RLS-71..77).
drop policy if exists comments_update_own_or_mod on public.comments;
create policy comments_update_own_or_mod
  on public.comments
  for update
  to authenticated
  using (author_id = auth.uid() or public.is_moderator())
  with check (author_id = auth.uid() or public.is_moderator());

-- delete (hard): moderators only (T-RLS-78); authors soft-delete through status.
drop policy if exists comments_delete_mod on public.comments;
create policy comments_delete_mod
  on public.comments
  for delete
  to authenticated
  using (public.is_moderator());

-- updated_at (01 INV-97; helper from 20260818000012_helpers.sql).
drop trigger if exists comments_set_updated_at on public.comments;
create trigger comments_set_updated_at
  before update on public.comments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- public.comments_set_status() — BEFORE INSERT (ADR-0002 #72; 04 §5.1 M2–M5; 05 T-RLS-131).
-- For a JWT caller (`auth.role() = 'authenticated'`) the row's status is RECOMPUTED from the
-- author's role, `site_settings.moderation_mode` and `profiles.comment_count` — the client value
-- is ignored, as are its counters, moderation fields and timestamps (`created_at`/`updated_at`
-- are pinned to `now()`: `comments_guard()` measures the 04 §1.2 edit window from `created_at`
-- and the thread sorts by it, so a forged stamp would open a window that never closes — the
-- ADR-0020 DB-twin rule). Sessions without a JWT (migrations, seed.sql, psql) and the service
-- role keep the status and timestamps they insert (seed rows, tests, server writes). Security
-- definer: `site_settings` is admin-only under RLS and the author's row is read past the own-row
-- policy.
-- ---------------------------------------------------------------------------------------------
create or replace function public.comments_set_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        text := auth.role();
  v_author_role public.user_role;
  v_count       integer;
  v_mode        public.moderation_mode;
  v_parent_ok   uuid;
  v_recent      bigint;
begin
  if new.author_id is null then
    raise exception 'comments: author_id is required' using errcode = 'not_null_violation';
  end if;

  if v_role = 'authenticated' then
    new.like_count   := 0;
    new.edited_at    := null;
    new.moderated_by := null;
    new.moderated_at := null;
    new.created_at   := now();  -- the guard's 15-minute edit window and the thread order hang
    new.updated_at   := now();  -- off this stamp: never the client's value (ADR-0002 #72)

    -- DB twin of the 04 §1.2 reply rules (ADR-0028 D4): a reply's parent is a published ROOT on
    -- the same target — a reply to a reply is stored under the root by the action; a direct
    -- insert may not fake depth 2, cross targets or answer a held/hidden/deleted row.
    if new.parent_id is not null then
      select c.id into v_parent_ok
      from public.comments c
      where c.id = new.parent_id
        and c.target_type = new.target_type
        and c.target_id = new.target_id
        and c.parent_id is null
        and c.status = 'published';
      if v_parent_ok is null then
        raise insufficient_privilege
          using message = 'comments: a reply needs a published root comment on the same target';
      end if;
    end if;

    -- DB backstop of the 04 §5.5 post limits for DIRECT inserts (ADR-0028 D12): the action's
    -- `assertRateLimit` (5 / min, 50 / day on `rate_limit_hits`) is the user-facing limit; this
    -- counts the author's own rows and only bites a script that bypasses the action. Twelve times
    -- the action's ceiling so the db lane's action tests never reach it.
    select count(*) into v_recent
    from public.comments c
    where c.author_id = new.author_id
      and c.created_at > now() - interval '1 minute';
    if v_recent >= 60 then
      raise insufficient_privilege
        using message = 'comments: slow down a little';
    end if;
    select count(*) into v_recent
    from public.comments c
    where c.author_id = new.author_id
      and c.created_at > now() - interval '24 hours';
    if v_recent >= 600 then
      raise insufficient_privilege
        using message = 'comments: slow down a little';
    end if;

    select p.role, p.comment_count into v_author_role, v_count
    from public.profiles p
    where p.id = new.author_id;

    select s.moderation_mode into v_mode
    from public.site_settings s
    where s.id = 1;

    if v_author_role in ('moderator', 'admin') then
      new.status := 'published';                                    -- M2: never held
    elsif v_mode = 'hold_first_time' and coalesce(v_count, 0) = 0 then
      new.status := 'held';                                         -- M4: first-timer
    else
      new.status := 'published';                                    -- M3 / M5
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.comments_set_status() from public;
grant execute on function public.comments_set_status() to anon, authenticated, service_role;

drop trigger if exists comments_set_status on public.comments;
create trigger comments_set_status
  before insert on public.comments
  for each row execute function public.comments_set_status();

-- ---------------------------------------------------------------------------------------------
-- public.comments_guard() — BEFORE UPDATE column rules for JWT callers (data-model §4 update
-- cell; 05 T-RLS-71..77; ADR-0028 D4). Passes untouched: sessions without a JWT, the service role,
-- and NESTED trigger writes (`pg_trigger_depth() > 1` — the like_count maintenance trigger; a
-- browser PATCH always runs at depth 1 and users cannot create triggers — ADR-0028 D3).
-- Rules for everyone else: a banned caller changes nothing; counters, author, target, parent and
-- created_at are immutable; a body edit is the author's, within 15 minutes of created_at
-- (moderators and admins included — T-RLS-72/73); `edited_at` is the action's stamp (04 §1.2 "no
-- trigger") — a PATCH may carry it with the body, never before `created_at`, and never move it
-- without a body change; an author may set status to `deleted` only;
-- a moderator may set any status and gets `moderated_by/at` stamped when acting on someone
-- else's row (T-RLS-76); moderation fields are otherwise off-limits to non-moderators.
-- ---------------------------------------------------------------------------------------------
create or replace function public.comments_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text := auth.role();
  v_uid    uuid := auth.uid();
  v_banned boolean;
  v_is_mod boolean;
begin
  if v_role is null or v_role = 'service_role' or pg_trigger_depth() > 1 then
    return new;
  end if;

  select p.is_banned into v_banned
  from public.profiles p
  where p.id = v_uid;
  if coalesce(v_banned, false) then
    raise insufficient_privilege
      using message = 'comments: banned accounts cannot change comments';
  end if;

  if new.like_count is distinct from old.like_count
     or new.author_id is distinct from old.author_id
     or new.target_type is distinct from old.target_type
     or new.target_id is distinct from old.target_id
     or new.parent_id is distinct from old.parent_id
     or new.created_at is distinct from old.created_at
  then
    raise insufficient_privilege
      using message = 'comments: counters, author and target are not editable';
  end if;

  v_is_mod := public.is_moderator();

  if new.body is distinct from old.body then
    if old.author_id is distinct from v_uid
       or old.created_at <= now() - interval '15 minutes'
    then
      raise insufficient_privilege
        using message = 'comments: only the author may edit, and only for 15 minutes';
    end if;
    -- `edited_at` is the action's stamp (04 §1.2 — "set by the action, no trigger"); a direct PATCH
    -- may carry it with the body, never before the row's own clock (ADR-0028 D12).
    if new.edited_at is not null and new.edited_at < old.created_at then
      raise insufficient_privilege
        using message = 'comments: edited_at cannot precede created_at';
    end if;
  elsif new.edited_at is distinct from old.edited_at then
    raise insufficient_privilege
      using message = 'comments: edited_at follows a body edit';
  end if;

  if new.status is distinct from old.status then
    if v_is_mod then
      if old.author_id is distinct from v_uid then
        new.moderated_by := v_uid;
        new.moderated_at := now();
      end if;
    elsif old.author_id = v_uid and new.status = 'deleted' then
      null; -- the author's own soft delete (no time window — 04 §1.2 deleteComment)
    else
      raise insufficient_privilege
        using message = 'comments: only moderators change a status';
    end if;
  end if;

  if not v_is_mod
     and (new.moderated_by is distinct from old.moderated_by
          or new.moderated_at is distinct from old.moderated_at)
  then
    raise insufficient_privilege
      using message = 'comments: moderation fields are not editable';
  end if;

  return new;
end;
$$;

revoke all on function public.comments_guard() from public;
grant execute on function public.comments_guard() to anon, authenticated, service_role;

drop trigger if exists comments_guard on public.comments;
create trigger comments_guard
  before update on public.comments
  for each row execute function public.comments_guard();

-- ---------------------------------------------------------------------------------------------
-- public.comments_bump_comment_count() — AFTER INSERT OR UPDATE OF status (data-model §2.1;
-- 04 §1.2 "comment_count increments when a comment row becomes published (insert as published,
-- or held → published on approve); never decremented"; 05 T-RLS-126; ADR-0028 D4). Security
-- definer: the profile row is another user's when a moderator approves. `profiles_guard()` lets
-- this nested write through (`pg_trigger_depth() > 1`, migration 20260903090400).
-- ---------------------------------------------------------------------------------------------
create or replace function public.comments_bump_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_id is null or new.status <> 'published' then
    return null;
  end if;
  if tg_op = 'INSERT' or old.status = 'held' then
    update public.profiles
       set comment_count = comment_count + 1
     where id = new.author_id;
  end if;
  return null;
end;
$$;

revoke all on function public.comments_bump_comment_count() from public;
grant execute on function public.comments_bump_comment_count() to anon, authenticated, service_role;

drop trigger if exists comments_bump_comment_count on public.comments;
create trigger comments_bump_comment_count
  after insert or update of status on public.comments
  for each row execute function public.comments_bump_comment_count();
