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
 * The cron polls football-data.org every 2 minutes, so this data is up
 * to ~2 min stale. React Query refetches every 30s on its own; if no
 * matches are live, the table is empty and the request is cheap.
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
    // Refetch every 30 seconds. Cheaper than putting refetch logic on
    // every page that cares; React Query dedupes across components.
    refetchInterval: 30_000,
    // Window-focus refetch is on by default — also useful when users
    // tab back from a TV broadcast.
  });
}
