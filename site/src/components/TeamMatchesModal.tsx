import { useEffect, useState } from 'react';
import { Flag } from '@/components/Flag';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useResults } from '@/hooks/useResults';
import { useUI } from '@/lib/ui-store';
import { allMatches } from '@/lib/days';
import { resolveSlot } from '@/lib/tournament';
import { supabase } from '@/lib/supabase';
import { PlayerModal } from '@/components/PlayerModal';
import type { ScoreMap, AdvancerMap } from '@/lib/types';
import type { PlayerStat, TeamStat } from '@/lib/stats';

interface Props {
  team: string;
  onClose: () => void;
}

export function TeamMatchesModal({ team, onClose }: Props) {
  const dataQ = useTournamentData();
  const resultsQ = useResults();
  const openMatchId = useUI(s => s.openMatchId);
  const [squad, setSquad] = useState<PlayerStat[]>([]);
  const [teamInfo, setTeamInfo] = useState<TeamStat | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<{ name: string; team: string } | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Fetch squad and team info
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

  // Hide when match detail is open
  if (openMatchId) return null;
  if (!dataQ.data) return null;

  const data = dataQ.data;
  const results = resultsQ.data ?? {};

  // Build score and advancer maps
  const scores: ScoreMap = {};
  const advancers: AdvancerMap = {};
  for (const [id, r] of Object.entries(results)) {
    scores[id] = { team1: r.team1_score, team2: r.team2_score };
    advancers[id] = r.advancer;
  }

  // Get all matches and filter for this team
  const matches = allMatches(data).filter(m => {
    if (!m.isKO) {
      // Group matches always have real team names
      return m.team1 === team || m.team2 === team;
    }
    // KO matches: resolve the slot to check if this team is involved
    const t1 = resolveSlot(data, scores, advancers, m.team1);
    const t2 = resolveSlot(data, scores, advancers, m.team2);
    return t1 === team || t2 === team;
  });

  return (
    <div className="gc-modal-overlay" onClick={onClose}>
      <div className="gc-modal" onClick={e => e.stopPropagation()}>
        <div className="gc-modal-header">
          <h3><Flag team={team} /> {team}</h3>
          <button className="gc-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="gc-modal-body">
          {matches.length === 0 && <p>No matches found.</p>}
          {matches.map(m => {
            const result = results[m.id];
            // For KO, resolve actual team names
            let displayTeam1 = m.team1;
            let displayTeam2 = m.team2;
            if (m.isKO) {
              displayTeam1 = resolveSlot(data, scores, advancers, m.team1) ?? m.team1;
              displayTeam2 = resolveSlot(data, scores, advancers, m.team2) ?? m.team2;
            }

            const dateLabel = new Date(m.date + 'T00:00:00').toLocaleDateString(undefined, {
              month: 'short', day: 'numeric',
            });
            const roundLabel = m.isKO ? m.round : m.group;

            return (
              <div className="tm-match-row" key={m.id}>
                <div className="tm-teams">
                  <span className="tm-team tm-team--left">
                    <Flag team={displayTeam1} /><span>{displayTeam1}</span>
                  </span>
                  {result ? (
                    <span className="tm-score">
                      {result.team1_score} – {result.team2_score}
                    </span>
                  ) : (
                    <span className="tm-vs">vs</span>
                  )}
                  <span className="tm-team tm-team--right">
                    <span>{displayTeam2}</span><Flag team={displayTeam2} />
                  </span>
                </div>
                <div className="tm-meta">
                  {result ? 'FT' : m.time.replace(/\s*UTC.*/, '')} · {dateLabel}
                  {roundLabel && <> · {roundLabel}</>}
                </div>
              </div>
            );
          })}

          {/* Team stats */}
          {teamInfo && (
            <div className="tm-team-stats">
              {teamInfo.coach && <div className="tm-coach">Coach: <strong>{teamInfo.coach}</strong></div>}
              <div className="tm-stats-pills">
                <span className="player-stat">⚽ {teamInfo.goals_for} scored</span>
                <span className="player-stat">{teamInfo.goals_against} conceded</span>
                {teamInfo.penalties > 0 && <span className="player-stat">{teamInfo.penalties} pen</span>}
                {teamInfo.yellow_cards > 0 && <span className="player-stat">🟨 {teamInfo.yellow_cards}</span>}
                {teamInfo.red_cards > 0 && <span className="player-stat">🟥 {teamInfo.red_cards}</span>}
              </div>
            </div>
          )}

          {/* Squad list */}
          {squad.length > 0 && (
            <div className="tm-squad">
              <div className="tm-squad-title">Squad</div>
              {(['GK', 'DF', 'MF', 'FW', null] as const).map(pos => {
                const players = squad.filter(p => p.position === pos || (!pos && !p.position));
                if (players.length === 0) return null;
                return (
                  <div key={pos ?? 'other'} className="tm-squad-group">
                    {pos && <div className="tm-squad-pos">{pos === 'GK' ? 'Goalkeepers' : pos === 'DF' ? 'Defenders' : pos === 'MF' ? 'Midfielders' : 'Forwards'}</div>}
                    {!pos && <div className="tm-squad-pos">Other</div>}
                    {players.map(p => (
                      <button
                        key={p.name}
                        type="button"
                        className="tm-squad-player"
                        onClick={() => setSelectedPlayer({ name: p.name, team: p.team })}
                      >
                        {p.shirt_number && <span className="tm-squad-num">{p.shirt_number}</span>}
                        <span className="tm-squad-name">{p.name}</span>
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
        </div>
      </div>
      {selectedPlayer && (
        <PlayerModal playerName={selectedPlayer.name} playerTeam={selectedPlayer.team} onClose={() => setSelectedPlayer(null)} />
      )}
    </div>
  );
}
