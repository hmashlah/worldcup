import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface PlayerStat {
  name: string;
  team: string;
  goals: number;
  penalties: number;
  own_goals: number;
  yellow_cards: number;
  red_cards: number;
  motm: number;
  appearances: number;
}

export function useTopScorers() {
  const query = useQuery({
    queryKey: ['player-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wc26_player_stats')
        .select('*')
        .gt('goals', 0)
        .order('goals', { ascending: false })
        .limit(25);
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
