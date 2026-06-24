import { useState } from 'react';
import { useTopScorers, usePlayerStats } from '@/hooks/useTopScorers';

type ViewMode = 'goals' | 'cards' | 'motm';

export function TopScorersView() {
  const { scorers, loading: goalLoading } = useTopScorers();
  const statsQ = usePlayerStats();
  const [view, setView] = useState<ViewMode>('goals');

  const loading = goalLoading || statsQ.isLoading;
  const allStats = statsQ.data ?? [];

  const cardPlayers = [...allStats]
    .filter(p => p.yellow_cards > 0 || p.red_cards > 0)
    .sort((a, b) => (b.yellow_cards + b.red_cards * 2) - (a.yellow_cards + a.red_cards * 2))
    .slice(0, 20);

  const motmPlayers = [...allStats]
    .filter(p => p.motm > 0)
    .sort((a, b) => b.motm - a.motm)
    .slice(0, 15);

  if (loading) return <p style={{ textAlign: 'center', padding: '32px' }}>Loading stats…</p>;

  return (
    <section className="tab-panel active">
      <div className="section-intro">
        <h2>Player Stats</h2>
        <p>Updated automatically after each match.</p>
      </div>

      <div className="stats-tabs">
        <button className={`stats-tab ${view === 'goals' ? 'active' : ''}`} onClick={() => setView('goals')}>
          Top Scorers
        </button>
        <button className={`stats-tab ${view === 'cards' ? 'active' : ''}`} onClick={() => setView('cards')}>
          Discipline
        </button>
        <button className={`stats-tab ${view === 'motm' ? 'active' : ''}`} onClick={() => setView('motm')}>
          MOTM
        </button>
      </div>

      {view === 'goals' && (
        <div className="scorers-table-wrap">
          {scorers.length === 0 ? (
            <p className="stats-empty">No goals scored yet.</p>
          ) : (
            <table className="scorers-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Goals</th>
                  <th>Pen</th>
                </tr>
              </thead>
              <tbody>
                {scorers.map((s, i) => (
                  <tr key={`${s.name}-${s.team}`} className={i < 3 ? 'scorers-top3' : ''}>
                    <td className="scorers-rank">{i + 1}</td>
                    <td className="scorers-name">{s.name}</td>
                    <td className="scorers-goals">{s.goals}</td>
                    <td className="scorers-pen">{s.penalties > 0 ? `(${s.penalties})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === 'cards' && (
        <div className="scorers-table-wrap">
          {cardPlayers.length === 0 ? (
            <p className="stats-empty">No cards shown yet.</p>
          ) : (
            <table className="scorers-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>🟨</th>
                  <th>🟥</th>
                </tr>
              </thead>
              <tbody>
                {cardPlayers.map((s, i) => (
                  <tr key={`${s.name}-${s.team}`}>
                    <td className="scorers-rank">{i + 1}</td>
                    <td className="scorers-name">{s.name}</td>
                    <td>{s.yellow_cards || ''}</td>
                    <td>{s.red_cards || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view === 'motm' && (
        <div className="scorers-table-wrap">
          {motmPlayers.length === 0 ? (
            <p className="stats-empty">No MOTM awards yet.</p>
          ) : (
            <table className="scorers-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th>Awards</th>
                </tr>
              </thead>
              <tbody>
                {motmPlayers.map((s, i) => (
                  <tr key={`${s.name}-${s.team}`} className={i < 3 ? 'scorers-top3' : ''}>
                    <td className="scorers-rank">{i + 1}</td>
                    <td className="scorers-name">{s.name}</td>
                    <td className="scorers-goals">{s.motm}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}
