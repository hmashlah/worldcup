import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { MatchDetail } from '@/lib/match-detail';

/** Slim row used by every list view (leaderboard, match cards, bracket).
 *  Excludes the FD payload (which can be ~1.5 KB per row) — that's
 *  fetched separately via useMatchResult only when a detail page opens.
 *  Saves ~40× on egress for the polling that runs on every page load. */
export interface ResultRow {
  match_id: string;
  team1_score: number;
  team2_score: number;
  advancer: string | null;
  /** 'admin' for manual entries, 'api' for football-data.org auto-fill. */
  source?: 'admin' | 'api';
}

/** Full row including FD payload — only used by MatchDetailPage. */
export interface FullResultRow extends ResultRow {
  payload?: FdMatchPayload | null;
  /** Consolidated match enrichment (goals, lineups, cards, etc).
   *  Primary source. Falls back to wiki_scorers if not yet populated. */
  match_detail?: MatchDetail | null;
  /** @deprecated — legacy goal scorers column. Use match_detail.goals instead.
   *  Kept for backwards compatibility during migration. */
  wiki_scorers?: WikiGoal[] | null;
}

/** A single goal as parsed from the Wikipedia tournament article. */
export interface WikiGoal {
  team: 'home' | 'away';
  name: string;
  minute: number;
  /** Stoppage-time minutes (the "+3" in 90+3'). */
  extraTime?: number;
  kind: 'goal' | 'penalty' | 'own-goal';
}

/** Subset of football-data.org match record we actually display. */
export interface FdMatchPayload {
  id: number;
  utcDate: string;
  status: string;
  stage?: string;
  group?: string;
  matchday?: number;
  venue?: string | null;
  homeTeam: { id: number; name: string; tla?: string; crest?: string };
  awayTeam: { id: number; name: string; tla?: string; crest?: string };
  score: {
    winner: 'HOME_TEAM' | 'AWAY_TEAM' | 'DRAW' | null;
    duration: 'REGULAR' | 'EXTRA_TIME' | 'PENALTY_SHOOTOUT' | null;
    fullTime?: { home: number | null; away: number | null };
    halfTime?: { home: number | null; away: number | null };
  };
  referees?: Array<{ id: number; name: string; type: string; nationality?: string }>;
}

export interface ResultDraft {
  match_id: string;
  team1_score: number;
  team2_score: number;
  advancer?: string | null;
}

/**
 * Actual results, indexed by match_id. Slim columns only — pulls scores
 * + advancer + source for every match in the tournament. Use
 * useMatchResult for the rich payload (referees / half-time / duration)
 * on the match detail page.
 *
 * Polled at 60s focused / 5min background. The leaderboard and match
 * cards re-render the moment the row changes, so a 60s lag on a finished
 * match feels reasonable — and it keeps egress within free-tier limits.
 * The hot live data (in-progress scores) lives in a separate table
 * (wc26_match_live) that polls faster.
 */
export function useResults() {
  return useQuery({
    queryKey: ['match_results'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wc26_match_results')
        .select('match_id, team1_score, team2_score, advancer, source');
      if (error) throw error;
      const map: Record<string, ResultRow> = {};
      for (const r of (data ?? []) as ResultRow[]) map[r.match_id] = r;
      return map;
    },
    refetchInterval: () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return 5 * 60_000;
      }
      return 60_000;
    },
    refetchOnWindowFocus: true,
  });
}

/**
 * Full result row including the FD payload, fetched per-match. Used by
 * MatchDetailPage so we don't fan the ~1.5 KB payload across every
 * polling tick of the bulk results query. Refetches at the same
 * cadence as wc26_match_live so referee / half-time data appears
 * promptly during play.
 */
export function useMatchResult(matchId: string | null) {
  return useQuery({
    queryKey: ['match_result', matchId],
    enabled: !!matchId,
    queryFn: async () => {
      if (!matchId) return null;
      const { data, error } = await supabase
        .from('wc26_match_results')
        .select('match_id, team1_score, team2_score, advancer, source, payload, match_detail, wiki_scorers')
        .eq('match_id', matchId)
        .maybeSingle();
      if (error) throw error;
      return (data as FullResultRow | null) ?? null;
    },
    refetchInterval: () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return 60_000;
      }
      return 15_000;
    },
    refetchOnWindowFocus: true,
  });
}

export function useUpsertResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: ResultDraft) => {
      const { error } = await supabase
        .from('wc26_match_results')
        .upsert(
          {
            match_id: draft.match_id,
            team1_score: draft.team1_score,
            team2_score: draft.team2_score,
            advancer: draft.advancer ?? null,
            // Mark explicit admin entries so the cron sync won't ever
            // overwrite them. If admin corrects an API-sourced row, this
            // promotes it to admin-locked.
            source: 'admin',
          },
          { onConflict: 'match_id' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match_results'] });
      qc.invalidateQueries({ queryKey: ['match_result'] });
    },
  });
}

/** Admin: remove an actual result (e.g. typed it wrong, want to clear it). */
export function useDeleteResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (matchId: string) => {
      const { error } = await supabase
        .from('wc26_match_results')
        .delete()
        .eq('match_id', matchId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match_results'] });
      qc.invalidateQueries({ queryKey: ['match_result'] });
    },
  });
}
