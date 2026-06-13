import { useUI } from '@/lib/ui-store';

/**
 * Landing screen for unauthenticated visitors. Replaces every tab's
 * content (and any deep-linked match detail page) until the user signs
 * in. Reuses the same .pending-* CSS that PendingApproval uses so the
 * two locked-out states feel like a coherent flow.
 */
export function SignInGate() {
  const setAuthOpen = useUI(s => s.setAuthOpen);
  return (
    <div className="pending-approval">
      <div className="pending-card">
        <div className="pending-icon">♡</div>
        <h2>Welcome to our World Cup ♡</h2>
        <p>
          A small private league for predicting every match of WC 2026.
          Sign in to see fixtures, place your picks, and follow the
          leaderboard.
        </p>
        <p className="pending-meta">
          New here? Hit Sign in and choose <em>Create account</em>.
          You'll need an admin to approve your account before you can
          submit predictions — but you'll see everything else right away.
        </p>
        <button className="btn" onClick={() => setAuthOpen(true)}>
          Sign in
        </button>
      </div>
    </div>
  );
}
