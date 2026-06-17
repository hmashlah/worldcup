import { useEffect, useMemo, useState, useRef } from 'react';
import { MatchCard } from '@/components/MatchCard';
import { DayLeaderboard } from '@/components/DayLeaderboard';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useResults } from '@/hooks/useResults';
import { useAuth } from '@/contexts/AuthContext';
import { resolveSlot, prettySlot, isKnockoutRound } from '@/lib/tournament';
import { matchesByDay, defaultDay, relativeDayLabel, shortDayLabel } from '@/lib/days';
import type { AdvancerMap, ScoreMap } from '@/lib/types';

export function DayView() {
  const dataQ = useTournamentData();
  const resultsQ = useResults();
  const { user } = useAuth();
  const stripRef = useRef<HTMLDivElement>(null);

  const days = useMemo(() => dataQ.data ? matchesByDay(dataQ.data) : [], [dataQ.data]);
  const initial = useMemo(() => defaultDay(days), [days]);
  const [activeDate, setActiveDate] = useState<string | null>(initial);
  useEffect(() => { setActiveDate(initial); }, [initial]);

  // Auto-scroll the strip so the active pill is visible.
  useEffect(() => {
    if (!stripRef.current || !activeDate) return;
    const el = stripRef.current.querySelector<HTMLButtonElement>(`[data-date="${activeDate}"]`);
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activeDate]);

  if (!dataQ.data) return null;
  if (!days.length) return <div className="day-empty">No matches scheduled.</div>;

  const activeDay = days.find(d => d.date === activeDate) ?? days[0];

  // Build score & advancer maps for slot resolution (knockouts).
  const scores: ScoreMap = {};
  const advancers: AdvancerMap = {};
  for (const [id, r] of Object.entries(resultsQ.data ?? {})) {
    scores[id] = { team1: r.team1_score, team2: r.team2_score };
    advancers[id] = r.advancer ?? null;
  }

  return (
    <div className="day-view">
      {/* Day strip */}
      <div className="day-strip" ref={stripRef}>
        {days.map(d => {
          const isActive = d.date === activeDay.date;
          return (
            <button
              key={d.date}
              data-date={d.date}
              className={`day-pill ${isActive ? 'active' : ''}`}
              onClick={() => setActiveDate(d.date)}
            >
              <span className="day-pill-day">{shortDayLabel(d.date).split(' ')[0]}</span>
              <span className="day-pill-num">{shortDayLabel(d.date).split(' ')[1]}</span>
              <span className="day-pill-count">{d.matches.length}</span>
            </button>
          );
        })}
      </div>

      {/* Active day header */}
      <div className="day-header">
        <h2 className="day-relative">{relativeDayLabel(activeDay.date)}</h2>
        <p className="day-absolute">
          {new Date(activeDay.date + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'long', month: 'long', day: 'numeric',
          })}
          {' · '}
          {activeDay.matches.length} {activeDay.matches.length === 1 ? 'match' : 'matches'}
        </p>
      </div>

      {/* Match list */}
      <div className="day-list">
        {activeDay.matches.map(m => {
          const t1 = m.isKO
            ? resolveSlot(dataQ.data!, scores, advancers, m.team1)
            : m.team1;
          const t2 = m.isKO
            ? resolveSlot(dataQ.data!, scores, advancers, m.team2)
            : m.team2;
          return (
            <MatchCard
              key={m.id}
              matchId={m.id}
              team1={t1 ?? m.team1}
              team2={t2 ?? m.team2}
              team1IsResolved={!m.isKO || !!t1}
              team2IsResolved={!m.isKO || !!t2}
              team1Placeholder={m.isKO ? prettySlot(m.team1) : undefined}
              team2Placeholder={m.isKO ? prettySlot(m.team2) : undefined}
              date={m.date}
              time={m.time}
              ground={m.ground}
              isKO={m.isKO && isKnockoutRound(m.round ?? '')}
              roundLabel={m.isKO ? m.round : m.group}
            />
          );
        })}
      </div>

      {/* Day leaderboard (only visible for authenticated users, only when results exist) */}
      {user && <DayLeaderboard matchIds={activeDay.matches.map(m => m.id)} />}
    </div>
  );
}
