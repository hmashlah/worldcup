import { useEffect, useState } from 'react';
import { Flag } from '@/components/Flag';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useResults } from '@/hooks/useResults';
import { useUI } from '@/lib/ui-store';
import { allMatches } from '@/lib/days';
import { resolveSlot } from '@/lib/tournament';
import { supabase } from '@/lib/supabase';
import type { ScoreMap, AdvancerMap } from '@/lib/types';
import type { PlayerStat, TeamStat } from '@/lib/stats';

interface Props {
  team: string;
}

export function TeamPage({ team }: Props) {
  const dataQ = useTournamentData();
  const resultsQ = useResults();
  const closeTeam = useUI(s => s.closeTeam);
  const openPlayer = useUI(s => s.openPlayer);
  const [squad, setSquad] = useState<PlayerStat[]>([]);
  const [teamInfo, setTeamInfo] = useState<TeamStat | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: players }, { data: tInfo }] = await Promise.all([
        supabase.from('wc26_player_stats').select('*').eq('team', team).order('shirt_number', { ascending: true }),
        supabase.from('wc26_team_stats').select('*').eq('team', team).maybeSingle(),
      ]);
      if (players) setSquad(players as PlayerStat[]);
      if (tInfo) setTeamInfo(tInfo as TeamStat);
    })();
  }, [team]);

  if (!dataQ.data) return null;

  const data = dataQ.data;
  const results = resultsQ.data ?? {};
  const scores: ScoreMap = {};
  const advancers: AdvancerMap = {};
  for (const [id, r] of Object.entries(results)) {
    scores[id] = { team1: r.team1_score, team2: r.team2_score };
    advancers[id] = r.advancer;
  }

  const matches = allMatches(data).filter(m => {
    if (!m.isKO) return m.team1 === team || m.team2 === team;
    const t1 = resolveSlot(data, scores, advancers, m.team1);
    const t2 = resolveSlot(data, scores, advancers, m.team2);
    return t1 === team || t2 === team;
  });

  return (
    <section className="tab-panel active">
      <button type="button" className="page-back" onClick={closeTeam}>← Back</button>

      <div className="team-page-header">
        <Flag team={team} />
        <h2>{team}</h2>
      </div>

      {/* Coach + stats */}
      {teamInfo && (
        <div className="team-page-info">
          {teamInfo.coach && <div className="team-page-coach">Coach: <strong>{teamInfo.coach}</strong></div>}
          <div className="team-page-stats">
            <span className="player-stat">⚽ {teamInfo.goals_for} scored</span>
            <span className="player-stat">{teamInfo.goals_against} conceded</span>
            {teamInfo.penalties > 0 && <span className="player-stat">{teamInfo.penalties} pen</span>}
            {teamInfo.yellow_cards > 0 && <span className="player-stat">🟨 {teamInfo.yellow_cards}</span>}
            {teamInfo.red_cards > 0 && <span className="player-stat">🟥 {teamInfo.red_cards}</span>}
          </div>
        </div>
      )}

      {/* Matches */}
      <div className="team-page-section">
        <h3>Matches</h3>
        <div className="team-page-matches">
          {matches.map(m => {
            const result = results[m.id];
            let displayTeam1 = m.team1;
            let displayTeam2 = m.team2;
            if (m.isKO) {
              displayTeam1 = resolveSlot(data, scores, advancers, m.team1) ?? m.team1;
              displayTeam2 = resolveSlot(data, scores, advancers, m.team2) ?? m.team2;
            }
            const dateLabel = new Date(m.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

            return (
              <div className="tm-match-row" key={m.id}>
                <div className="tm-teams">
                  <span className="tm-team tm-team--left">
                    <Flag team={displayTeam1} /><span>{displayTeam1}</span>
                  </span>
                  {result ? (
                    <span className="tm-score">{result.team1_score} – {result.team2_score}</span>
                  ) : (
                    <span className="tm-vs">vs</span>
                  )}
                  <span className="tm-team tm-team--right">
                    <span>{displayTeam2}</span><Flag team={displayTeam2} />
                  </span>
                </div>
                <div className="tm-meta">
                  {result ? 'FT' : m.time.replace(/\s*UTC.*/, '')} · {dateLabel}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Squad */}
      {squad.length > 0 && (
        <div className="team-page-section">
          <h3>Squad</h3>
          {(['GK', 'DF', 'MF', 'FW', null] as const).map(pos => {
            const players = squad.filter(p => p.position === pos || (!pos && !p.position));
            if (players.length === 0) return null;
            return (
              <div key={pos ?? 'other'} className="tm-squad-group">
                <div className="tm-squad-pos">{pos === 'GK' ? 'Goalkeepers' : pos === 'DF' ? 'Defenders' : pos === 'MF' ? 'Midfielders' : pos === 'FW' ? 'Forwards' : 'Other'}</div>
                {players.map(p => (
                  <button
                    key={p.name}
                    type="button"
                    className="tm-squad-player"
                    onClick={() => openPlayer(p.name, p.team)}
                  >
                    {p.shirt_number && <span className="tm-squad-num">{p.shirt_number}</span>}
                    <span className="tm-squad-name">{p.name}</span>
                    {p.club && <span className="tm-squad-club">{p.club}</span>}
                    {p.goals > 0 && <span className="tm-squad-stat">⚽{p.goals}</span>}
                    {p.yellow_cards > 0 && <span className="tm-squad-stat">🟨</span>}
                    {p.red_cards > 0 && <span className="tm-squad-stat">🟥</span>}
                    {p.motm > 0 && <span className="tm-squad-stat">⭐</span>}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
