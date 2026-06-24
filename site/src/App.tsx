import { DayView } from '@/components/DayView';
import { GroupsGridView } from '@/components/GroupsGridView';
import { Bracket } from '@/components/Bracket';
import { LeaderboardCard } from '@/components/LeaderboardCard';
import { PointsTrendChart } from '@/components/PointsTrendChart';
import { SeasonAwards } from '@/components/SeasonAwards';
import { MyPicksView } from '@/components/MyPicksView';
import { ChatView } from '@/components/ChatView';
import { Topbar } from '@/components/Topbar';
import { AuthModal } from '@/components/AuthModal';
import { PendingApproval } from '@/components/PendingApproval';
import { AdminPendingUsers } from '@/components/AdminPendingUsers';
import { MatchDetailPage } from '@/pages/MatchDetailPage';
import { TeamMatchesModal } from '@/components/TeamMatchesModal';
import { TimeCapsuleModal, useTimeCapsule } from '@/components/TimeCapsule';
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
  const { tab, authOpen, setAuthOpen, openMatchId, openTeamName, closeTeam } = useUI();
  const dataQ = useTournamentData();
  const { user, isAdmin, isApproved, approvalLoading } = useAuth();
  const capsule = useTimeCapsule();

  // Signed-in but not yet approved by admin → show holding screen.
  // Anonymous visitors get the full read-only browse — they just see
  // limited tabs and no per-player predictions (gated in components).
  const showPending = !!user && !approvalLoading && !isApproved;

  return (
    <>
      <Topbar />
      <main>
        {showPending ? (
          <PendingApproval />
        ) : (
          <>
            {dataQ.isLoading && <p style={{ textAlign: 'center', padding: '32px' }}>loading…</p>}
            {dataQ.error && <p style={{ textAlign: 'center', padding: '32px', color: 'crimson' }}>
              Failed to load tournament data.
            </p>}
            {dataQ.data && (
              openMatchId
                ? <MatchDetailPage matchId={openMatchId} />
                : <>
                    {tab === 'today' && <TodayTab />}
                    {tab === 'groups' && <GroupsTab />}
                    {tab === 'bracket' && <BracketTab />}
                    {tab === 'leaderboard' && user && <LeaderboardTab />}
                    {tab === 'picks' && user && <MyPicksTab />}
                    {tab === 'chat' && user && <ChatView />}
                    {tab === 'admin' && isAdmin && <AdminTab />}
                  </>
            )}
          </>
        )}
      </main>
      {tab !== 'chat' && (
        <footer>
          <p>Made with <span className="heart">♡</span> for our 2026 summer</p>
        </footer>
      )}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      {openTeamName && <TeamMatchesModal team={openTeamName} onClose={closeTeam} />}
      {capsule.showPrompt && isApproved && (
        <TimeCapsuleModal onClose={() => capsule.setShowPrompt(false)} />
      )}
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
      <PointsTrendChart />
      <SeasonAwards />
    </section>
  );
}

function MyPicksTab() {
  return (
    <section className="tab-panel active">
      <div className="section-intro">
        <h2>My Picks</h2>
        <p>Your predictions vs. actual results. 3 pts exact · 1 pt right outcome · +1 correct advancer in knockouts.</p>
      </div>
      <MyPicksView />
    </section>
  );
}

function AdminTab() {
  return (
    <section className="tab-panel active">
      <div className="section-intro">
        <h2>Admin</h2>
        <p>Approve or decline pending signups.</p>
      </div>
      <AdminPendingUsers />
    </section>
  );
}
