import { useDayLeaderboard } from '@/hooks/useDayLeaderboard';
import { useAuth } from '@/contexts/AuthContext';
import { sameRank } from '@/lib/utils';

const ROSETTES = ['🥇', '🥈', '🥉'];

interface Props {
  matchIds: string[];
}

export function DayLeaderboard({ matchIds }: Props) {
  const { user } = useAuth();
  const { loading, entries, hasResults } = useDayLeaderboard(matchIds);

  // Don't show anything if there are no results yet for this day
  if (!hasResults || loading || !entries.length) return null;

  // Dense ranking
  const ranks: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    ranks.push(
      i === 0 || !sameRank(entries[i], entries[i - 1])
        ? (ranks[i - 1] ?? 0) + 1
        : ranks[i - 1],
    );
  }

  return (
    <div className="day-lb">
      <div className="day-lb-header">
        <span className="day-lb-title">Day Standings</span>
        <span className="day-lb-sub">{entries.length} player{entries.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="day-lb-list">
        {entries.map((e, i) => {
          const rank = ranks[i];
          return (
            <div
              key={e.user_id}
              className={'day-lb-row' + (user?.id === e.user_id ? ' is-me' : '')}
            >
              <span className="day-lb-rank">{ROSETTES[rank - 1] ?? `#${rank}`}</span>
              <span className="day-lb-name">{e.display_name}</span>
              <span className="day-lb-stats">
                {e.exact > 0 && <span className="day-lb-stat exact">{e.exact} exact</span>}
                {e.outcome > 0 && <span className="day-lb-stat">{e.outcome} outcome</span>}
                {e.advancer > 0 && <span className="day-lb-stat">{e.advancer} adv</span>}
              </span>
              <span className="day-lb-total">{e.total}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
