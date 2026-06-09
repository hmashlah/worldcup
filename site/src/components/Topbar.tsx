import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useMyPredictions } from '@/hooks/usePredictions';
import { matchesByDay, defaultDay, countUnsubmitted } from '@/lib/days';
import { useUI, type TabKey } from '@/lib/ui-store';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'today',       label: 'Today' },
  { key: 'groups',      label: 'Groups' },
  { key: 'bracket',     label: 'Bracket' },
  { key: 'leaderboard', label: 'Leaderboard' },
];

export function Topbar() {
  const { user, isAdmin, signOut } = useAuth();
  const { tab, setTab, setAuthOpen } = useUI();
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
                title="Jump to Today"
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
      </div>
    </header>
  );
}
