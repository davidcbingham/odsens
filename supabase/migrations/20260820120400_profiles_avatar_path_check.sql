-- 20260820120400_profiles_avatar_path_check.sql — slice S1.1 (Accounts), gate-round-1 security fix
-- (ADR-0015 addendum; 01 INV-53 / INV-47; 04 SC-21 path `avatars/{profile_id}/{hash16}.webp`).
-- One concern (01 INV-06): CHECK `profiles_avatar_path_own` — `avatar_path` is NULL or points inside the
-- row owner's own folder (`<id>/<16 lowercase hex>.webp`). Why: `avatar_path` is an own-row write under RLS
-- (T-RLS-4), and `updateProfile` / `deleteAccount` delete the referenced object with the service-role
-- client — without this CHECK a user could point their row at another user's object and have it deleted.
-- `lib/files.ts` `isOwnAvatarPath()` mirrors the same regex app-side (defence in depth).
-- Existing rows: SEED-3 rows carry `avatar_path NULL`; every path the app has ever written is
-- `avatarObjectPath(user.id, hash16)`, so `add constraint` (which validates existing rows) passes.
-- Idempotent: `drop constraint if exists` before `add constraint`.
-- Reversibility (no data loss — the constraint only rejects writes; the column is untouched):
--   alter table public.profiles drop constraint if exists profiles_avatar_path_own;

alter table public.profiles drop constraint if exists profiles_avatar_path_own;
alter table public.profiles
  add constraint profiles_avatar_path_own
  check (avatar_path is null or avatar_path ~ ('^' || id::text || '/[0-9a-f]{16}\.webp$'));
