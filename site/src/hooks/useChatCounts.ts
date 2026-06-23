import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

/** Fetch message counts per match (only matches that have messages). */
export function useChatCounts() {
  return useQuery({
    queryKey: ['chat-counts'],
    queryFn: async () => {
      // Use RPC or a raw query to get counts grouped by match_id
      const { data, error } = await supabase
        .from('wc26_messages')
        .select('match_id');
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data ?? []) as { match_id: string }[]) {
        counts[row.match_id] = (counts[row.match_id] || 0) + 1;
      }
      return counts;
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
