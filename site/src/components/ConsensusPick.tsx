import { useMemo } from 'react';
import { useAllPredictions, type PredictionRow } from '@/hooks/usePredictions';
import { useProfiles } from '@/hooks/useProfiles';

interface Props {
  matchId: string;
  team1: string;
  team2: string;
}

interface Distribution {
  team1WinPct: number;
  drawPct: number;
  team2WinPct: number;
  avgTeam1: string;
  avgTeam2: string;
  totalPicks: number;
}

/**
 * Compact inline prediction consensus — shows outcome distribution
 * as a horizontal bar + average predicted score.
 * Only renders after kickoff (caller gates on `locked`).
 */
export function ConsensusPick({ matchId, team1, team2 }: Props) {
  const predsQ = useAllPredictions();
  const profilesQ = useProfiles();

  const dist = useMemo<Distribution | null>(() => {
    if (!predsQ.data || !profilesQ.data) return null;

    // Only count approved users
    const approvedIds = new Set(
      Object.values(profilesQ.data).filter(p => p.approved).map(p => p.user_id),
    );

    const picks = (predsQ.data as PredictionRow[]).filter(
      p => p.match_id === matchId && approvedIds.has(p.user_id),
    );

    if (picks.length < 2) return null;

    let team1Wins = 0;
    let draws = 0;
    let team2Wins = 0;
    let sumT1 = 0;
    let sumT2 = 0;

    for (const p of picks) {
      sumT1 += p.team1_score;
      sumT2 += p.team2_score;
      if (p.team1_score > p.team2_score) team1Wins++;
      else if (p.team1_score < p.team2_score) team2Wins++;
      else draws++;
    }

    const total = picks.length;
    return {
      team1WinPct: Math.round((team1Wins / total) * 100),
      drawPct: Math.round((draws / total) * 100),
      team2WinPct: Math.round((team2Wins / total) * 100),
      avgTeam1: (sumT1 / total).toFixed(1),
      avgTeam2: (sumT2 / total).toFixed(1),
      totalPicks: total,
    };
  }, [predsQ.data, profilesQ.data, matchId]);

  if (!dist) return null;

  return (
    <div className="consensus">
      <div className="consensus-header">
        <span className="consensus-label">league consensus</span>
        <span className="consensus-avg">{dist.avgTeam1} – {dist.avgTeam2} avg</span>
      </div>
      <div className="consensus-bar">
        {dist.team1WinPct > 0 && (
          <div
            className="consensus-seg consensus-seg-t1"
            style={{ width: `${dist.team1WinPct}%` }}
            title={`${team1} win: ${dist.team1WinPct}%`}
          >
            {dist.team1WinPct >= 15 && <span>{dist.team1WinPct}%</span>}
          </div>
        )}
        {dist.drawPct > 0 && (
          <div
            className="consensus-seg consensus-seg-draw"
            style={{ width: `${dist.drawPct}%` }}
            title={`Draw: ${dist.drawPct}%`}
          >
            {dist.drawPct >= 15 && <span>{dist.drawPct}%</span>}
          </div>
        )}
        {dist.team2WinPct > 0 && (
          <div
            className="consensus-seg consensus-seg-t2"
            style={{ width: `${dist.team2WinPct}%` }}
            title={`${team2} win: ${dist.team2WinPct}%`}
          >
            {dist.team2WinPct >= 15 && <span>{dist.team2WinPct}%</span>}
          </div>
        )}
      </div>
      <div className="consensus-legend">
        <span className="consensus-legend-item consensus-legend-t1">{team1}</span>
        <span className="consensus-legend-item consensus-legend-draw">Draw</span>
        <span className="consensus-legend-item consensus-legend-t2">{team2}</span>
      </div>
    </div>
  );
}
