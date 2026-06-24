import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Flag } from '@/components/Flag';
import type { MatchDetail } from '@/lib/match-detail';
import type { PlayerStat } from '@/lib/stats';

interface Props {
  playerName: string;
  playerTeam: string;
  onClose: () => void;
}

function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

interface MatchEvent {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  score: string;
  date: string;
  goals: number;
  penalties: number;
  ownGoals: number;
  yellowCard: boolean;
  redCard: boolean;
  motm: boolean;
}

export function PlayerModal({ playerName, playerTeam, onClose }: Props) {
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [bio, setBio] = useState<PlayerStat | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    (async () => {
      // Fetch player bio
      const { data: bioData } = await supabase
        .from('wc26_player_stats')
        .select('*')
        .eq('name', playerName)
        .eq('team', playerTeam)
        .maybeSingle();
      if (bioData) setBio(bioData as PlayerStat);

      // Fetch all match results with detail
      const { data } = await supabase
        .from('wc26_match_results')
        .select('match_id, team1_score, team2_score, match_detail')
        .not('match_detail', 'is', null);

      if (!data) { setLoading(false); return; }

      // Also fetch the match map for team names
      const mapRes = await fetch('/data/fd-match-map.json');
      const matchMap = await mapRes.json() as Record<string, { home: string; away: string; date: string }>;

      const playerEvents: MatchEvent[] = [];
      const nameLower = playerName.toLowerCase();

      for (const row of data as Array<{ match_id: string; team1_score: number; team2_score: number; match_detail: MatchDetail }>) {
        const d = row.match_detail;
        const map = matchMap[row.match_id];
        if (!map) continue;

        let goals = 0, penalties = 0, ownGoals = 0;
        let yellowCard = false, redCard = false, motm = false;
        let found = false;

        // Check goals
        if (d.goals) {
          for (const g of d.goals) {
            if (g.name?.toLowerCase().trim() === nameLower) {
              found = true;
              if (g.kind === 'own-goal') ownGoals++;
              else { goals++; if (g.kind === 'penalty') penalties++; }
            }
          }
        }

        // Check cards
        if (d.cards) {
          for (const c of d.cards) {
            if (c.name?.toLowerCase().trim() === nameLower) {
              found = true;
              if (c.type === 'yellow') yellowCard = true;
              else if (c.type === 'red' || c.type === 'second-yellow') redCard = true;
            }
          }
        }

        // Check MOTM
        if (d.motm?.name?.toLowerCase().trim() === nameLower) {
          found = true;
          motm = true;
        }

        if (found) {
          playerEvents.push({
            matchId: row.match_id,
            homeTeam: map.home,
            awayTeam: map.away,
            score: `${row.team1_score} – ${row.team2_score}`,
            date: map.date,
            goals,
            penalties,
            ownGoals,
            yellowCard,
            redCard,
            motm,
          });
        }
      }

      playerEvents.sort((a, b) => a.date.localeCompare(b.date));
      setEvents(playerEvents);
      setLoading(false);
    })();
  }, [playerName]);

  // Totals
  const totalGoals = events.reduce((s, e) => s + e.goals, 0);
  const totalPens = events.reduce((s, e) => s + e.penalties, 0);
  const totalOG = events.reduce((s, e) => s + e.ownGoals, 0);
  const totalYellow = events.filter(e => e.yellowCard).length;
  const totalRed = events.filter(e => e.redCard).length;
  const totalMotm = events.filter(e => e.motm).length;

  return (
    <div className="gc-modal-overlay" onClick={onClose}>
      <div className="gc-modal player-modal" onClick={e => e.stopPropagation()}>
        <div className="gc-modal-header">
          <h3><Flag team={playerTeam} /> {playerName}</h3>
          <button type="button" className="gc-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="player-modal-body">
          {loading ? (
            <p className="player-loading">Loading…</p>
          ) : (
            <>
              {/* Bio info */}
              {bio && (bio.position || bio.club || bio.dob) && (
                <div className="player-bio">
                  {bio.shirt_number && <span className="player-bio-number">#{bio.shirt_number}</span>}
                  {bio.position && <span className="player-bio-item">{bio.position}</span>}
                  {bio.club && <span className="player-bio-item">{bio.club}</span>}
                  {bio.dob && <span className="player-bio-item">{calculateAge(bio.dob)} yrs</span>}
                </div>
              )}

              {/* Summary stats */}
              <div className="player-stats-row">
                {totalGoals > 0 && <span className="player-stat">⚽ {totalGoals}{totalPens > 0 ? ` (${totalPens}p)` : ''}</span>}
                {totalOG > 0 && <span className="player-stat">🫣 {totalOG} OG</span>}
                {totalYellow > 0 && <span className="player-stat">🟨 {totalYellow}</span>}
                {totalRed > 0 && <span className="player-stat">🟥 {totalRed}</span>}
                {totalMotm > 0 && <span className="player-stat">⭐ {totalMotm} MOTM</span>}
                <span className="player-stat">{events.length} match{events.length !== 1 ? 'es' : ''}</span>
              </div>

              {/* Match-by-match */}
              <div className="player-matches">
                {events.map(e => (
                  <div key={e.matchId} className="player-match-row">
                    <span className="player-match-teams">
                      <Flag team={e.homeTeam} /> {e.homeTeam} {e.score} {e.awayTeam} <Flag team={e.awayTeam} />
                    </span>
                    <span className="player-match-events">
                      {e.goals > 0 && `⚽${e.goals > 1 ? `×${e.goals}` : ''} `}
                      {e.yellowCard && '🟨 '}
                      {e.redCard && '🟥 '}
                      {e.motm && '⭐ '}
                    </span>
                  </div>
                ))}
              </div>

              {events.length === 0 && <p className="player-loading">No match events found.</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
