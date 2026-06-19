import { useState } from 'react';
import { useLeaderboard, type LeaderboardEntry } from '@/hooks/useLeaderboard';
import { useAuth } from '@/contexts/AuthContext';
import { PlayerComparison } from './PlayerComparison';

const ROSETTES = ['🥇', '🥈', '🥉'];

/** Two entries share a rank when every scoring column matches.
 *  Display-name only stabilizes the within-rank order. */
function sameRank(a: LeaderboardEntry, b: LeaderboardEntry): boolean {
  return (
    a.total === b.total &&
    a.exact === b.exact &&
    a.outcome === b.outcome &&
    a.advancer === b.advancer
  );
}

export function LeaderboardCard() {
  const { user, isApproved, isAdmin } = useAuth();
  const { loading, entries } = useLeaderboard();
  const [compareId, setCompareId] = useState<string | null>(null);

  if (loading) return <div className="leaderboard-empty">loading…</div>;
  if (!entries.length) return (
    <div className="leaderboard-empty">
      {user && !isApproved && (
        <p style={{ marginTop: 0 }}>
          Your profile isn't approved yet, so you don't appear on the leaderboard.
          {isAdmin && ' (As admin you can approve yourself in the Admin tab.)'}
        </p>
      )}
      {(!user || isApproved) && <p style={{ marginTop: 0 }}>No predictions yet — be the first ♡</p>}
    </div>
  );

  // Dense ranking: tied players share a rank; the next distinct player gets
  // the very next number (1, 1, 2, 3 — not 1, 1, 3, 4). Computed in one pass
  // since `entries` is already sorted by the same keys sameRank() compares.
  const ranks: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    ranks.push(
      i === 0 || !sameRank(entries[i], entries[i - 1])
        ? (ranks[i - 1] ?? 0) + 1
        : ranks[i - 1],
    );
  }

  return (
    <div className="leaderboard">
      <div className="leaderboard-head">
        <span>#</span>
        <span>Player</span>
        <span title="Total predictions submitted that have an actual">Picks</span>
        <span title="Exact-score predictions">Exact</span>
        <span title="Right outcome (W/D/L)">Outcome</span>
        <span title="Right knockout advancer">Adv.</span>
        <span>Total</span>
      </div>
      {entries.map((e, i) => {
        const rank = ranks[i];
        const isMe = user?.id === e.user_id;
        return (
          <div
            key={e.user_id}
            className={'leaderboard-row' + (isMe ? ' is-me' : '')}
            onClick={!isMe && user ? () => setCompareId(e.user_id) : undefined}
            style={!isMe && user ? { cursor: 'pointer' } : undefined}
          >
            <span className="lb-rank">{ROSETTES[rank - 1] ?? `#${rank}`}</span>
            <span className="lb-name">{e.display_name}</span>
            <span>{e.predictions}</span>
            <span>{e.exact}</span>
            <span>{e.outcome}</span>
            <span>{e.advancer}</span>
            <span className="lb-total">{e.total}</span>
          </div>
        );
      })}
      <p className="leaderboard-key">
        scoring · 3 pts exact · 1 pt right outcome · +1 pt right advancer in knockouts
      </p>
      {compareId && <PlayerComparison opponentId={compareId} onClose={() => setCompareId(null)} />}
    </div>
  );
}
