import { useState } from 'react';
import { Flag } from '@/components/Flag';
import { MatchCard } from '@/components/MatchCard';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useResults } from '@/hooks/useResults';
import { computeStandings, getThirdPlacedRanking } from '@/lib/tournament';
import type { Group, ScoreMap } from '@/lib/types';

interface CardProps { group: Group; isThirdQualified: boolean }

function GroupCardCompact({ group, isThirdQualified }: CardProps) {
  const dataQ = useTournamentData();
  const resultsQ = useResults();
  const [expanded, setExpanded] = useState(false);

  const scores: ScoreMap = {};
  for (const [id, r] of Object.entries(resultsQ.data ?? {})) {
    scores[id] = { team1: r.team1_score, team2: r.team2_score };
  }
  const standings = dataQ.data ? computeStandings(dataQ.data, group, scores) : [];
  const matches = dataQ.data?.group_matches[group.name] ?? [];

  return (
    <div
      className={`gc ${expanded ? 'gc-expanded' : ''}`}
      data-group={group.name.split(' ').pop() /* "A" .. "L" */}
    >
      <button
        type="button"
        className="gc-header"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
      >
        <span className="gc-title">{group.name}</span>
        <span className="gc-toggle">{expanded ? '×' : 'matches →'}</span>
      </button>

      <table className="gc-table">
        <thead>
          <tr>
            <th className="team-col">Team</th>
            <th>P</th><th>W</th><th>D</th><th>L</th>
            <th>GD</th><th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((t, i) => {
            const cls =
              i < 2 ? 'qualified'
              : (i === 2 && isThirdQualified ? 'qualified'
              : i === 2 ? 'third-tied' : '');
            return (
              <tr className={cls} key={t.team}>
                <td className="team-col"><Flag team={t.team} /><span>{t.team}</span></td>
                <td>{t.P}</td><td>{t.W}</td><td>{t.D}</td><td>{t.L}</td>
                <td>{t.GD > 0 ? `+${t.GD}` : t.GD}</td>
                <td className="pts">{t.Pts}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {expanded && (
        <div className="gc-matches">
          {matches.map(m => (
            <MatchCard
              key={m.id}
              matchId={m.id}
              team1={m.team1}
              team2={m.team2}
              team1IsResolved
              team2IsResolved
              date={m.date}
              time={m.time}
              ground={m.ground}
              showDate
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function GroupsGridView() {
  const dataQ = useTournamentData();
  const resultsQ = useResults();
  if (!dataQ.data) return null;

  const scores: ScoreMap = {};
  for (const [id, r] of Object.entries(resultsQ.data ?? {})) {
    scores[id] = { team1: r.team1_score, team2: r.team2_score };
  }
  const ranking = getThirdPlacedRanking(dataQ.data, scores);
  const top8Thirds = new Set(ranking.slice(0, 8).map(t => t.group));

  return (
    <div className="gc-grid">
      {dataQ.data.groups.map(g => (
        <GroupCardCompact
          key={g.name}
          group={g}
          isThirdQualified={top8Thirds.has(g.name)}
        />
      ))}
    </div>
  );
}
