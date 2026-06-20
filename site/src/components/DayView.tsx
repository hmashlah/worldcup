import { useCallback, useEffect, useMemo, useState, useRef, type TouchEvent } from 'react';
import { MatchCard } from '@/components/MatchCard';
import { DayLeaderboard } from '@/components/DayLeaderboard';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useResults } from '@/hooks/useResults';
import { useAuth } from '@/contexts/AuthContext';
import { resolveSlot, prettySlot, isKnockoutRound } from '@/lib/tournament';
import { matchesByDay, defaultDay, relativeDayLabel, shortDayLabel } from '@/lib/days';
import type { AdvancerMap, ScoreMap } from '@/lib/types';

const SEEN_RESULTS_KEY = 'wc26-seen-results';

function loadSeenResults(): Record<string, true> {
  try {
    const raw = localStorage.getItem(SEEN_RESULTS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, true>;
  } catch {
    return {};
  }
}

function saveSeenResults(seen: Record<string, true>): void {
  try {
    localStorage.setItem(SEEN_RESULTS_KEY, JSON.stringify(seen));
  } catch { /* quota exceeded — degrade silently */ }
}

export function DayView() {
  const dataQ = useTournamentData();
  const resultsQ = useResults();
  const { user } = useAuth();
  const stripRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Swipe gesture state ────────────────────────────────────────
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const touchEnd = useRef<{ x: number; y: number } | null>(null);

  const days = useMemo(() => dataQ.data ? matchesByDay(dataQ.data) : [], [dataQ.data]);
  const initial = useMemo(() => defaultDay(days), [days]);
  const [activeDate, setActiveDate] = useState<string | null>(initial);
  useEffect(() => { setActiveDate(initial); }, [initial]);

  // ── Seen-results badge logic ───────────────────────────────────
  const [seenResults, setSeenResults] = useState<Record<string, true>>(loadSeenResults);
  const initializedRef = useRef(false);

  // On first load: if localStorage is empty (brand-new user), seed it
  // with all current result IDs so we don't flood every pill with dots.
  useEffect(() => {
    if (initializedRef.current) return;
    if (!resultsQ.data) return;
    initializedRef.current = true;
    const existing = loadSeenResults();
    if (Object.keys(existing).length > 0) return; // already initialized
    const seed: Record<string, true> = {};
    for (const id of Object.keys(resultsQ.data)) seed[id] = true;
    saveSeenResults(seed);
    setSeenResults(seed);
  }, [resultsQ.data]);

  // When the active day changes, mark all results on that day as seen.
  const markDaySeen = useCallback((date: string | null) => {
    if (!date || !resultsQ.data || !user) return;
    const day = days.find(d => d.date === date);
    if (!day) return;
    const idsWithResults = day.matches
      .filter(m => resultsQ.data![m.id])
      .map(m => m.id);
    if (!idsWithResults.length) return;
    setSeenResults(prev => {
      const next = { ...prev };
      let changed = false;
      for (const id of idsWithResults) {
        if (!next[id]) { next[id] = true; changed = true; }
      }
      if (!changed) return prev;
      saveSeenResults(next);
      return next;
    });
  }, [days, resultsQ.data, user]);

  // Mark seen when activeDate changes (user navigates).
  useEffect(() => { markDaySeen(activeDate); }, [activeDate, markDaySeen]);

  // Determine which days have unseen results (only for authenticated users).
  const daysWithNew = useMemo<Set<string>>(() => {
    if (!user || !resultsQ.data) return new Set();
    const s = new Set<string>();
    for (const d of days) {
      for (const m of d.matches) {
        if (resultsQ.data[m.id] && !seenResults[m.id]) {
          s.add(d.date);
          break;
        }
      }
    }
    return s;
  }, [user, resultsQ.data, days, seenResults]);

  // Auto-scroll the strip so the active pill is visible.
  useEffect(() => {
    if (!stripRef.current || !activeDate) return;
    const el = stripRef.current.querySelector<HTMLButtonElement>(`[data-date="${activeDate}"]`);
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [activeDate]);

  // ── Swipe gesture handlers ─────────────────────────────────────
  const onTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    touchEnd.current = null;
    touchStart.current = { x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY };
  }, []);

  const onTouchMove = useCallback((e: TouchEvent<HTMLDivElement>) => {
    touchEnd.current = { x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY };
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!touchStart.current || !touchEnd.current) return;
    const diffX = touchStart.current.x - touchEnd.current.x;
    const diffY = touchStart.current.y - touchEnd.current.y;

    // Only trigger if horizontal movement exceeds threshold and is greater than vertical
    if (Math.abs(diffX) < 50 || Math.abs(diffX) < Math.abs(diffY)) return;

    const idx = days.findIndex(d => d.date === activeDate);
    if (idx === -1) return;

    if (diffX > 0) {
      // Swiped left → next day
      const next = days[idx + 1];
      if (next) setActiveDate(next.date);
    } else {
      // Swiped right → previous day
      const prev = days[idx - 1];
      if (prev) setActiveDate(prev.date);
    }
  }, [days, activeDate]);

  const activeDay = (days.find(d => d.date === activeDate) ?? days[0]) || null;
  const dayMatchIds = useMemo(() => activeDay ? activeDay.matches.map(m => m.id) : [], [activeDay]);

  if (!dataQ.data) return null;
  if (!days.length) return <div className="day-empty">No matches scheduled.</div>;

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
          const [dayLabel, dayNum] = shortDayLabel(d.date).split(' ');
          return (
            <button
              key={d.date}
              data-date={d.date}
              className={`day-pill ${isActive ? 'active' : ''}`}
              onClick={() => setActiveDate(d.date)}
            >
              {daysWithNew.has(d.date) && <span className="day-pill-new" />}
              <span className="day-pill-day">{dayLabel}</span>
              <span className="day-pill-num">{dayNum}</span>
              <span className="day-pill-count">{d.matches.length}</span>
            </button>
          );
        })}
      </div>

      {/* Active day header */}
      <div
        className="day-header"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
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
      <div
        className="day-list"
        ref={listRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
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
      {user && <DayLeaderboard matchIds={dayMatchIds} />}
    </div>
  );
}
