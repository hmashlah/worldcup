import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Flag } from '@/components/Flag';
import { useUI } from '@/lib/ui-store';
import type { MatchDetail } from '@/lib/match-detail';
import type { PlayerStat } from '@/lib/stats';

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

function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

interface Props {
  playerName: string;
  playerTeam: string;
}

export function PlayerPage({ playerName, playerTeam }: Props) {
  const closePlayer = useUI(s => s.closePlayer);
  const openTeam = useUI(s => s.openTeam);
  const [bio, setBio] = useState<PlayerStat | null>(null);
  const [events, setEvents] = useState<MatchEvent[]>([]);
  const [loading, setLoading] = useState(true);

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

      // Fetch match events
      const { data } = await supabase
        .from('wc26_match_results')
        .select('match_id, team1_score, team2_score, match_detail')
        .not('match_detail', 'is', null);

      if (!data) { setLoading(false); return; }

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

        if (d.goals) {
          for (const g of d.goals) {
            if (g.name?.toLowerCase().trim() === nameLower) {
              found = true;
              if (g.kind === 'own-goal') ownGoals++;
              else { goals++; if (g.kind === 'penalty') penalties++; }
            }
          }
        }

        if (d.cards) {
          for (const c of d.cards) {
            if (c.name?.toLowerCase().trim() === nameLower) {
              found = true;
              if (c.type === 'yellow') yellowCard = true;
              else if (c.type === 'red' || c.type === 'second-yellow') redCard = true;
            }
          }
        }

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
            goals, penalties, ownGoals, yellowCard, redCard, motm,
          });
        }
      }

      playerEvents.sort((a, b) => a.date.localeCompare(b.date));
      setEvents(playerEvents);
      setLoading(false);
    })();
  }, [playerName, playerTeam]);

  const totalGoals = events.reduce((s, e) => s + e.goals, 0);
  const totalPens = events.reduce((s, e) => s + e.penalties, 0);
  const totalOG = events.reduce((s, e) => s + e.ownGoals, 0);
  const totalYellow = events.filter(e => e.yellowCard).length;
  const totalRed = events.filter(e => e.redCard).length;
  const totalMotm = events.filter(e => e.motm).length;

  return (
    <section className="tab-panel active">
      <button type="button" className="page-back" onClick={closePlayer}>← Back</button>

      <div className="player-page-header">
        <Flag team={playerTeam} />
        <div className="player-page-title">
          <h2>{playerName}</h2>
          <button type="button" className="player-page-team" onClick={() => openTeam(playerTeam)}>
            {playerTeam}
          </button>
        </div>
        {bio?.shirt_number && <span className="player-page-number">#{bio.shirt_number}</span>}
      </div>

      {/* Bio */}
      {bio && (bio.position || bio.club || bio.dob) && (
        <div className="player-page-bio">
          {bio.position && <span className="player-bio-item">{bio.position}</span>}
          {bio.club && <span className="player-bio-item">{bio.club}</span>}
          {bio.dob && <span className="player-bio-item">{calculateAge(bio.dob)} years old</span>}
        </div>
      )}

      {/* Tournament stats */}
      {!loading && (
        <div className="player-page-stats">
          {totalGoals > 0 && <span className="player-stat">⚽ {totalGoals}{totalPens > 0 ? ` (${totalPens}p)` : ''}</span>}
          {totalOG > 0 && <span className="player-stat">🫣 {totalOG} OG</span>}
          {totalYellow > 0 && <span className="player-stat">🟨 {totalYellow}</span>}
          {totalRed > 0 && <span className="player-stat">🟥 {totalRed}</span>}
          {totalMotm > 0 && <span className="player-stat">⭐ {totalMotm} MOTM</span>}
          {events.length > 0 && <span className="player-stat">{events.length} match{events.length !== 1 ? 'es' : ''}</span>}
        </div>
      )}

      {/* Match events */}
      {loading ? (
        <p style={{ textAlign: 'center', padding: '24px', color: 'var(--ink-faint)' }}>Loading…</p>
      ) : events.length > 0 ? (
        <div className="player-page-section">
          <h3>Tournament Appearances</h3>
          <div className="player-page-events">
            {events.map(e => (
              <div key={e.matchId} className="player-event-row">
                <div className="player-event-match">
                  <Flag team={e.homeTeam} /> {e.homeTeam} {e.score} {e.awayTeam} <Flag team={e.awayTeam} />
                </div>
                <div className="player-event-icons">
                  {e.goals > 0 && <span>⚽{e.goals > 1 ? `×${e.goals}` : ''}</span>}
                  {e.yellowCard && <span>🟨</span>}
                  {e.redCard && <span>🟥</span>}
                  {e.motm && <span>⭐</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p style={{ textAlign: 'center', padding: '24px', color: 'var(--ink-faint)' }}>No recorded events in this tournament yet.</p>
      )}
    </section>
  );
}
