import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useUI } from '@/lib/ui-store';

export function Header() {
  const { user, isAdmin, signOut } = useAuth();
  const { setAuthOpen } = useUI();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try { await signOut(); } finally { setSigningOut(false); }
  };

  return (
    <header className="hero">
      <div className="hero-inner">
        <div className="kicker">
          our prediction league · USA · Canada · Mexico
          {isAdmin && <span className="admin-pill">admin</span>}
        </div>
        <h1>World Cup <span className="year">2026</span></h1>
        <p className="subtitle">
          Predict every match · climb the leaderboard <span className="heart">♡</span>
        </p>
        <div className="hero-controls">
          {user ? (
            <>
              <span className="hello">Hi, {user.displayName ?? user.email} ♡</span>
              <button className="ghost-btn" onClick={handleSignOut} disabled={signingOut}>
                {signingOut ? '...' : 'Sign out'}
              </button>
            </>
          ) : (
            <>
              <button className="primary-btn" onClick={() => setAuthOpen(true)}>
                Sign in to predict
              </button>
              <span className="saved-hint">Friends-only league</span>
            </>
          )}
        </div>
      </div>
      <div className="hero-petals" aria-hidden />
    </header>
  );
}
