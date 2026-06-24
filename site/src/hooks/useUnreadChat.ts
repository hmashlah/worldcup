import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useUI } from '@/lib/ui-store';

const LAST_SEEN_KEY = 'wc26-chat-last-seen';

function getLastSeen(): string {
  return localStorage.getItem(LAST_SEEN_KEY) || '1970-01-01T00:00:00Z';
}

function setLastSeen(iso: string) {
  localStorage.setItem(LAST_SEEN_KEY, iso);
}

/** Returns the count of chat messages newer than the user's last visit to the Chat tab. */
export function useUnreadChat() {
  const tab = useUI(s => s.tab);
  const [unread, setUnread] = useState(0);

  // When user enters chat tab, mark everything as read
  useEffect(() => {
    if (tab === 'chat') {
      setLastSeen(new Date().toISOString());
      setUnread(0);
    }
  }, [tab]);

  // Fetch unread count on mount
  useEffect(() => {
    (async () => {
      const lastSeen = getLastSeen();
      const { count } = await supabase
        .from('wc26_messages')
        .select('*', { count: 'exact', head: true })
        .gt('created_at', lastSeen);
      setUnread(count ?? 0);
    })();
  }, []);

  // Listen for new messages in real-time
  useEffect(() => {
    const channel = supabase
      .channel('chat-unread')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'wc26_messages',
      }, () => {
        // If currently on chat tab, auto-mark as read
        if (useUI.getState().tab === 'chat') {
          setLastSeen(new Date().toISOString());
        } else {
          setUnread(n => n + 1);
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  return unread;
}
