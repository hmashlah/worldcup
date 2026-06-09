import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ResultRow {
  match_id: string;
  team1_score: number;
  team2_score: number;
  advancer: string | null;
}

export interface ResultDraft {
  match_id: string;
  team1_score: number;
  team2_score: number;
  advancer?: string | null;
}

/** Actual results, indexed by match_id. Anyone authenticated can read. */
export function useResults() {
  return useQuery({
    queryKey: ['match_results'],
    queryFn: async () => {
      const { data, error } = await supabase.from('wc26_match_results').select('*');
      if (error) throw error;
      const map: Record<string, ResultRow> = {};
      for (const r of (data ?? []) as ResultRow[]) map[r.match_id] = r;
      return map;
    },
  });
}

export function useUpsertResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (draft: ResultDraft) => {
      const { error } = await supabase
        .from('wc26_match_results')
        .upsert(
          {
            match_id: draft.match_id,
            team1_score: draft.team1_score,
            team2_score: draft.team2_score,
            advancer: draft.advancer ?? null,
          },
          { onConflict: 'match_id' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match_results'] });
    },
  });
}

/** Admin: remove an actual result (e.g. typed it wrong, want to clear it). */
export function useDeleteResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (matchId: string) => {
      const { error } = await supabase
        .from('wc26_match_results')
        .delete()
        .eq('match_id', matchId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['match_results'] });
    },
  });
}
