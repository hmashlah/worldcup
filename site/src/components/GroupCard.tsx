import { Flag } from '@/components/Flag';
import { MatchRow } from '@/components/MatchRow';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useResults } from '@/hooks/useResults';
import { computeStandings, getThirdPlacedRanking } from '@/lib/tournament';
import type { Group, ScoreMap } from '@/lib/types';

interface Props { group: Group; isThirdQualified: boolean }

export function GroupCard({ group, isThirdQualified }: Props) {
  const dataQ = useTournamentData();
  const resultsQ = useResults();

  const scores: ScoreMap = {};
  if (resultsQ.data) {
    for (const [id, r] of Object.entries(resultsQ.data)) {
      scores[id] = { team1: r.team1_score, team2: r.team2_score };
    }
  }
  const standings = dataQ.data ? computeStandings(dataQ.data, group, scores) : [];

  return (
    <div className="group-card" data-group={group.name}>
      <div className="group-title">{group.name}</div>

      <table className="standings">
        <thead>
          <tr>
            <th className="team-col">Team</th>
            <th>P</th><th>W</th><th>D</th><th>L</th>
            <th>GF</th><th>GA</th><th>GD</th><th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((t, i) => {
            const cls = i < 2 ? 'qualified' : (i === 2 && isThirdQualified ? 'qualified' : i === 2 ? 'third-tied' : '');
            return (
              <tr className={cls} key={t.team}>
                <td className="team-col"><Flag team={t.team} /><span>{t.team}</span></td>
                <td>{t.P}</td><td>{t.W}</td><td>{t.D}</td><td>{t.L}</td>
                <td>{t.GF}</td><td>{t.GA}</td>
                <td>{t.GD > 0 ? `+${t.GD}` : t.GD}</td>
                <td className="pts">{t.Pts}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="match-list">
        {dataQ.data?.group_matches[group.name].map(m => (
          <MatchRow
            key={m.id}
            matchId={m.id}
            team1={m.team1}
            team2={m.team2}
            team1IsResolved
            team2IsResolved
            date={m.date}
            time={m.time}
            ground={m.ground}
            variant="group"
          />
        ))}
      </div>
    </div>
  );
}

/** Helper: which group letters' third-placers are currently top-8. */
export function useQualifiedThirds(): Set<string> {
  const dataQ = useTournamentData();
  const resultsQ = useResults();
  if (!dataQ.data || !resultsQ.data) return new Set();
  const scores: ScoreMap = {};
  for (const [id, r] of Object.entries(resultsQ.data)) {
    scores[id] = { team1: r.team1_score, team2: r.team2_score };
  }
  const ranking = getThirdPlacedRanking(dataQ.data, scores);
  return new Set(ranking.slice(0, 8).map(t => t.group));
}
