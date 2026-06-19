import { useMemo } from 'react';
import { useMyPredictions } from '@/hooks/usePredictions';
import { useResults } from '@/hooks/useResults';
import { useTournamentData } from '@/hooks/useTournamentData';
import { allMatches, type DayMatch } from '@/lib/days';
import { scorePrediction } from '@/lib/scoring';
import { Flag } from './Flag';

interface ScoredPick {
  match: DayMatch;
  predT1: number;
  predT2: number;
  actualT1: number;
  actualT2: number;
  points: number;
  isExact: boolean;
  isOutcome: boolean;
  advancerPt: boolean;
}

export function MyPicksView() {
  const dataQ = useTournamentData();
  const predsQ = useMyPredictions();
  const resultsQ = useResults();

  const { dayGroups, totals, stats } = useMemo(() => {
    if (!dataQ.data || !predsQ.data || !resultsQ.data) {
      return {
        dayGroups: [],
        totals: { pts: 0, exact: 0, outcome: 0, advancer: 0, picks: 0 },
        stats: { currentStreak: 0, longestStreak: 0, exactRate: 0, hitRate: 0, bestDay: null as { date: string; pts: number } | null },
      };
    }

    const matches = allMatches(dataQ.data);
    const matchMap = new Map<string, DayMatch>();
    for (const m of matches) matchMap.set(m.id, m);

    const scored: ScoredPick[] = [];

    for (const [matchId, pred] of Object.entries(predsQ.data)) {
      const result = resultsQ.data[matchId];
      if (!result) continue; // no result yet — skip
      const match = matchMap.get(matchId);
      if (!match) continue;

      const pts = scorePrediction(
        { team1: pred.team1_score, team2: pred.team2_score },
        { team1: result.team1_score, team2: result.team2_score },
        match.isKO,
        pred.advancer,
        result.advancer,
      );

      const isExact = pred.team1_score === result.team1_score && pred.team2_score === result.team2_score;
      const isOutcome = !isExact && Math.sign(pred.team1_score - pred.team2_score) === Math.sign(result.team1_score - result.team2_score);
      const advancerPt = match.isKO && !!pred.advancer && !!result.advancer && pred.advancer === result.advancer;

      scored.push({
        match,
        predT1: pred.team1_score,
        predT2: pred.team2_score,
        actualT1: result.team1_score,
        actualT2: result.team2_score,
        points: pts,
        isExact,
        isOutcome,
        advancerPt,
      });
    }

    // Totals
    const totals = {
      pts: scored.reduce((s, p) => s + p.points, 0),
      exact: scored.filter(p => p.isExact).length,
      outcome: scored.filter(p => p.isOutcome).length,
      advancer: scored.filter(p => p.advancerPt).length,
      picks: scored.length,
    };

    // Streak and rate calculations (chronological order by kickoff)
    const chronological = [...scored].sort((a, b) => a.match.kickoff - b.match.kickoff);

    let currentStreak = 0;
    let longestStreak = 0;
    let streak = 0;
    for (const s of chronological) {
      if (s.points > 0) {
        streak++;
        if (streak > longestStreak) longestStreak = streak;
      } else {
        streak = 0;
      }
    }
    // Current streak: count backwards from most recent scored match
    for (let i = chronological.length - 1; i >= 0; i--) {
      if (chronological[i].points > 0) currentStreak++;
      else break;
    }

    const totalScored = scored.length;
    const exactRate = totalScored > 0 ? Math.round((totals.exact / totalScored) * 100) : 0;
    const hitCount = scored.filter(s => s.points > 0).length;
    const hitRate = totalScored > 0 ? Math.round((hitCount / totalScored) * 100) : 0;

    // Best day: group by date, sum points, find max
    const ptsByDate: Record<string, number> = {};
    for (const s of scored) {
      ptsByDate[s.match.date] = (ptsByDate[s.match.date] || 0) + s.points;
    }
    let bestDay: { date: string; pts: number } | null = null;
    for (const [date, pts] of Object.entries(ptsByDate)) {
      if (!bestDay || pts > bestDay.pts) bestDay = { date, pts };
    }

    const stats = { currentStreak, longestStreak, exactRate, hitRate, bestDay };

    // Group by date
    const byDate: Record<string, ScoredPick[]> = {};
    for (const s of scored) {
      if (!byDate[s.match.date]) byDate[s.match.date] = [];
      byDate[s.match.date].push(s);
    }

    // Sort days newest-first, matches within a day by kickoff
    const dayGroups = Object.entries(byDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, picks]) => ({
        date,
        picks: picks.sort((a, b) => a.match.kickoff - b.match.kickoff),
      }));

    return { dayGroups, totals, stats };
  }, [dataQ.data, predsQ.data, resultsQ.data]);

  if (dataQ.isLoading || predsQ.isLoading || resultsQ.isLoading) {
    return <p style={{ textAlign: 'center', padding: '32px' }}>loading...</p>;
  }

  if (dayGroups.length === 0) {
    return (
      <div className="my-picks-empty">
        No predictions with results yet.
      </div>
    );
  }

  return (
    <div className="my-picks">
      <div className="my-picks-summary">
        <span className="my-picks-stat my-picks-stat-pts">{totals.pts} pts</span>
        <span className="my-picks-stat">{totals.exact} exact</span>
        <span className="my-picks-stat">{totals.outcome} outcome</span>
        <span className="my-picks-stat">{totals.advancer} advancer</span>
        <span className="my-picks-stat">{totals.picks} picks</span>
      </div>

      <div className="my-picks-stats">
        <div className="my-picks-stats-item">
          <span className="my-picks-stats-value">{stats.currentStreak > 0 ? `🔥 ${stats.currentStreak}` : '0'}</span>
          <span className="my-picks-stats-label">Streak</span>
        </div>
        <div className="my-picks-stats-item">
          <span className="my-picks-stats-value">{stats.longestStreak}</span>
          <span className="my-picks-stats-label">Best streak</span>
        </div>
        <div className="my-picks-stats-item">
          <span className="my-picks-stats-value">{stats.exactRate}%</span>
          <span className="my-picks-stats-label">Exact rate</span>
        </div>
        <div className="my-picks-stats-item">
          <span className="my-picks-stats-value">{stats.hitRate}%</span>
          <span className="my-picks-stats-label">Hit rate</span>
        </div>
        {stats.bestDay && (
          <div className="my-picks-stats-item">
            <span className="my-picks-stats-value">{formatShortDate(stats.bestDay.date)} · {stats.bestDay.pts} pts</span>
            <span className="my-picks-stats-label">Best day</span>
          </div>
        )}
      </div>

      {dayGroups.map(({ date, picks }) => (
        <section key={date} className="my-picks-day">
          <h3 className="my-picks-day-header">{formatDateHeader(date)}</h3>
          <div className="my-picks-day-list">
            {picks.map(p => (
              <div key={p.match.id} className="my-picks-row">
                <div className="my-picks-team my-picks-team-left">
                  <Flag team={p.match.team1} />
                  <span className="my-picks-name">{p.match.team1}</span>
                </div>
                <div className="my-picks-scores">
                  <span className="my-picks-pred">{p.predT1}-{p.predT2}</span>
                  <span className="my-picks-sep">/</span>
                  <span className="my-picks-actual">{p.actualT1}-{p.actualT2}</span>
                </div>
                <div className="my-picks-team my-picks-team-right">
                  <span className="my-picks-name">{p.match.team2}</span>
                  <Flag team={p.match.team2} />
                </div>
                <span className={`mc-points pts-${ptsClass(p.points)}`}>
                  +{p.points}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ptsClass(pts: number): string {
  if (pts >= 4) return '4';
  if (pts === 3) return '3';
  if (pts >= 1) return '1';
  return '0';
}

function formatDateHeader(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatShortDate(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
