-- 20260919073500_videos_wrong_channel_cleanup.sql — incident fix after S1.6 (docs/questions.md,
-- "Wrong YouTube channel id", 2026-09-19). One concern (01 INV-06): remove the rows the first
-- production `syncYoutube` run wrote from the WRONG channel.
-- What happened: `YOUTUBE_CHANNEL_ID` (docs/spec.md §2, .env.example, Vercel) held
-- `UCo3X_c7MqfC_ub-sMJZmmOA`, which is not the @OdSens channel (`UCR7s27wznG-Utxm1OLSvqow`). The
-- 2026-09-19T07:27:41Z cron run on production inserted 53 rows from that other channel. The job
-- never deletes (04 J-D) and `videos` has no channel column, so the rows are removed here, once,
-- by the only thing that tells them apart: they were created before the corrected id was deployed
-- (production redeploy 2026-09-19 ~07:36Z; no run with the correct id can predate the cutoff).
-- Everywhere else this is a no-op: migrations run before `supabase/seed.sql` on a reset (local,
-- CI) and the staging branch has never had a sync, so `videos` is empty when this applies.
-- An emptied table also makes the next keyed run walk the whole uploads playlist (04 §3.3), so
-- the correct channel's full history arrives without a manual `?full=1`.
-- Idempotent: a second apply matches no row.
-- Reversibility: none needed — the deleted rows are another channel's public YouTube metadata;
-- nothing of Oliver's (`hidden` / `is_short_override` were never set on them) is lost.

delete from public.videos
where created_at < timestamptz '2026-09-19 07:35:00+00';
