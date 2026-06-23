import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useAllPredictions, type PredictionRow } from '@/hooks/usePredictions';
import { useResults } from '@/hooks/useResults';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useProfiles } from '@/hooks/useProfiles';
import { scorePrediction } from '@/lib/scoring';
import { isMatchKO } from '@/lib/utils';
import type { TournamentData, GroupMatch, KoMatch } from '@/lib/types';

interface Props {
  opponentId: string;
  onClose: () => void;
}

interface CompareRow {
  matchId: string;
  team1: string;
  team2: string;
  myPred: string;
  myPts: number;
  theirPred: string;
  theirPts: number;
}

/** Build a matchId → {team1, team2} lookup from tournament data. */
function buildMatchTeams(data: TournamentData): Record<string, { team1: string; team2: string }> {
  const map: Record<string, { team1: string; team2: string }> = {};
  for (const matches of Object.values(data.group_matches)) {
    for (const m of matches as GroupMatch[]) {
      map[m.id] = { team1: m.team1, team2: m.team2 };
    }
  }
  for (const m of data.ko_matches as KoMatch[]) {
    map[m.id] = { team1: m.team1, team2: m.team2 };
  }
  return map;
}

export function PlayerComparison({ opponentId, onClose }: Props) {
  const { user } = useAuth();
  const predsQ = useAllPredictions();
  const resultsQ = useResults();
  const dataQ = useTournamentData();
  const profilesQ = useProfiles();

  const comparison = useMemo(() => {
    if (!user || !predsQ.data || !resultsQ.data || !dataQ.data || !profilesQ.data) return null;

    const myId = user.id;
    const matchTeams = buildMatchTeams(dataQ.data);

    // Index predictions by (user_id, match_id)
    const predsByUser: Record<string, Record<string, PredictionRow>> = {};
    for (const p of predsQ.data) {
      if (!predsByUser[p.user_id]) predsByUser[p.user_id] = {};
      predsByUser[p.user_id][p.match_id] = p;
    }

    const myPreds = predsByUser[myId] ?? {};
    const theirPreds = predsByUser[opponentId] ?? {};

    const rows: CompareRow[] = [];
    let myTotal = 0;
    let theirTotal = 0;
    let iWon = 0;
    let theyWon = 0;
    let ties = 0;

    // Iterate over matches where both have predictions AND a result exists
    for (const matchId of Object.keys(myPreds)) {
      const myP = myPreds[matchId];
      const theirP = theirPreds[matchId];
      const result = resultsQ.data[matchId];
      if (!myP || !theirP || !result) continue;

      const isKO = isMatchKO(dataQ.data, matchId);
      const myPts = scorePrediction(
        { team1: myP.team1_score, team2: myP.team2_score },
        { team1: result.team1_score, team2: result.team2_score },
        isKO,
        myP.advancer,
        result.advancer,
      );
      const theirPts = scorePrediction(
        { team1: theirP.team1_score, team2: theirP.team2_score },
        { team1: result.team1_score, team2: result.team2_score },
        isKO,
        theirP.advancer,
        result.advancer,
      );

      myTotal += myPts;
      theirTotal += theirPts;
      if (myPts > theirPts) iWon++;
      else if (theirPts > myPts) theyWon++;
      else ties++;

      const teams = matchTeams[matchId] ?? { team1: '?', team2: '?' };
      rows.push({
        matchId,
        team1: teams.team1,
        team2: teams.team2,
        myPred: `${myP.team1_score}-${myP.team2_score}`,
        myPts,
        theirPred: `${theirP.team1_score}-${theirP.team2_score}`,
        theirPts,
      });
    }

    const opponentName = profilesQ.data[opponentId]?.display_name ?? 'Friend';
    const myName = profilesQ.data[myId]?.display_name ?? 'You';

    return { rows, myTotal, theirTotal, iWon, theyWon, ties, opponentName, myName };
  }, [user, predsQ.data, resultsQ.data, dataQ.data, profilesQ.data, opponentId]);

  if (!comparison) {
    return (
      <div className="compare-overlay" onClick={onClose}>
        <div className="compare-card" onClick={e => e.stopPropagation()}>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  const { rows, myTotal, theirTotal, iWon, theyWon, ties, opponentName, myName } = comparison;

  return (
    <div className="compare-overlay" onClick={onClose}>
      <div className="compare-card" onClick={e => e.stopPropagation()}>
        <button className="compare-close" onClick={onClose} aria-label="Close">&times;</button>

        <div className="compare-header">
          <div className="compare-player">
            <span className="compare-player-name">{myName}</span>
            <span className="compare-player-pts">{myTotal}</span>
          </div>
          <span className="compare-vs">vs</span>
          <div className="compare-player">
            <span className="compare-player-name">{opponentName}</span>
            <span className="compare-player-pts">{theirTotal}</span>
          </div>
        </div>

        <div className="compare-summary">
          <span className="compare-summary-win">You won: <strong>{iWon}</strong></span>
          <span className="compare-summary-lose">They won: <strong>{theyWon}</strong></span>
          <span className="compare-summary-tie">Tied: <strong>{ties}</strong></span>
        </div>

        {rows.length === 0 ? (
          <p className="compare-empty">No matches to compare yet.</p>
        ) : (
          <div className="compare-list">
            <div className="compare-list-head">
              <span>Match</span>
              <span>{myName}</span>
              <span>{opponentName}</span>
            </div>
            {rows.map(r => {
              const meWon = r.myPts > r.theirPts;
              const theyWonRow = r.theirPts > r.myPts;
              return (
                <div key={r.matchId} className="compare-row">
                  <span className="compare-match">{r.team1} vs {r.team2}</span>
                  <span className={'compare-cell' + (meWon ? ' compare-winner' : '')}>
                    {r.myPred} <em>({r.myPts})</em>
                  </span>
                  <span className={'compare-cell' + (theyWonRow ? ' compare-winner' : '')}>
                    {r.theirPred} <em>({r.theirPts})</em>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
