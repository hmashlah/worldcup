import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { FdMatchPayload } from '@/hooks/useResults';

export interface LiveMatchRow {
  match_id: string;
  payload: FdMatchPayload;
  updated_at: string;
}

/**
 * Live (in-progress) matches, indexed by match_id. Distinct from
 * useResults — wc26_match_live is the ephemeral "what's happening
 * right now" feed maintained by /sync-matches; wc26_match_results is
 * the league's official finished-only scoreboard.
 *
 * Refetch cadence is intentionally aggressive when the user is
 * actively watching: 15s on a focused tab, 60s in the background.
 * The cron polls football-data.org every 15s during live play, so
 * 15s on the client is roughly synchronized with the upstream cadence
 * — any faster would just re-read the same row.
 */
export function useLiveMatches() {
  return useQuery({
    queryKey: ['match_live'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wc26_match_live')
        .select('match_id, payload, updated_at');
      if (error) throw error;
      const map: Record<string, LiveMatchRow> = {};
      for (const r of (data ?? []) as LiveMatchRow[]) map[r.match_id] = r;
      return map;
    },
    // 15s when the tab is focused, 60s when in the background. React
    // Query passes `false` to indicate the tab is hidden, so we use
    // the document's visibility state directly via the function form
    // so both browser-tab-blur and OS-level lock states drop us to 60s.
    refetchInterval: () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return 60_000;
      }
      return 15_000;
    },
    // Reset the timer the moment focus returns, so a backgrounded
    // tab pulls fresh data immediately on focus instead of waiting
    // up to 60s for the next tick.
    refetchOnWindowFocus: true,
  });
}
