import { useState, useEffect, useCallback } from 'react';
import { isPushSupported, getPermissionState, subscribeToPush, unsubscribeFromPush, isSubscribed } from '@/lib/push';

/**
 * Small toggle button for push notifications.
 * Shows a bell with a slash when disabled, solid bell when enabled.
 * Only renders for logged-in users on supported browsers.
 */
export function PushToggle() {
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [supported] = useState(isPushSupported);

  useEffect(() => {
    if (!supported) return;
    isSubscribed().then(setSubscribed);
  }, [supported]);

  const handleToggle = useCallback(async () => {
    setLoading(true);
    try {
      if (subscribed) {
        const ok = await unsubscribeFromPush();
        if (ok) setSubscribed(false);
      } else {
        const ok = await subscribeToPush();
        if (ok) setSubscribed(true);
      }
    } finally {
      setLoading(false);
    }
  }, [subscribed]);

  if (!supported) return null;

  const permission = getPermissionState();
  // If denied, show disabled state with tooltip
  if (permission === 'denied') {
    return (
      <button
        className="push-toggle push-toggle--denied"
        title="Push notifications blocked. Enable in browser settings."
        disabled
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13.7 13.7L2.3 2.3" />
          <path d="M6.3 2.6A3.5 3.5 0 0 1 12 5.5c0 2.6 1 4 1 4H5.5" />
          <path d="M4 4a5.3 5.3 0 0 0-.5 1.5C3.5 8.1 2.5 9.5 2.5 9.5h8" />
          <path d="M6.5 12a1.5 1.5 0 0 0 3 0" />
        </svg>
      </button>
    );
  }

  return (
    <button
      className={`push-toggle${subscribed ? ' push-toggle--on' : ''}`}
      onClick={handleToggle}
      disabled={loading}
      title={subscribed ? 'Disable push notifications' : 'Enable push notifications'}
    >
      {subscribed ? (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1.5a3.5 3.5 0 0 0-3.5 3.5c0 2.6-1 4-1 4h9s-1-1.4-1-4A3.5 3.5 0 0 0 8 1.5z" />
          <path d="M6.5 12a1.5 1.5 0 0 0 3 0" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12.5 9.5s-1-1.4-1-4a3.5 3.5 0 1 0-7 0c0 2.6-1 4-1 4h9z" />
          <path d="M6.5 12a1.5 1.5 0 0 0 3 0" />
        </svg>
      )}
    </button>
  );
}
