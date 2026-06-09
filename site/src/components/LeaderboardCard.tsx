import { useLeaderboard } from '@/hooks/useLeaderboard';
import { useAuth } from '@/contexts/AuthContext';

const ROSETTES = ['🥇', '🥈', '🥉'];

export function LeaderboardCard() {
  const { user } = useAuth();
  const { loading, entries } = useLeaderboard();

  if (loading) return <div className="leaderboard-empty">loading…</div>;
  if (!entries.length) return (
    <div className="leaderboard-empty">
      No predictions yet — be the first ♡
    </div>
  );

  return (
    <div className="leaderboard">
      <div className="leaderboard-head">
        <span>#</span>
        <span>Player</span>
        <span title="Exact-score predictions">Exact</span>
        <span title="Right outcome (W/D/L)">Outcome</span>
        <span title="Right knockout advancer">Adv.</span>
        <span title="Total predictions submitted that have an actual">Picks</span>
        <span>Total</span>
      </div>
      {entries.map((e, i) => (
        <div
          key={e.user_id}
          className={'leaderboard-row' + (user?.id === e.user_id ? ' is-me' : '')}
        >
          <span className="lb-rank">{ROSETTES[i] ?? `#${i + 1}`}</span>
          <span className="lb-name">{e.display_name}</span>
          <span>{e.exact}</span>
          <span>{e.outcome}</span>
          <span>{e.advancer}</span>
          <span>{e.predictions}</span>
          <span className="lb-total">{e.total}</span>
        </div>
      ))}
      <p className="leaderboard-key">
        scoring · 3 pts exact · 1 pt right outcome · +1 pt right advancer in knockouts
      </p>
    </div>
  );
}
