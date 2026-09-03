-- 20260903090200_comments_public_moderator_thread.sql — slice S1.4 (Comments),
-- docs/build/00-build-plan.md "S1.4 — Comments". One concern (01 INV-06): the two read surfaces
-- of a thread — the public view `comments_public` (ADR-0002 #71; 05 T-RLS-128) and the mods-only
-- RPC `moderator_thread(text, uuid)` (ADR-0002 A2; 05 T-RLS-134). Created after
-- 20260903090100 because the RPC counts `comment_reports`.
-- Idempotent: `create or replace` throughout; grants revoked and re-stated.
-- Reversibility (no data — pure read surfaces):
--   drop function if exists public.moderator_thread(text, uuid);
--   drop view if exists public.comments_public;

-- ---------------------------------------------------------------------------------------------
-- public.comments_public — what public pages render, server-side, under tag `project:<slug>`
-- (data-model §2.5; 04 §1.2 "Reads"). Definer view on purpose (the `public_profiles` /
-- `projects_public` pattern): every row of a VISIBLE target is a slot — `id, target_type,
-- target_id, parent_id, status, created_at, like_count` for everyone — and `body`, `author_id`,
-- `edited_at` are non-NULL only for `published` rows or the caller's own rows (`auth.uid()` reads
-- the session claim even inside a definer view), so held/hidden/deleted rows appear as slots with
-- `body NULL`. Exactly these ten columns (T-RLS-128 asserts the set); never `moderated_*`.
-- ---------------------------------------------------------------------------------------------
create or replace view public.comments_public
  with (security_invoker = off)
as
  select
    c.id,
    c.target_type,
    c.target_id,
    c.parent_id,
    c.status,
    c.created_at,
    c.like_count,
    case when c.status = 'published' or c.author_id = auth.uid() then c.body end      as body,
    case when c.status = 'published' or c.author_id = auth.uid() then c.author_id end as author_id,
    case when c.status = 'published' or c.author_id = auth.uid() then c.edited_at end as edited_at
  from public.comments c
  where public.comment_target_visible(c.target_type::text, c.target_id);

revoke all on table public.comments_public from public, anon, authenticated, service_role;
grant select on table public.comments_public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- public.moderator_thread(p_target_type, p_target_id) — the mods-only client read (ADR-0002 A2;
-- 04 §1.2 "Moderator read"; the allowed exception to 01 INV-09 / 03 C-17): for one target, every
-- `held` and `hidden` comment plus every non-deleted comment with unresolved reports, with
-- `body`/`author_id`, `is_first_comment` (author's `profiles.comment_count = 0`) and
-- `report_count` (unresolved). Raises insufficient_privilege (42501) unless `is_moderator()`;
-- granted to `authenticated` only (anon is denied at the grant). Never exposes `email_hash`.
-- ---------------------------------------------------------------------------------------------
create or replace function public.moderator_thread(p_target_type text, p_target_id uuid)
returns table (
  id               uuid,
  target_type      text,
  target_id        uuid,
  parent_id        uuid,
  author_id        uuid,
  body             text,
  status           text,
  created_at       timestamptz,
  edited_at        timestamptz,
  like_count       integer,
  is_first_comment boolean,
  report_count     integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_moderator() then
    raise insufficient_privilege
      using message = 'moderator_thread: moderators only';
  end if;

  return query
    select
      c.id,
      c.target_type::text,
      c.target_id,
      c.parent_id,
      c.author_id,
      c.body,
      c.status::text,
      c.created_at,
      c.edited_at,
      c.like_count,
      coalesce(p.comment_count, 0) = 0 as is_first_comment,
      (
        select count(*)::integer
        from public.comment_reports r
        where r.comment_id = c.id
          and r.resolved_at is null
      ) as report_count
    from public.comments c
    left join public.profiles p on p.id = c.author_id
    where c.target_type::text = p_target_type
      and c.target_id = p_target_id
      and (
        c.status in ('held', 'hidden')
        or (
          c.status <> 'deleted'
          and exists (
            select 1
            from public.comment_reports r
            where r.comment_id = c.id
              and r.resolved_at is null
          )
        )
      )
    order by c.created_at;
end;
$$;

revoke all on function public.moderator_thread(text, uuid) from public, anon;
grant execute on function public.moderator_thread(text, uuid) to authenticated;
