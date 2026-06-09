import { useAuth } from '@/contexts/AuthContext';

export function PendingApproval() {
  const { user, signOut } = useAuth();
  return (
    <div className="pending-approval">
      <div className="pending-card">
        <div className="pending-icon">✿</div>
        <h2>You're on the list</h2>
        <p>
          Thanks for joining, <strong>{user?.displayName ?? user?.email.split('@')[0]}</strong>.
          Your account is awaiting admin approval.
        </p>
        <p className="pending-meta">
          Once Hazem approves you, you'll be able to submit predictions and appear on the leaderboard.
          You can leave this page open — access unlocks automatically when you're approved.
        </p>
        <button className="btn btn-ghost" onClick={() => signOut()}>Sign out</button>
      </div>
    </div>
  );
}
