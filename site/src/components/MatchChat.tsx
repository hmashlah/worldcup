import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles, type ProfileRow } from '@/hooks/useProfiles';

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

/** Extract @mentions from text. Returns user_ids of mentioned users. */
function extractMentions(text: string, profiles: Record<string, ProfileRow>): string[] {
  const mentionRegex = /@([\w\s]+?)(?=\s@|\s*$|[.,!?;])/g;
  const mentioned: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = mentionRegex.exec(text)) !== null) {
    const name = match[1].trim().toLowerCase();
    for (const [uid, p] of Object.entries(profiles)) {
      if (p.display_name.toLowerCase() === name) {
        mentioned.push(uid);
        break;
      }
    }
  }
  return [...new Set(mentioned)];
}

/** Render message text with @mentions highlighted. */
function renderMessageText(text: string, profiles: Record<string, ProfileRow>) {
  const names = Object.values(profiles).map(p => p.display_name);
  if (names.length === 0) return <>{text}</>;

  // Build regex that matches @name for any known name
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`@(${escaped.join('|')})`, 'gi');
  const parts: Array<{ text: string; isMention: boolean }> = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push({ text: text.slice(lastIdx, m.index), isMention: false });
    parts.push({ text: m[0], isMention: true });
    lastIdx = regex.lastIndex;
  }
  if (lastIdx < text.length) parts.push({ text: text.slice(lastIdx), isMention: false });
  if (parts.length === 0) return <>{text}</>;

  return (
    <>
      {parts.map((part, i) =>
        part.isMention
          ? <span key={i} className="chat-mention">{part.text}</span>
          : <span key={i}>{part.text}</span>
      )}
    </>
  );
}

export function MatchChat({ matchId, onClose }: Props) {
  const { user } = useAuth();
  const profilesQ = useProfiles();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const profiles = profilesQ.data ?? {};

  // Sorted list of other users for mention autocomplete
  const otherUsers = useMemo(() => {
    if (!user) return [];
    return Object.entries(profiles)
      .filter(([uid, p]) => uid !== user.id && p.approved)
      .map(([uid, p]) => ({ uid, name: p.display_name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, user]);

  // Filtered mention suggestions
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return otherUsers.filter(u => u.name.toLowerCase().startsWith(q)).slice(0, 5);
  }, [mentionQuery, otherUsers]);

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

  // Close on Escape key (only if not in mention autocomplete)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mentionQuery === null) onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, mentionQuery]);

  // Detect @mention trigger from input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);

    // Find if cursor is after a @ that starts a mention
    const cursorPos = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atIdx = textBeforeCursor.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || textBeforeCursor[atIdx - 1] === ' ')) {
      const query = textBeforeCursor.slice(atIdx + 1);
      // Only trigger if no space that would indicate end of mention attempt
      if (!query.includes('\n')) {
        setMentionQuery(query);
        setMentionIdx(0);
        return;
      }
    }
    setMentionQuery(null);
  };

  const insertMention = (name: string) => {
    const cursorPos = inputRef.current?.selectionStart ?? inputText.length;
    const textBeforeCursor = inputText.slice(0, cursorPos);
    const atIdx = textBeforeCursor.lastIndexOf('@');
    const before = inputText.slice(0, atIdx);
    const after = inputText.slice(cursorPos);
    const newText = `${before}@${name} ${after}`;
    setInputText(newText);
    setMentionQuery(null);
    // Focus back on input
    setTimeout(() => {
      if (inputRef.current) {
        const pos = atIdx + name.length + 2; // @name + space
        inputRef.current.focus();
        inputRef.current.selectionStart = pos;
        inputRef.current.selectionEnd = pos;
      }
    }, 0);
  };

  const handleSend = useCallback(async () => {
    if (!user || !inputText.trim() || sending) return;
    const text = inputText.trim();
    setSending(true);

    // Insert message
    await supabase.from('wc26_messages').insert({
      user_id: user.id,
      match_id: matchId,
      text,
    });

    // Extract mentions and create notifications
    const mentionedIds = extractMentions(text, profiles);
    if (mentionedIds.length > 0) {
      const senderName = profiles[user.id]?.display_name ?? 'Someone';
      const notifications = mentionedIds.map(uid => ({
        user_id: uid,
        from_user_id: user.id,
        match_id: matchId,
        type: 'mention' as const,
        text: `${senderName} mentioned you in match chat`,
      }));
      await supabase.from('wc26_notifications').insert(notifications);
    }

    setInputText('');
    setSending(false);
  }, [user, inputText, matchId, sending, profiles]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle mention autocomplete navigation
    if (mentionQuery !== null && mentionSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIdx(i => (i + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIdx(i => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionSuggestions[mentionIdx].name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

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
                <div className="chat-msg-text">{renderMessageText(msg.text, profiles)}</div>
                <div className="chat-msg-time">{relativeTime(msg.created_at)}</div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {user && (
          <div className="chat-input-row">
            <div className="chat-input-wrapper">
              {mentionQuery !== null && mentionSuggestions.length > 0 && (
                <div className="mention-dropdown">
                  {mentionSuggestions.map((s, i) => (
                    <button
                      key={s.uid}
                      type="button"
                      className={`mention-option ${i === mentionIdx ? 'mention-option-active' : ''}`}
                      onMouseDown={e => { e.preventDefault(); insertMention(s.name); }}
                    >
                      @{s.name}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                ref={inputRef}
                className="chat-input"
                placeholder="Type a message… (@ to mention)"
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                rows={1}
              />
            </div>
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
