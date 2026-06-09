import { DayView } from '@/components/DayView';
import { GroupsGridView } from '@/components/GroupsGridView';
import { Bracket } from '@/components/Bracket';
import { LeaderboardCard } from '@/components/LeaderboardCard';
import { Topbar } from '@/components/Topbar';
import { AuthModal } from '@/components/AuthModal';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { useTournamentData } from '@/hooks/useTournamentData';
import { useUI } from '@/lib/ui-store';

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { tab, authOpen, setAuthOpen } = useUI();
  const dataQ = useTournamentData();
  const { isAdmin } = useAuth();

  return (
    <>
      <Topbar />
      <main>
        {dataQ.isLoading && <p style={{ textAlign: 'center', padding: '32px' }}>loading…</p>}
        {dataQ.error && <p style={{ textAlign: 'center', padding: '32px', color: 'crimson' }}>
          Failed to load tournament data.
        </p>}
        {dataQ.data && (
          <>
            {tab === 'today' && <TodayTab />}
            {tab === 'groups' && <GroupsTab />}
            {tab === 'bracket' && <BracketTab />}
            {tab === 'leaderboard' && <LeaderboardTab />}
            {tab === 'admin' && isAdmin && <AdminTab />}
          </>
        )}
      </main>
      <footer>
        <p>Made with <span className="heart">♡</span> for our 2026 summer</p>
      </footer>
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </>
  );
}

function TodayTab() {
  return (
    <section className="tab-panel active">
      <DayView />
    </section>
  );
}

function GroupsTab() {
  return (
    <section className="tab-panel active">
      <div className="section-intro">
        <h2>Groups</h2>
        <p>Tap a group to see its match list. Top 2 of each group + the 8 best 3rd-placed teams advance.</p>
      </div>
      <GroupsGridView />
    </section>
  );
}

function BracketTab() {
  return (
    <section className="tab-panel active">
      <div className="section-intro">
        <h2>Knockouts</h2>
        <p>Predict the score and the advancer for each match. Winners cascade automatically.</p>
      </div>
      <Bracket />
    </section>
  );
}

function LeaderboardTab() {
  return (
    <section className="tab-panel active">
      <div className="section-intro">
        <h2>Leaderboard</h2>
        <p>3 pts for an exact score · 1 pt for the right outcome · +1 in knockouts for the right advancer.</p>
      </div>
      <LeaderboardCard />
    </section>
  );
}

function AdminTab() {
  return (
    <section className="tab-panel active">
      <div className="section-intro">
        <h2>Admin · Enter Results</h2>
        <p>You're the source of truth. Enter actual results in the Today, Groups, or Bracket tabs — the leaderboard recomputes automatically.</p>
      </div>
      <div className="leaderboard-empty">
        Switch to Today, Groups, or Bracket and enter actual scores. As admin, every match's score input writes to <code>wc26_match_results</code>.
      </div>
    </section>
  );
}
