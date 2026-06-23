-- =====================================================================
-- WC2026 Prediction League — Notifications table
-- Stores @mention notifications from match chat.
-- Run in Supabase SQL editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS wc26_notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id     TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'mention',
  text         TEXT NOT NULL,
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fetching a user's notifications quickly
CREATE INDEX IF NOT EXISTS idx_wc26_notifications_user
  ON wc26_notifications(user_id, created_at DESC);

ALTER TABLE wc26_notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications
DROP POLICY IF EXISTS "wc26 user reads own notifications" ON wc26_notifications;
CREATE POLICY "wc26 user reads own notifications"
  ON wc26_notifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Any authenticated user can insert notifications (when mentioning someone)
DROP POLICY IF EXISTS "wc26 user inserts notifications" ON wc26_notifications;
CREATE POLICY "wc26 user inserts notifications"
  ON wc26_notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = from_user_id);

-- Users can update (mark as read) their own notifications
DROP POLICY IF EXISTS "wc26 user updates own notifications" ON wc26_notifications;
CREATE POLICY "wc26 user updates own notifications"
  ON wc26_notifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Enable Realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE wc26_notifications;
