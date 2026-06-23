-- =====================================================================
-- WC2026 Prediction League — Message reactions
-- Run in Supabase SQL editor.
-- =====================================================================

CREATE TABLE IF NOT EXISTS wc26_reactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   UUID NOT NULL REFERENCES wc26_messages(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emoji        TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_wc26_reactions_message
  ON wc26_reactions(message_id);

ALTER TABLE wc26_reactions ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read reactions
DROP POLICY IF EXISTS "wc26 anyone reads reactions" ON wc26_reactions;
CREATE POLICY "wc26 anyone reads reactions"
  ON wc26_reactions FOR SELECT TO authenticated
  USING (true);

-- Users can insert their own reactions
DROP POLICY IF EXISTS "wc26 user inserts own reactions" ON wc26_reactions;
CREATE POLICY "wc26 user inserts own reactions"
  ON wc26_reactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own reactions (un-react)
DROP POLICY IF EXISTS "wc26 user deletes own reactions" ON wc26_reactions;
CREATE POLICY "wc26 user deletes own reactions"
  ON wc26_reactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE wc26_reactions;
