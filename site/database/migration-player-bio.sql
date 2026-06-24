-- Add bio columns to player stats
ALTER TABLE wc26_player_stats ADD COLUMN IF NOT EXISTS position TEXT;
ALTER TABLE wc26_player_stats ADD COLUMN IF NOT EXISTS dob DATE;
ALTER TABLE wc26_player_stats ADD COLUMN IF NOT EXISTS club TEXT;
ALTER TABLE wc26_player_stats ADD COLUMN IF NOT EXISTS shirt_number INT;

-- Add coach to team stats
ALTER TABLE wc26_team_stats ADD COLUMN IF NOT EXISTS coach TEXT;
