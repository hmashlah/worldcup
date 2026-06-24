import { useState } from 'react';
import { useTopScorers, usePlayerStats, useTeamStats } from '@/hooks/useTopScorers';
import { rankByCards, rankByMotm, rankByAttack, rankByDefence, rankTeamsByCards } from '@/lib/stats';
import { Flag } from '@/components/Flag';
import { PlayerModal } from '@/components/PlayerModal';

export function TopScorersView() {
  const { scorers, loading: goalLoading } = useTopScorers();
  const statsQ = usePlayerStats();
  const teamStatsQ = useTeamStats();
  const [selectedPlayer, setSelectedPlayer] = useState<{ name: string; team: string } | null>(null);

  const loading = goalLoading || statsQ.isLoading || teamStatsQ.isLoading;
  const allStats = statsQ.data ?? [];
  const teamStats = teamStatsQ.data ?? [];

  if (loading) return <p style={{ textAlign: 'center', padding: '32px' }}>Loading stats…</p>;

  const topCards = rankByCards(allStats, 5);
  const topMotm = rankByMotm(allStats, 5);
  const bestAttack = rankByAttack(teamStats, 5);
  const bestDefence = rankByDefence(teamStats, 5);
  const mostBookedTeams = rankTeamsByCards(teamStats, 5);

  return (
    <section className="tab-panel active">
      <div className="section-intro">
        <h2>Tournament Records</h2>
        <p>Top performers and team rankings — updated after each match.</p>
      </div>

      <div className="stats-cards-grid">
        {/* Top Scorers */}
        {scorers.length > 0 && (
          <div className="stats-card">
            <div className="stats-card-header">⚽ Top Scorers</div>
            <div className="stats-card-list">
              {scorers.map((s, i) => (
                <div key={`${s.name}-${s.team}`} className={`stats-card-row ${i === 0 ? 'stats-card-leader' : ''}`}>
                  <span className="stats-card-rank">{i + 1}</span>
                  <span className="stats-card-name stats-card-clickable" onClick={() => setSelectedPlayer({ name: s.name, team: s.team })}><Flag team={s.team} /> {s.name}</span>
                  <span className="stats-card-value">{s.goals}{s.penalties > 0 ? ` (${s.penalties}p)` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Best Attack */}
        {bestAttack.length > 0 && (
          <div className="stats-card">
            <div className="stats-card-header">💥 Best Attack</div>
            <div className="stats-card-list">
              {bestAttack.map((t, i) => (
                <div key={t.team} className={`stats-card-row ${i === 0 ? 'stats-card-leader' : ''}`}>
                  <span className="stats-card-rank">{i + 1}</span>
                  <span className="stats-card-name"><Flag team={t.team} /> {t.team}</span>
                  <span className="stats-card-value">{t.goals_for} goals</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Best Defence */}
        {bestDefence.length > 0 && (
          <div className="stats-card">
            <div className="stats-card-header">🧤 Best Defence</div>
            <div className="stats-card-list">
              {bestDefence.map((t, i) => (
                <div key={t.team} className={`stats-card-row ${i === 0 ? 'stats-card-leader' : ''}`}>
                  <span className="stats-card-rank">{i + 1}</span>
                  <span className="stats-card-name"><Flag team={t.team} /> {t.team}</span>
                  <span className="stats-card-value">{t.goals_against} conceded</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* MOTM */}
        {topMotm.length > 0 && (
          <div className="stats-card">
            <div className="stats-card-header">⭐ Man of the Match</div>
            <div className="stats-card-list">
              {topMotm.map((s, i) => (
                <div key={`${s.name}-${s.team}`} className={`stats-card-row ${i === 0 ? 'stats-card-leader' : ''}`}>
                  <span className="stats-card-rank">{i + 1}</span>
                  <span className="stats-card-name stats-card-clickable" onClick={() => setSelectedPlayer({ name: s.name, team: s.team })}><Flag team={s.team} /> {s.name}</span>
                  <span className="stats-card-value">{s.motm}x</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Most Booked Player */}
        {topCards.length > 0 && (
          <div className="stats-card">
            <div className="stats-card-header">🟨 Most Booked Players</div>
            <div className="stats-card-list">
              {topCards.map((s, i) => (
                <div key={`${s.name}-${s.team}`} className={`stats-card-row ${i === 0 ? 'stats-card-leader' : ''}`}>
                  <span className="stats-card-rank">{i + 1}</span>
                  <span className="stats-card-name stats-card-clickable" onClick={() => setSelectedPlayer({ name: s.name, team: s.team })}><Flag team={s.team} /> {s.name}</span>
                  <span className="stats-card-value">{s.yellow_cards}🟨{s.red_cards > 0 ? ` ${s.red_cards}🟥` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Most Booked Team */}
        {mostBookedTeams.length > 0 && (
          <div className="stats-card">
            <div className="stats-card-header">🟥 Most Booked Teams</div>
            <div className="stats-card-list">
              {mostBookedTeams.map((t, i) => (
                <div key={t.team} className={`stats-card-row ${i === 0 ? 'stats-card-leader' : ''}`}>
                  <span className="stats-card-rank">{i + 1}</span>
                  <span className="stats-card-name"><Flag team={t.team} /> {t.team}</span>
                  <span className="stats-card-value">{t.yellow_cards}🟨{t.red_cards > 0 ? ` ${t.red_cards}🟥` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {selectedPlayer && (
        <PlayerModal
          playerName={selectedPlayer.name}
          playerTeam={selectedPlayer.team}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </section>
  );
}
