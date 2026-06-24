import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useMyPredictions } from '@/hooks/usePredictions';
import { useUnreadChat } from '@/hooks/useUnreadChat';
import { matchesByDay, defaultDay, countUnsubmitted } from '@/lib/days';
import { useUI, type TabKey } from '@/lib/ui-store';
import { NotificationBell } from '@/components/NotificationBell';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'today',       label: 'Matches' },
  { key: 'groups',      label: 'Groups' },
  { key: 'bracket',     label: 'Bracket' },
  { key: 'leaderboard', label: 'Leaderboard' },
  { key: 'stats',       label: 'Records' },
  { key: 'chat',        label: 'Chat' },
  { key: 'picks',       label: 'My Picks' },
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
    if (!user || !dataQ.data || !predsQ.data) return 0;
    const days = matchesByDay(dataQ.data);
    const target = defaultDay(days);
    if (!target) return 0;
    const day = days.find(d => d.date === target);
    if (!day) return 0;
    return countUnsubmitted(day.matches, predsQ.data);
  }, [user, dataQ.data, predsQ.data]);

  const unreadChat = useUnreadChat();

  useEffect(() => {
    if (tab === 'admin' && !isAdmin) setTab('today');
    if (tab === 'leaderboard' && !user) setTab('today');
    if (tab === 'picks' && !user) setTab('today');
    if (tab === 'chat' && !user) setTab('today');
  }, [tab, isAdmin, user, setTab]);

  // Build the visible tab list: guests don't see prediction-related tabs (Leaderboard, My Picks, Chat).
  const baseTabs = user
    ? TABS
    : TABS.filter(t => t.key !== 'leaderboard' && t.key !== 'picks' && t.key !== 'chat');
  const tabs = isAdmin ? [...baseTabs, { key: 'admin' as TabKey, label: 'Admin' }] : baseTabs;

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <h1 className="topbar-title">World Cup</h1>
        <span className="topbar-year">2026</span>
      </div>

      <nav className="topbar-tabs">
        {tabs.map(t => (
          <button
            key={t.key}
            className={'tab' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'chat' && unreadChat > 0 && tab !== 'chat' && (
              <span className="tab-badge">{unreadChat > 9 ? '9+' : unreadChat}</span>
            )}
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
            <NotificationBell />
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
          title={theme === 'minimal' ? 'Switch to dark mode' : theme === 'dark' ? 'Switch to funky mode' : 'Switch to minimal mode'}
          aria-label="Toggle theme"
        >
          {theme === 'minimal' ? (
            /* Moon icon — previews dark */
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              <path d="M10.6 12.5a5.5 5.5 0 0 1-5.1-7.7 5.5 5.5 0 1 0 7.4 7.4 5.5 5.5 0 0 1-2.3.3z" />
            </svg>
          ) : theme === 'dark' ? (
            /* Sparkle icon — previews funky */
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3M3.4 3.4l2.1 2.1M10.5 10.5l2.1 2.1M3.4 12.6l2.1-2.1M10.5 5.5l2.1-2.1" />
            </svg>
          ) : (
            /* Sun icon — previews minimal */
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="8" cy="8" r="3" />
              <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.7 3.7l1.4 1.4M10.9 10.9l1.4 1.4M3.7 12.3l1.4-1.4M10.9 5.1l1.4-1.4" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
}
