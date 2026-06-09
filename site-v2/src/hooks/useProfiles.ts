import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ProfileRow {
  user_id: string;
  display_name: string;
}

/** All profiles, indexed by user_id. Used for leaderboard names. */
export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*');
      if (error) throw error;
      const map: Record<string, ProfileRow> = {};
      for (const p of (data ?? []) as ProfileRow[]) map[p.user_id] = p;
      return map;
    },
  });
}
