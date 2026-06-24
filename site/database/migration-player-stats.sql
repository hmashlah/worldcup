-- WC2026 Player Stats — aggregated from match_detail after each sync
CREATE TABLE IF NOT EXISTS wc26_player_stats (
  name         TEXT NOT NULL,
  team         TEXT NOT NULL,
  goals        INT NOT NULL DEFAULT 0,
  penalties    INT NOT NULL DEFAULT 0,
  own_goals    INT NOT NULL DEFAULT 0,
  yellow_cards INT NOT NULL DEFAULT 0,
  red_cards    INT NOT NULL DEFAULT 0,
  motm         INT NOT NULL DEFAULT 0,
  appearances  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (name, team)
);

ALTER TABLE wc26_player_stats ENABLE ROW LEVEL SECURITY;

-- Everyone can read
DROP POLICY IF EXISTS "wc26 anyone reads player stats" ON wc26_player_stats;
CREATE POLICY "wc26 anyone reads player stats"
  ON wc26_player_stats FOR SELECT TO authenticated
  USING (true);

-- Service role writes (sync function)
DROP POLICY IF EXISTS "wc26 service writes player stats" ON wc26_player_stats;
CREATE POLICY "wc26 service writes player stats"
  ON wc26_player_stats FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
