import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  onClose: () => void;
}

export function AuthModal({ onClose }: Props) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !password || (mode === 'signup' && !displayName)) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'signin') await signIn(email, password);
      else await signUp(email, password, displayName);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void submit();
  };

  return (
    <div className="auth-overlay" onClick={onClose}>
      <div className="auth-card" onClick={e => e.stopPropagation()}>
        <h2>{mode === 'signin' ? 'Welcome back ♡' : 'Join the league ♡'}</h2>
        <p className="auth-subtitle">
          {mode === 'signin'
            ? 'Sign in to submit your predictions.'
            : 'Pick a display name — that\'s what shows on the leaderboard.'}
        </p>

        {error && <div className="auth-error">{error}</div>}

        {mode === 'signup' && (
          <label className="auth-field">
            <span>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="e.g. Hazem"
              onKeyDown={onKey}
            />
          </label>
        )}

        <label className="auth-field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
            onKeyDown={onKey}
            autoComplete="email"
          />
        </label>

        <label className="auth-field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            onKeyDown={onKey}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
        </label>

        <div className="auth-actions">
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={busy || !email || !password || (mode === 'signup' && !displayName)}
          >
            {busy
              ? '...'
              : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>

        <button
          className="auth-switch"
          onClick={() => { setError(''); setMode(mode === 'signin' ? 'signup' : 'signin'); }}
        >
          {mode === 'signin'
            ? "Don't have an account? Sign up"
            : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
