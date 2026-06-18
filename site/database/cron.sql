-- =====================================================================
-- WC2026 Prediction League — pg_cron jobs
-- Run in the Supabase SQL Editor to manage scheduled tasks.
-- =====================================================================

-- ── Current jobs ─────────────────────────────────────────────────────
--
-- | jobid | jobname                    | schedule    | description                          |
-- |-------|----------------------------|-------------|--------------------------------------|
-- | 1     | wc26-prediction-reminders  | 0 9 * * *   | Daily 09:00 UTC — email reminders    |
-- | 3     | wc26-sync-matches          | * * * * *   | Every minute — FD scores + wiki sync |
--
-- Removed:
-- | 4     | wc26-sync-wiki-scorers     | 17 6 * * *  | (merged into sync-matches)           |

-- ── Helper functions called by pg_cron ───────────────────────────────
-- These wrap pg_net HTTP calls to Cloudflare Pages Functions.

-- 1) Prediction reminders (daily at 09:00 UTC)
CREATE OR REPLACE FUNCTION wc26_send_prediction_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://worldcup-1jo.pages.dev/send-reminders',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-wc26-secret', 'REDACTED_SECRET'
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- 2) Sync matches — FD live scores, finished results, AND wiki scorers
--    (runs every minute; wiki is only fetched when scores change)
CREATE OR REPLACE FUNCTION wc26_sync_matches()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://worldcup-1jo.pages.dev/sync-matches',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-wc26-secret', 'REDACTED_SECRET'
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- 3) REMOVED: wc26_sync_wiki_scorers — merged into sync-matches
--    The function and cron job can be dropped:
--
--    SELECT cron.unschedule('wc26-sync-wiki-scorers');
--    DROP FUNCTION IF EXISTS wc26_sync_wiki_scorers();


-- ── Management commands ──────────────────────────────────────────────

-- List all cron jobs:
--   SELECT jobid, jobname, schedule, command FROM cron.job ORDER BY jobid;

-- Remove the old wiki-scorers job (run once):
--   SELECT cron.unschedule('wc26-sync-wiki-scorers');
--   DROP FUNCTION IF EXISTS wc26_sync_wiki_scorers();

-- Reschedule sync-matches (e.g. every 2 minutes instead of every minute):
--   SELECT cron.unschedule('wc26-sync-matches');
--   SELECT cron.schedule('wc26-sync-matches', '*/2 * * * *', 'SELECT wc26_sync_matches();');

-- Reschedule reminders (e.g. change to 10:00 UTC):
--   SELECT cron.unschedule('wc26-prediction-reminders');
--   SELECT cron.schedule('wc26-prediction-reminders', '0 10 * * *', 'SELECT wc26_send_prediction_reminders();');
