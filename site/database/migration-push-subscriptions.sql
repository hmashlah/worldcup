-- =====================================================================
-- WC2026 Prediction League — Push Subscriptions table
-- Stores Web Push API subscriptions for sending notifications.
-- Run in Supabase SQL editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS wc26_push_subscriptions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fetching a user's subscriptions
CREATE INDEX IF NOT EXISTS idx_wc26_push_subs_user
  ON wc26_push_subscriptions(user_id);

ALTER TABLE wc26_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can read their own subscriptions
DROP POLICY IF EXISTS "wc26 push subs select" ON wc26_push_subscriptions;
CREATE POLICY "wc26 push subs select"
  ON wc26_push_subscriptions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own subscriptions
DROP POLICY IF EXISTS "wc26 push subs insert" ON wc26_push_subscriptions;
CREATE POLICY "wc26 push subs insert"
  ON wc26_push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own subscriptions (needed for upsert)
DROP POLICY IF EXISTS "wc26 push subs update" ON wc26_push_subscriptions;
CREATE POLICY "wc26 push subs update"
  ON wc26_push_subscriptions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own subscriptions
DROP POLICY IF EXISTS "wc26 push subs delete" ON wc26_push_subscriptions;
CREATE POLICY "wc26 push subs delete"
  ON wc26_push_subscriptions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Service role can read/delete all (for sending from backend + cleanup)
-- (Service role bypasses RLS by default, so no policy needed for it)
