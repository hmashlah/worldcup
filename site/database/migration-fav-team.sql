-- Add fav_team column to profiles
ALTER TABLE wc26_profiles ADD COLUMN IF NOT EXISTS fav_team TEXT;
