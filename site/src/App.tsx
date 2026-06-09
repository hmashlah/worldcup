import { GroupCard, useQualifiedThirds } from '@/components/GroupCard';
import { Bracket } from '@/components/Bracket';
import { ChampionCard } from '@/components/ChampionCard';
import { LeaderboardCard } from '@/components/LeaderboardCard';
import { Tabs } from '@/components/Tabs';
import { Header } from '@/components/Header';
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
      <Header />
      <Tabs />
      <main>
        {dataQ.isLoading && <p style={{ textAlign: 'center', padding: '32px' }}>loading…</p>}
        {dataQ.error && <p style={{ textAlign: 'center', padding: '32px', color: 'crimson' }}>
          Failed to load tournament data.
        </p>}
        {dataQ.data && (
          <>
            {tab === 'groups' && <GroupsTab />}
            {tab === 'bracket' && <BracketTab />}
            {tab === 'champion' && <ChampionTab />}
            {tab === 'leaderboard' && <LeaderboardTab />}
            {tab === 'admin' && isAdmin && <AdminTab />}
          </>
        )}
      </main>
      <footer>
        <p>Made with <span className="heart">♡</span> for our 2026 summer · prediction league</p>
      </footer>
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </>
  );
}

function GroupsTab() {
  const dataQ = useTournamentData();
  const qualifiedThirds = useQualifiedThirds();
  if (!dataQ.data) return null;
  return (
    <section className="tab-panel active">
      <div className="section-intro">
        <h2>Group Stage</h2>
        <p>Predict every group match before kickoff. Standings update from the actual results once they come in.</p>
      </div>
      <div className="groups-grid">
        {dataQ.data.groups.map(g => (
          <GroupCard key={g.name} group={g} isThirdQualified={qualifiedThirds.has(g.name)} />
        ))}
      </div>
    </section>
  );
}

function BracketTab() {
  return (
    <section className="tab-panel active">
      <div className="section-intro">
        <h2>Knockouts</h2>
        <p>Predict the score and the advancer for each match — winners cascade automatically.</p>
      </div>
      <Bracket />
    </section>
  );
}

function ChampionTab() {
  return (
    <section className="tab-panel active">
      <ChampionCard />
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
        <p>You're the source of truth. Enter actual results in the Group Stage and Knockouts tabs — the leaderboard recomputes automatically.</p>
      </div>
      <div className="leaderboard-empty">
        Open the Group Stage or Knockouts tab to enter actual scores. As admin, every match's "actual" cell is editable for you.
      </div>
    </section>
  );
}
