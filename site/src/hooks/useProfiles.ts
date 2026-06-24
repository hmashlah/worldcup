import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface ProfileRow {
  user_id: string;
  display_name: string;
  approved: boolean;
  fav_team: string | null;
  created_at?: string;
}

/** All profiles, indexed by user_id. Used for leaderboard names. */
export function useProfiles() {
  return useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wc26_profiles')
        .select('user_id, display_name, approved, fav_team, created_at');
      if (error) throw error;
      const map: Record<string, ProfileRow> = {};
      for (const p of (data ?? []) as ProfileRow[]) map[p.user_id] = p;
      return map;
    },
    refetchInterval: 5 * 60_000, // 5 min
    refetchOnWindowFocus: true,
  });
}

/** Admin: flip the approved flag on a profile. */
export function useSetApproval() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, approved }: { userId: string; approved: boolean }) => {
      const { error } = await supabase
        .from('wc26_profiles')
        .update({ approved })
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}

/** Admin: hard-delete a profile (used to decline a pending signup).
 *  The auth.users row stays (only a service role can delete it), but
 *  without a profile the user is stuck on the "waiting for approval"
 *  screen forever and can't submit predictions.
 */
export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) => {
      // Predictions get cascade-deleted via the FK on user_id.
      const { error } = await supabase
        .from('wc26_profiles')
        .delete()
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      qc.invalidateQueries({ queryKey: ['predictions'] });
    },
  });
}

/** Current user's own profile — used to gate the app on `approved`. */
export function useMyProfile(userId: string | null) {
  return useQuery({
    queryKey: ['my-profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('wc26_profiles')
        .select('user_id, display_name, approved, fav_team, created_at')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return (data as ProfileRow | null) ?? null;
    },
  });
}

/** Update current user's fav_team. */
export function useSetFavTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, favTeam }: { userId: string; favTeam: string }) => {
      const { error } = await supabase
        .from('wc26_profiles')
        .update({ fav_team: favTeam })
        .eq('user_id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profiles'] });
      qc.invalidateQueries({ queryKey: ['my-profile'] });
    },
  });
}
