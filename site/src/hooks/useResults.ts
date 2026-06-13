import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ResultRow {
  match_id: string;
  team1_score: number;
  team2_score: number;
  advancer: string | null;
  /** 'admin' for manual entries, 'api' for football-data.org auto-fill. */
  source?: 'admin' | 'api';
  /** Raw football-data.org match record (only set when source='api'). */
  payload?: FdMatchPayload | null;
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

/** Actual results, indexed by match_id. Anyone authenticated can read. */
export function useResults() {
  return useQuery({
    queryKey: ['match_results'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wc26_match_results')
        .select('match_id, team1_score, team2_score, advancer, source, payload');
      if (error) throw error;
      const map: Record<string, ResultRow> = {};
      for (const r of (data ?? []) as ResultRow[]) map[r.match_id] = r;
      return map;
    },
    // Match useLiveMatches' cadence — when a match transitions from
    // live to finished, the new row lands in wc26_match_results within
    // ~15s of the cron firing, and we want the page to flip from "LIVE"
    // to "Result" without a manual refresh. Idle tabs drop to 60s.
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
    },
  });
}
