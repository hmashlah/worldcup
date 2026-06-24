-- WC2026 Time Capsule — sealed predictions revealed after the final
CREATE TABLE IF NOT EXISTS wc26_time_capsule (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  winner       TEXT NOT NULL,
  top_scorer   TEXT,
  dark_horse   TEXT,
  bold_take    TEXT,
  sealed_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE wc26_time_capsule ENABLE ROW LEVEL SECURITY;

-- Everyone can read (revealed after tournament ends)
DROP POLICY IF EXISTS "wc26 anyone reads capsules" ON wc26_time_capsule;
CREATE POLICY "wc26 anyone reads capsules"
  ON wc26_time_capsule FOR SELECT TO authenticated
  USING (true);

-- Users can insert their own capsule (once, before knockout stage)
DROP POLICY IF EXISTS "wc26 user inserts own capsule" ON wc26_time_capsule;
CREATE POLICY "wc26 user inserts own capsule"
  ON wc26_time_capsule FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND now() < '2026-06-28T00:00:00Z'::timestamptz
  );

-- No updates allowed — once sealed, it's permanent
