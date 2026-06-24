import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { PlayerStat, TeamStat } from '@/lib/stats';

export type { PlayerStat, TeamStat } from '@/lib/stats';

export function useTopScorers() {
  const query = useQuery({
    queryKey: ['player-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wc26_player_stats')
        .select('*')
        .gt('goals', 0)
        .order('goals', { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as PlayerStat[];
    },
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  return { scorers: query.data ?? [], loading: query.isLoading };
}

export function usePlayerStats() {
  return useQuery({
    queryKey: ['player-stats-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wc26_player_stats')
        .select('*');
      if (error) throw error;
      return (data ?? []) as PlayerStat[];
    },
    refetchInterval: 5 * 60_000,
  });
}

export function useTeamStats() {
  return useQuery({
    queryKey: ['team-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wc26_team_stats')
        .select('*')
        .order('goals_for', { ascending: false });
      if (error) throw error;
      return (data ?? []) as TeamStat[];
    },
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}
