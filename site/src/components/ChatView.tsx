import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles, type ProfileRow } from '@/hooks/useProfiles';
import { relativeTime, extractMentions } from '@/lib/utils';

const EMOJI_GROUPS: Array<{ label: string; emojis: string[] }> = [
  { label: 'Football', emojis: ['⚽', '🥅', '🏆', '🏟️', '🎯', '🔥', '💪', '👏', '🙌', '🤝', '🫡', '🇦🇷'] },
  { label: 'Reactions', emojis: ['😂', '🤣', '😭', '😱', '🤯', '😤', '🥳', '🫠', '💀', '🤡', '👀', '😈'] },
  { label: 'Hands', emojis: ['👍', '👎', '🤞', '✌️', '🤙', '👊', '🫶', '🙏', '💅', '🖕', '👆', '✊'] },
  { label: 'Misc', emojis: ['❤️', '💔', '🎉', '🎊', '💯', '⭐', '🌟', '🍀', '🐐', '🦁', '🇧🇷', '🇩🇪'] },
];

interface Message {
  id: string;
  user_id: string;
  text: string;
  created_at: string;
}

/** Render message text with @mentions highlighted. */
function renderMessageText(text: string, profiles: Record<string, ProfileRow>) {
  const names = Object.values(profiles).map(p => p.display_name);
  if (names.length === 0) return <>{text}</>;

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

export function ChatView() {
  const { user } = useAuth();
  const profilesQ = useProfiles();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);

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

  // Fetch existing messages (global — no match_id filter)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('wc26_messages')
        .select('id, user_id, text, created_at')
        .order('created_at', { ascending: true })
        .limit(200);
      if (!cancelled) {
        setMessages((data as Message[]) ?? []);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Subscribe to realtime inserts (all messages)
  useEffect(() => {
    const channel = supabase
      .channel('messages:global')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'wc26_messages',
      }, (payload) => {
        const newMsg = payload.new as Message;
        setMessages(prev => {
          // Deduplicate: if this message already exists (from optimistic send), replace temp
          const hasTemp = prev.some(m => m.id.startsWith('temp-') && m.user_id === newMsg.user_id && m.text === newMsg.text);
          if (hasTemp) {
            return prev.map(m =>
              m.id.startsWith('temp-') && m.user_id === newMsg.user_id && m.text === newMsg.text
                ? newMsg : m
            );
          }
          // Also skip if exact ID already present
          if (prev.some(m => m.id === newMsg.id)) return prev;
          return [...prev, newMsg];
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close emoji picker on outside click
  useEffect(() => {
    if (!emojiOpen) return;
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setEmojiOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [emojiOpen]);

  const insertEmoji = (emoji: string) => {
    const cursorPos = inputRef.current?.selectionStart ?? inputText.length;
    const newText = inputText.slice(0, cursorPos) + emoji + inputText.slice(cursorPos);
    setInputText(newText);
    setEmojiOpen(false);
    setTimeout(() => {
      if (inputRef.current) {
        const pos = cursorPos + emoji.length;
        inputRef.current.focus();
        inputRef.current.selectionStart = pos;
        inputRef.current.selectionEnd = pos;
      }
    }, 0);
  };

  // Detect @mention trigger from input
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);

    const cursorPos = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atIdx = textBeforeCursor.lastIndexOf('@');
    if (atIdx >= 0 && (atIdx === 0 || textBeforeCursor[atIdx - 1] === ' ')) {
      const query = textBeforeCursor.slice(atIdx + 1);
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
    setTimeout(() => {
      if (inputRef.current) {
        const pos = atIdx + name.length + 2;
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

    // Optimistic: add message locally immediately
    const optimisticMsg: Message = {
      id: `temp-${Date.now()}`,
      user_id: user.id,
      text,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setInputText('');

    // Insert into DB
    const { data } = await supabase.from('wc26_messages').insert({
      user_id: user.id,
      match_id: 'global',
      text,
    }).select('id, user_id, text, created_at').single();

    // Replace optimistic message with real one (if realtime hasn't already)
    if (data) {
      setMessages(prev => prev.map(m => m.id === optimisticMsg.id ? (data as Message) : m));
    }

    // Extract mentions and create notifications
    const mentionedIds = extractMentions(text, profiles, user.id);
    if (mentionedIds.length > 0) {
      const senderName = profiles[user.id]?.display_name ?? 'Someone';
      const notifications = mentionedIds.map(uid => ({
        user_id: uid,
        from_user_id: user.id,
        match_id: 'global',
        type: 'mention' as const,
        text: `${senderName} mentioned you in chat`,
      }));
      await supabase.from('wc26_notifications').insert(notifications);
    }

    setSending(false);
  }, [user, inputText, sending, profiles]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    <section className="tab-panel active">
      <div className="chat-container">
        <div className="chat-messages chat-messages-full">
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
            <div className="emoji-picker-wrapper" ref={emojiRef}>
              <button
                type="button"
                className="emoji-toggle"
                onClick={() => setEmojiOpen(o => !o)}
                aria-label="Insert emoji"
              >
                ☺
              </button>
              {emojiOpen && (
                <div className="emoji-picker">
                  {EMOJI_GROUPS.map(g => (
                    <div key={g.label} className="emoji-group">
                      <div className="emoji-group-label">{g.label}</div>
                      <div className="emoji-grid">
                        {g.emojis.map(e => (
                          <button
                            key={e}
                            type="button"
                            className="emoji-btn"
                            onMouseDown={ev => { ev.preventDefault(); insertEmoji(e); }}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
    </section>
  );
}
