import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface Notification {
  id: string;
  user_id: string;
  from_user_id: string | null;
  match_id: string;
  type: string;
  text: string;
  read: boolean;
  created_at: string;
}

/** Fetch notifications for the current user. */
export function useNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', user?.id],
    enabled: !!user,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from('wc26_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
    refetchInterval: 60_000,
  });
}

/** Subscribe to real-time notifications for the current user. */
export function useNotificationRealtime() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [unreadFlash, setUnreadFlash] = useState(false);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifications:${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'wc26_notifications',
        filter: `user_id=eq.${user.id}`,
      }, () => {
        qc.invalidateQueries({ queryKey: ['notifications', user.id] });
        setUnreadFlash(true);
        setTimeout(() => setUnreadFlash(false), 2000);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  return { unreadFlash };
}

/** Mark all notifications as read. */
export function useMarkAllRead() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!user) return;
      await supabase
        .from('wc26_notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('read', false);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', user?.id] });
    },
  });
}

/** Mark a single notification as read. */
export function useMarkRead() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (notificationId: string) => {
      await supabase
        .from('wc26_notifications')
        .update({ read: true })
        .eq('id', notificationId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', user?.id] });
    },
  });
}
