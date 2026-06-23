import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles } from '@/hooks/useProfiles';

interface Message {
  id: string;
  user_id: string;
  text: string;
  created_at: string;
}

interface Props {
  matchId: string;
  onClose: () => void;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function MatchChat({ matchId, onClose }: Props) {
  const { user } = useAuth();
  const profilesQ = useProfiles();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Fetch existing messages
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('wc26_messages')
        .select('id, user_id, text, created_at')
        .eq('match_id', matchId)
        .order('created_at', { ascending: true });
      if (!cancelled) {
        setMessages((data as Message[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [matchId]);

  // Subscribe to realtime inserts
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${matchId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'wc26_messages',
        filter: `match_id=eq.${matchId}`,
      }, (payload) => {
        const newMsg = payload.new as Message;
        setMessages(prev => [...prev, newMsg]);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [matchId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSend = useCallback(async () => {
    if (!user || !inputText.trim() || sending) return;
    setSending(true);
    await supabase.from('wc26_messages').insert({
      user_id: user.id,
      match_id: matchId,
      text: inputText.trim(),
    });
    setInputText('');
    setSending(false);
  }, [user, inputText, matchId, sending]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const profiles = profilesQ.data ?? {};

  return (
    <div className="gc-modal-overlay" onClick={onClose}>
      <div className="gc-modal chat-modal" onClick={e => e.stopPropagation()}>
        <div className="gc-modal-header">
          <h3>Match Chat</h3>
          <button type="button" className="gc-modal-close" onClick={onClose}>×</button>
        </div>

        <div className="chat-messages" ref={messagesContainerRef}>
          {loading && <p className="chat-loading">Loading messages…</p>}
          {!loading && messages.length === 0 && (
            <p className="chat-empty">No messages yet — be the first!</p>
          )}
          {messages.map(msg => {
            const isMine = msg.user_id === user?.id;
            const name = profiles[msg.user_id]?.display_name ?? 'Unknown';
            return (
              <div key={msg.id} className={`chat-msg ${isMine ? 'chat-msg-mine' : 'chat-msg-other'}`}>
                {!isMine && <div className="chat-msg-name">{name}</div>}
                <div className="chat-msg-text">{msg.text}</div>
                <div className="chat-msg-time">{relativeTime(msg.created_at)}</div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {user && (
          <div className="chat-input-row">
            <textarea
              className="chat-input"
              placeholder="Type a message…"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <button
              type="button"
              className="chat-send"
              onClick={handleSend}
              disabled={sending || !inputText.trim()}
              aria-label="Send message"
            >
              ↑
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
