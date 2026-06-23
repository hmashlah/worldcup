import { useMemo } from 'react';
import { useAllPredictions, type PredictionRow } from '@/hooks/usePredictions';
import { useResults } from '@/hooks/useResults';
import { useProfiles } from '@/hooks/useProfiles';
import { useTournamentData } from '@/hooks/useTournamentData';
import { scorePrediction } from '@/lib/scoring';
import { isMatchKO } from '@/lib/utils';
import { allMatches } from '@/lib/days';

export interface TrendPoint {
  matchId: string;
  /** Short label for x-axis (e.g. "M1", "M2") */
  label: string;
  /** Cumulative points at this point */
  cumulative: number;
}

export interface PlayerTrend {
  user_id: string;
  display_name: string;
  points: TrendPoint[];
  finalTotal: number;
}

/**
 * Compute cumulative points per player across all finished matches,
 * ordered chronologically by kickoff time.
 */
export function usePointsTrend(): {
  loading: boolean;
  trends: PlayerTrend[];
  matchLabels: string[];
} {
  const dataQ = useTournamentData();
  const predsQ = useAllPredictions();
  const resultsQ = useResults();
  const profilesQ = useProfiles();

  const { trends, matchLabels } = useMemo(() => {
    if (!dataQ.data || !predsQ.data || !resultsQ.data || !profilesQ.data) {
      return { trends: [], matchLabels: [] };
    }

    // Get all matches in chronological order, filter to those with results
    const chronoMatches = allMatches(dataQ.data).filter(m => resultsQ.data![m.id]);
    if (!chronoMatches.length) return { trends: [], matchLabels: [] };

    const matchLabels = chronoMatches.map((_, i) => `${i + 1}`);

    // Only approved users
    const approvedIds = new Set(
      Object.values(profilesQ.data).filter(p => p.approved).map(p => p.user_id),
    );

    // Index predictions by (user_id, match_id) for fast lookup
    const predIndex: Record<string, PredictionRow> = {};
    for (const p of predsQ.data as PredictionRow[]) {
      if (!approvedIds.has(p.user_id)) continue;
      predIndex[`${p.user_id}:${p.match_id}`] = p;
    }

    // Build cumulative trend for each approved user
    const trends: PlayerTrend[] = [];
    for (const userId of approvedIds) {
      const profile = profilesQ.data[userId];
      if (!profile) continue;

      let cumulative = 0;
      const points: TrendPoint[] = [];

      for (let i = 0; i < chronoMatches.length; i++) {
        const m = chronoMatches[i];
        const result = resultsQ.data![m.id];
        const pred = predIndex[`${userId}:${m.id}`];

        if (pred && result) {
          const isKO = isMatchKO(dataQ.data!, m.id);
          const pts = scorePrediction(
            { team1: pred.team1_score, team2: pred.team2_score },
            { team1: result.team1_score, team2: result.team2_score },
            isKO,
            pred.advancer,
            result.advancer,
          );
          cumulative += pts;
        }

        points.push({
          matchId: m.id,
          label: matchLabels[i],
          cumulative,
        });
      }

      trends.push({
        user_id: userId,
        display_name: profile.display_name,
        points,
        finalTotal: cumulative,
      });
    }

    // Sort by final total descending (matches leaderboard order)
    trends.sort((a, b) => b.finalTotal - a.finalTotal);

    return { trends, matchLabels };
  }, [dataQ.data, predsQ.data, resultsQ.data, profilesQ.data]);

  return {
    loading: dataQ.isLoading || predsQ.isLoading || resultsQ.isLoading || profilesQ.isLoading,
    trends,
    matchLabels,
  };
}
