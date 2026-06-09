import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface PredictionRow {
  user_id: string;
  match_id: string;
  team1_score: number;
  team2_score: number;
  advancer: string | null;
}

export interface PredictionDraft {
  match_id: string;
  team1_score: number;
  team2_score: number;
  advancer?: string | null;
}

/** Current user's predictions, indexed by match_id. */
export function useMyPredictions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['predictions', user?.id ?? 'anon'],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wc26_predictions')
        .select('*')
        .eq('user_id', user!.id);
      if (error) throw error;
      const map: Record<string, PredictionRow> = {};
      for (const r of (data ?? []) as PredictionRow[]) map[r.match_id] = r;
      return map;
    },
  });
}

/** All users' predictions — used by the leaderboard. */
export function useAllPredictions() {
  return useQuery({
    queryKey: ['predictions', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wc26_predictions').select('*');
      if (error) throw error;
      return (data ?? []) as PredictionRow[];
    },
  });
}

export function useUpsertPrediction() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: PredictionDraft) => {
      if (!user) throw new Error('Not signed in');
      const row = {
        user_id: user.id,
        match_id: draft.match_id,
        team1_score: draft.team1_score,
        team2_score: draft.team2_score,
        advancer: draft.advancer ?? null,
      };
      const { error } = await supabase
        .from('wc26_predictions')
        .upsert(row, { onConflict: 'user_id,match_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['predictions'] });
    },
  });
}
