-- WC2026 Team Stats — aggregated from match results + match_detail
CREATE TABLE IF NOT EXISTS wc26_team_stats (
  team           TEXT PRIMARY KEY,
  goals_for      INT NOT NULL DEFAULT 0,
  goals_against  INT NOT NULL DEFAULT 0,
  penalties      INT NOT NULL DEFAULT 0,
  yellow_cards   INT NOT NULL DEFAULT 0,
  red_cards      INT NOT NULL DEFAULT 0
);

ALTER TABLE wc26_team_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wc26 anyone reads team stats" ON wc26_team_stats;
CREATE POLICY "wc26 anyone reads team stats"
  ON wc26_team_stats FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "wc26 service writes team stats" ON wc26_team_stats;
CREATE POLICY "wc26 service writes team stats"
  ON wc26_team_stats FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
