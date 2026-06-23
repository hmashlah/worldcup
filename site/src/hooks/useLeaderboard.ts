import { useMemo } from 'react';
import { useAllPredictions, type PredictionRow } from '@/hooks/usePredictions';
import { useResults } from '@/hooks/useResults';
import { useLiveMatches } from '@/hooks/useLiveMatches';
import { useProfiles } from '@/hooks/useProfiles';
import { useTournamentData } from '@/hooks/useTournamentData';
import { scorePrediction } from '@/lib/scoring';
import { isMatchKO } from '@/lib/utils';

export interface LeaderboardEntry {
  user_id: string;
  display_name: string;
  total: number;
  exact: number;       // # of perfect-score predictions
  outcome: number;     // # of right-outcome (but not exact) predictions
  advancer: number;    // # of right-advancer KO bonuses
  predictions: number; // # of predictions submitted that have an actual
}

export function useLeaderboard(): {
  loading: boolean;
  entries: LeaderboardEntry[];
} {
  const dataQ = useTournamentData();
  const predsQ = useAllPredictions();
  const resultsQ = useResults();
  const liveQ = useLiveMatches();
  const profilesQ = useProfiles();

  const entries = useMemo<LeaderboardEntry[]>(() => {
    if (!dataQ.data || !predsQ.data || !resultsQ.data || !profilesQ.data) return [];

    // Exclude live (in-progress) matches — only count finished ones
    const liveIds = new Set(Object.keys(liveQ.data ?? {}));

    // Only include approved users on the leaderboard.
    const approvedIds = new Set(
      Object.values(profilesQ.data).filter(p => p.approved).map(p => p.user_id),
    );

    const byUser: Record<string, LeaderboardEntry> = {};
    const ensure = (id: string): LeaderboardEntry => {
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
      if (liveIds.has(p.match_id)) continue; // skip in-progress matches
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

    // Include approved profiles even if they have zero points.
    for (const id of approvedIds) ensure(id);

    return Object.values(byUser).sort(
      (a, b) =>
        b.total - a.total ||
        b.exact - a.exact ||
        b.outcome - a.outcome ||
        a.display_name.localeCompare(b.display_name),
    );
  }, [dataQ.data, predsQ.data, resultsQ.data, liveQ.data, profilesQ.data]);

  return {
    loading:
      dataQ.isLoading || predsQ.isLoading || resultsQ.isLoading || profilesQ.isLoading,
    entries,
  };
}
