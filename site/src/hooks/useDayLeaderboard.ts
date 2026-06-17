import { useMemo } from 'react';
import { useAllPredictions, type PredictionRow } from '@/hooks/usePredictions';
import { useResults } from '@/hooks/useResults';
import { useProfiles } from '@/hooks/useProfiles';
import { useTournamentData } from '@/hooks/useTournamentData';
import { scorePrediction } from '@/lib/scoring';
import { isKnockoutRound } from '@/lib/tournament';
import type { TournamentData } from '@/lib/types';

export interface DayLeaderboardEntry {
  user_id: string;
  display_name: string;
  total: number;
  exact: number;
  outcome: number;
  advancer: number;
  predictions: number;
}

function isMatchKO(data: TournamentData, matchId: string): boolean {
  const m = data.ko_matches.find(k => k.id === matchId);
  return !!m && isKnockoutRound(m.round);
}

/**
 * Compute a mini-leaderboard for a specific set of match IDs (e.g. one day's matches).
 * Only includes entries that have at least one scored prediction for those matches.
 */
export function useDayLeaderboard(matchIds: string[]): {
  loading: boolean;
  entries: DayLeaderboardEntry[];
  hasResults: boolean;
} {
  const dataQ = useTournamentData();
  const predsQ = useAllPredictions();
  const resultsQ = useResults();
  const profilesQ = useProfiles();

  const matchIdSet = useMemo(() => new Set(matchIds), [matchIds]);

  const { entries, hasResults } = useMemo(() => {
    if (!dataQ.data || !predsQ.data || !resultsQ.data || !profilesQ.data) {
      return { entries: [], hasResults: false };
    }

    // Check if any of the day's matches have results
    const dayResults = matchIds.filter(id => resultsQ.data![id]);
    if (dayResults.length === 0) {
      return { entries: [], hasResults: false };
    }

    const approvedIds = new Set(
      Object.values(profilesQ.data).filter(p => p.approved).map(p => p.user_id),
    );

    const byUser: Record<string, DayLeaderboardEntry> = {};
    const ensure = (id: string): DayLeaderboardEntry => {
      if (!byUser[id]) {
        byUser[id] = {
          user_id: id,
          display_name: profilesQ.data![id]?.display_name ?? 'Unknown',
          total: 0,
          exact: 0,
          outcome: 0,
          advancer: 0,
          predictions: 0,
        };
      }
      return byUser[id];
    };

    for (const p of predsQ.data as PredictionRow[]) {
      if (!approvedIds.has(p.user_id)) continue;
      if (!matchIdSet.has(p.match_id)) continue;
      const result = resultsQ.data[p.match_id];
      if (!result) continue;

      const isKO = isMatchKO(dataQ.data, p.match_id);
      const pts = scorePrediction(
        { team1: p.team1_score, team2: p.team2_score },
        { team1: result.team1_score, team2: result.team2_score },
        isKO,
        p.advancer,
        result.advancer,
      );

      const e = ensure(p.user_id);
      e.predictions++;
      e.total += pts;
      if (p.team1_score === result.team1_score && p.team2_score === result.team2_score) {
        e.exact++;
      } else if (
        Math.sign(p.team1_score - p.team2_score) ===
        Math.sign(result.team1_score - result.team2_score)
      ) {
        e.outcome++;
      }
      if (isKO && p.advancer && result.advancer && p.advancer === result.advancer) {
        e.advancer++;
      }
    }

    const sorted = Object.values(byUser).sort(
      (a, b) =>
        b.total - a.total ||
        b.exact - a.exact ||
        b.outcome - a.outcome ||
        a.display_name.localeCompare(b.display_name),
    );

    return { entries: sorted, hasResults: true };
  }, [dataQ.data, predsQ.data, resultsQ.data, profilesQ.data, matchIdSet, matchIds]);

  return {
    loading: dataQ.isLoading || predsQ.isLoading || resultsQ.isLoading || profilesQ.isLoading,
    entries,
    hasResults,
  };
}
