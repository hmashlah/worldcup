import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useMyPredictions } from '@/hooks/usePredictions';
import { matchesByDay, defaultDay, countUnsubmitted } from '@/lib/days';
import { useUI, type TabKey } from '@/lib/ui-store';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'today',       label: 'Matches' },
  { key: 'groups',      label: 'Groups' },
  { key: 'bracket',     label: 'Bracket' },
  { key: 'leaderboard', label: 'Leaderboard' },
];

export function Topbar() {
  const { user, isAdmin, signOut } = useAuth();
  const { tab, setTab, setAuthOpen, theme, toggleTheme } = useUI();
  const dataQ = useTournamentData();
  const predsQ = useMyPredictions();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try { await signOut(); } finally { setSigningOut(false); }
  };

  const pendingToday = useMemo(() => {
    if (!user || !dataQ.data) return 0;
    const days = matchesByDay(dataQ.data);
    const target = defaultDay(days);
    if (!target) return 0;
    const day = days.find(d => d.date === target);
    if (!day) return 0;
    return countUnsubmitted(day.matches, predsQ.data ?? {});
  }, [user, dataQ.data, predsQ.data]);

  const tabs = isAdmin ? [...TABS, { key: 'admin' as TabKey, label: 'Admin' }] : TABS;

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <h1 className="topbar-title">World Cup</h1>
        <span className="topbar-year">2026</span>
        {isAdmin && <span className="admin-pill">admin</span>}
      </div>

      <nav className="topbar-tabs">
        {tabs.map(t => (
          <button
            key={t.key}
            className={'tab' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="topbar-controls">
        {user ? (
          <>
            {pendingToday > 0 && (
              <button
                className="pending-pill"
                onClick={() => setTab('today')}
                title="Jump to today's matches"
              >
                {pendingToday} to pick
              </button>
            )}
            <span className="topbar-hello">{user.displayName ?? user.email.split('@')[0]}</span>
            <button className="btn btn-ghost" onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? '...' : 'Sign out'}
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => setAuthOpen(true)}>
            Sign in
          </button>
        )}
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === 'minimal' ? 'Switch to funky mode' : 'Switch to minimal mode'}
          aria-label="Toggle theme"
        >
          {theme === 'minimal' ? (
            // Sparkle icon for "tap to go funky"
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1" />
            </svg>
          ) : (
            // Half-moon for "tap to go minimal"
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M10.6 12.5a5.5 5.5 0 0 1-5.1-7.7 5.5 5.5 0 1 0 7.4 7.4 5.5 5.5 0 0 1-2.3.3z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
