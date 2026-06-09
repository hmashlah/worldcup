-- =====================================================================
-- WC2026 Prediction League — Supabase schema (idempotent, namespaced)
-- All objects prefixed with `wc26_` so they don't collide with other
-- tables/functions in the same Supabase project.
-- Paste the whole block into the SQL editor and click Run.
-- =====================================================================

-- ── 1) wc26_profiles ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wc26_profiles (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  approved     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- If the table already existed without `approved`, add the column.
ALTER TABLE wc26_profiles
  ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE wc26_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wc26 anyone authenticated reads profiles" ON wc26_profiles;
CREATE POLICY "wc26 anyone authenticated reads profiles"
  ON wc26_profiles FOR SELECT TO authenticated USING (true);

-- Owners can read/insert their row + update display_name, but NOT the
-- `approved` flag. The trigger seeds approved=false (or true for admin).
-- Only the admin policy below can flip `approved`.
DROP POLICY IF EXISTS "wc26 user manages own profile" ON wc26_profiles;
DROP POLICY IF EXISTS "wc26 user inserts own profile" ON wc26_profiles;
DROP POLICY IF EXISTS "wc26 user updates own non-approval fields" ON wc26_profiles;
DROP POLICY IF EXISTS "wc26 user deletes own profile" ON wc26_profiles;

CREATE POLICY "wc26 user inserts own profile"
  ON wc26_profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- User may update their own row but not the approved flag.
CREATE POLICY "wc26 user updates own non-approval fields"
  ON wc26_profiles FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND approved = (SELECT p.approved FROM wc26_profiles p WHERE p.user_id = auth.uid())
  );

CREATE POLICY "wc26 user deletes own profile"
  ON wc26_profiles FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ── 2) wc26_is_admin() ────────────────────────────────────────────────
-- Edit the email below if your admin email ever changes.
CREATE OR REPLACE FUNCTION wc26_is_admin()
RETURNS BOOLEAN AS $$
  SELECT lower(coalesce(auth.jwt() ->> 'email', '')) = lower('hmashlah@gmail.com');
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Admin can update any profile (used to approve / revoke users).
DROP POLICY IF EXISTS "wc26 admin updates any profile" ON wc26_profiles;
CREATE POLICY "wc26 admin updates any profile"
  ON wc26_profiles FOR UPDATE TO authenticated
  USING (wc26_is_admin())
  WITH CHECK (wc26_is_admin());

-- Helper: is the current authenticated user approved?
CREATE OR REPLACE FUNCTION wc26_is_approved()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT approved FROM wc26_profiles WHERE user_id = auth.uid()),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;


-- ── 3) wc26_match_results (admin-entered actuals) ─────────────────────
CREATE TABLE IF NOT EXISTS wc26_match_results (
  match_id     TEXT PRIMARY KEY,
  team1_score  INT NOT NULL CHECK (team1_score >= 0),
  team2_score  INT NOT NULL CHECK (team2_score >= 0),
  advancer     TEXT,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_by   UUID REFERENCES auth.users(id)
);

ALTER TABLE wc26_match_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wc26 everyone authenticated reads results" ON wc26_match_results;
CREATE POLICY "wc26 everyone authenticated reads results"
  ON wc26_match_results FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "wc26 admin writes results" ON wc26_match_results;
CREATE POLICY "wc26 admin writes results"
  ON wc26_match_results FOR ALL TO authenticated
  USING (wc26_is_admin())
  WITH CHECK (wc26_is_admin());


-- ── 4) wc26_predictions (one row per user × match) ────────────────────
CREATE TABLE IF NOT EXISTS wc26_predictions (
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id     TEXT NOT NULL,
  team1_score  INT NOT NULL CHECK (team1_score >= 0),
  team2_score  INT NOT NULL CHECK (team2_score >= 0),
  advancer     TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, match_id)
);

CREATE INDEX IF NOT EXISTS idx_wc26_predictions_match ON wc26_predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_wc26_predictions_user  ON wc26_predictions(user_id);

ALTER TABLE wc26_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wc26 everyone authenticated reads predictions" ON wc26_predictions;
CREATE POLICY "wc26 everyone authenticated reads predictions"
  ON wc26_predictions FOR SELECT TO authenticated USING (true);

-- Only approved users (or admin) may write their own predictions.
DROP POLICY IF EXISTS "wc26 user manages own predictions" ON wc26_predictions;
DROP POLICY IF EXISTS "wc26 approved user inserts own predictions" ON wc26_predictions;
DROP POLICY IF EXISTS "wc26 approved user updates own predictions" ON wc26_predictions;
DROP POLICY IF EXISTS "wc26 approved user deletes own predictions" ON wc26_predictions;

CREATE POLICY "wc26 approved user inserts own predictions"
  ON wc26_predictions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND (wc26_is_approved() OR wc26_is_admin()));

CREATE POLICY "wc26 approved user updates own predictions"
  ON wc26_predictions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND (wc26_is_approved() OR wc26_is_admin()))
  WITH CHECK (auth.uid() = user_id AND (wc26_is_approved() OR wc26_is_admin()));

CREATE POLICY "wc26 approved user deletes own predictions"
  ON wc26_predictions FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND (wc26_is_approved() OR wc26_is_admin()));


-- ── 5) shared wc26_touch_updated_at trigger ───────────────────────────
CREATE OR REPLACE FUNCTION wc26_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wc26_profiles_touch        ON wc26_profiles;
DROP TRIGGER IF EXISTS wc26_predictions_touch     ON wc26_predictions;
DROP TRIGGER IF EXISTS wc26_match_results_touch   ON wc26_match_results;

CREATE TRIGGER wc26_profiles_touch
  BEFORE UPDATE ON wc26_profiles
  FOR EACH ROW EXECUTE FUNCTION wc26_touch_updated_at();

CREATE TRIGGER wc26_predictions_touch
  BEFORE UPDATE ON wc26_predictions
  FOR EACH ROW EXECUTE FUNCTION wc26_touch_updated_at();

CREATE TRIGGER wc26_match_results_touch
  BEFORE UPDATE ON wc26_match_results
  FOR EACH ROW EXECUTE FUNCTION wc26_touch_updated_at();


-- ── 6) auto-create wc26_profiles row on signup ────────────────────────
-- Note: this fires on EVERY auth.users insert, regardless of which app
-- the user signed up through. Display name is stored only in wc26_profiles
-- so it can't clash with profile tables for your other projects.
--
-- The function MUST NOT block signup if it fails — otherwise Supabase
-- reports a generic "database error saving new user" and the user is lost.
-- We catch any exception, log a warning, and let auth.users insert proceed.
CREATE OR REPLACE FUNCTION wc26_handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.wc26_profiles (user_id, display_name, approved)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1)),
    -- Admin email is auto-approved; everyone else must be approved by admin.
    lower(coalesce(NEW.email, '')) = lower('hmashlah@gmail.com')
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wc26_handle_new_user failed for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- Ensure the function (running as its owner) can write. Even SECURITY DEFINER
-- functions can be denied by RLS if the owner lacks privileges.
GRANT INSERT, SELECT ON public.wc26_profiles TO postgres, service_role;
ALTER FUNCTION wc26_handle_new_user() OWNER TO postgres;

DROP TRIGGER IF EXISTS on_auth_user_created_wc26 ON auth.users;
CREATE TRIGGER on_auth_user_created_wc26
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION wc26_handle_new_user();


-- ── 7) Backfill: ensure admin email is always approved ────────────────
-- Idempotent. Safe to re-run. Approves any profile whose user_id matches
-- the configured admin email in auth.users.
UPDATE wc26_profiles p
   SET approved = TRUE
  FROM auth.users u
 WHERE p.user_id = u.id
   AND lower(u.email) = lower('hmashlah@gmail.com')
   AND p.approved = FALSE;
