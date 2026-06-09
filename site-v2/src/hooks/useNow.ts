import { useEffect, useState } from 'react';

/**
 * Re-renders the consuming component every `intervalMs` so kickoff locks
 * tick over without a manual refresh. 30s is plenty for a friend-pool.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
