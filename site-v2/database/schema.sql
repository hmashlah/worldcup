-- =====================================================================
-- WC2026 Prediction League — Supabase schema
--
-- Run this once on a fresh Supabase project (Database → SQL editor).
-- Replace the admin email in the is_admin() function with your own.
-- =====================================================================


-- =========================================
-- 1) profiles  — display name lookup for the leaderboard
-- =========================================
CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone authenticated reads profiles" ON profiles;
CREATE POLICY "anyone authenticated reads profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "user manages own profile" ON profiles;
CREATE POLICY "user manages own profile"
  ON profiles FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- Auto-create a profile row when a new user signs up.
-- Pulls display_name from raw_user_meta_data, falling back to email prefix.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();


-- =========================================
-- 2) is_admin()  — gate match_results writes
-- =========================================
-- Edit the email below to your own admin email.
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', '')) = lower('REPLACE_WITH_YOUR_EMAIL@example.com');
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- =========================================
-- 3) match_results  — the actual scores (admin-entered)
-- =========================================
CREATE TABLE IF NOT EXISTS match_results (
  match_id     TEXT PRIMARY KEY,           -- "G-A-1" / "M73" / "M-Final" / "M-3rd"
  team1_score  INT NOT NULL CHECK (team1_score >= 0),
  team2_score  INT NOT NULL CHECK (team2_score >= 0),
  -- Knockouts only: who actually advanced (handles ET / penalty draws).
  -- Null for group-stage rows.
  advancer     TEXT,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_by   UUID REFERENCES auth.users(id)
);

ALTER TABLE match_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "everyone authenticated reads results" ON match_results;
CREATE POLICY "everyone authenticated reads results"
  ON match_results FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admin writes results" ON match_results;
CREATE POLICY "admin writes results"
  ON match_results FOR ALL
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());


-- =========================================
-- 4) predictions  — one row per (user, match)
-- =========================================
CREATE TABLE IF NOT EXISTS predictions (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id     TEXT NOT NULL,
  team1_score  INT NOT NULL CHECK (team1_score >= 0),
  team2_score  INT NOT NULL CHECK (team2_score >= 0),
  advancer     TEXT,                        -- knockouts only; nullable
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_predictions_user  ON predictions(user_id);

ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can READ all predictions (so the leaderboard /
-- "see what others picked" view works). Kickoff lock is enforced
-- client-side; this is a friends-only league.
DROP POLICY IF EXISTS "everyone authenticated reads predictions" ON predictions;
CREATE POLICY "everyone authenticated reads predictions"
  ON predictions FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "user manages own predictions" ON predictions;
CREATE POLICY "user manages own predictions"
  ON predictions FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- =========================================
-- 5) updated_at trigger (shared)
-- =========================================
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS predictions_touch ON predictions;
CREATE TRIGGER predictions_touch
  BEFORE UPDATE ON predictions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS match_results_touch ON match_results;
CREATE TRIGGER match_results_touch
  BEFORE UPDATE ON match_results
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS profiles_touch ON profiles;
CREATE TRIGGER profiles_touch
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
