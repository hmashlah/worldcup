-- =====================================================================
-- Migration: wiki_scorers → match_detail
-- Run this in Supabase SQL Editor AFTER deploying the code that reads
-- from match_detail (with wiki_scorers fallback). The deploy and this
-- migration should happen within minutes of each other.
-- =====================================================================

-- 1. Add the new column
ALTER TABLE wc26_match_results
  ADD COLUMN IF NOT EXISTS match_detail JSONB;

-- 2. Migrate existing wiki_scorers data into match_detail.goals
UPDATE wc26_match_results
SET match_detail = jsonb_build_object('goals', wiki_scorers)
WHERE wiki_scorers IS NOT NULL
  AND match_detail IS NULL;

-- 3. (Optional, run later once confirmed) Drop the old column:
-- ALTER TABLE wc26_match_results DROP COLUMN wiki_scorers;
