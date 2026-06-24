import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useProfiles, type ProfileRow } from '@/hooks/useProfiles';
import { Flag } from '@/components/Flag';
import { relativeTime, extractMentions } from '@/lib/utils';

const REACTION_EMOJIS = ['👍', '😂', '🔥', '❤️', '😮', '😢'];

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
  image_url: string | null;
  created_at: string;
}

interface Reaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
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
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [reactPickerMsgId, setReactPickerMsgId] = useState<string | null>(null);

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
        .select('id, user_id, text, image_url, created_at')
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

  // Fetch reactions
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('wc26_reactions')
        .select('id, message_id, user_id, emoji');
      setReactions((data as Reaction[]) ?? []);
    })();
  }, []);

  // Subscribe to reaction changes
  useEffect(() => {
    const channel = supabase
      .channel('reactions:global')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'wc26_reactions',
      }, (payload) => {
        const r = payload.new as Reaction;
        setReactions(prev => prev.some(x => x.id === r.id) ? prev : [...prev, r]);
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'wc26_reactions',
      }, (payload) => {
        const old = payload.old as { id: string };
        setReactions(prev => prev.filter(r => r.id !== old.id));
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

  /** Compress an image file to max 800px wide, JPEG quality 0.7 */
  const compressImage = (file: File): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 480;
        const scale = img.width > maxW ? maxW / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.6);
      };
      img.src = URL.createObjectURL(file);
    });
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    e.target.value = ''; // reset so same file can be re-selected

    setUploading(true);
    try {
      const compressed = await compressImage(file);
      const filename = `${user.id}/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('chat-images')
        .upload(filename, compressed, { contentType: 'image/jpeg' });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('chat-images')
        .getPublicUrl(filename);

      const imageUrl = urlData.publicUrl;

      // Optimistic message with image
      const optimisticMsg: Message = {
        id: `temp-${Date.now()}`,
        user_id: user.id,
        text: '',
        image_url: imageUrl,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, optimisticMsg]);

      // Insert into DB
      const { data } = await supabase.from('wc26_messages').insert({
        user_id: user.id,
        match_id: 'global',
        text: '',
        image_url: imageUrl,
      }).select('id, user_id, text, image_url, created_at').single();

      if (data) {
        setMessages(prev => prev.map(m => m.id === optimisticMsg.id ? (data as Message) : m));
      }
    } catch (err) {
      console.error('Image upload failed:', err);
    }
    setUploading(false);
  };

  const EDIT_WINDOW_MS = 30 * 60_000; // 30 minutes

  const canEditMsg = (msg: Message) => {
    if (msg.user_id !== user?.id) return false;
    if (msg.id.startsWith('temp-')) return false;
    return Date.now() - new Date(msg.created_at).getTime() < EDIT_WINDOW_MS;
  };

  const startEdit = (msg: Message) => {
    setEditingId(msg.id);
    setEditText(msg.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const saveEdit = async (msgId: string) => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    await supabase.from('wc26_messages').update({ text: trimmed }).eq('id', msgId);
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, text: trimmed } : m));
    setEditingId(null);
    setEditText('');
  };

  const deleteMsg = async (msgId: string) => {
    await supabase.from('wc26_messages').delete().eq('id', msgId);
    setMessages(prev => prev.filter(m => m.id !== msgId));
  };

  const toggleReaction = async (msgId: string, emoji: string) => {
    if (!user) return;
    const existing = reactions.find(r => r.message_id === msgId && r.user_id === user.id && r.emoji === emoji);
    if (existing) {
      // Remove reaction
      await supabase.from('wc26_reactions').delete().eq('id', existing.id);
      setReactions(prev => prev.filter(r => r.id !== existing.id));
    } else {
      // Add reaction
      const { data } = await supabase.from('wc26_reactions').insert({
        message_id: msgId,
        user_id: user.id,
        emoji,
      }).select('id, message_id, user_id, emoji').single();
      if (data) {
        setReactions(prev => [...prev, data as Reaction]);
      }
      // Notify the message author (if not self)
      const msg = messages.find(m => m.id === msgId);
      if (msg && msg.user_id !== user.id) {
        const senderName = profiles[user.id]?.display_name ?? 'Someone';
        await supabase.from('wc26_notifications').insert({
          user_id: msg.user_id,
          from_user_id: user.id,
          match_id: 'global',
          type: 'reaction',
          text: `${senderName} reacted ${emoji} to your message`,
        });
      }
    }
    setReactPickerMsgId(null);
  };

  /** Get grouped reaction counts for a message */
  const getReactions = (msgId: string) => {
    const msgReactions = reactions.filter(r => r.message_id === msgId);
    const grouped: Record<string, { count: number; mine: boolean; names: string[] }> = {};
    for (const r of msgReactions) {
      if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, mine: false, names: [] };
      grouped[r.emoji].count++;
      if (r.user_id === user?.id) grouped[r.emoji].mine = true;
      const name = profiles[r.user_id]?.display_name ?? 'Unknown';
      grouped[r.emoji].names.push(name);
    }
    return grouped;
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
      image_url: null,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticMsg]);
    setInputText('');

    // Insert into DB
    const { data } = await supabase.from('wc26_messages').insert({
      user_id: user.id,
      match_id: 'global',
      text,
    }).select('id, user_id, text, image_url, created_at').single();

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
            const editable = canEditMsg(msg);
            return (
              <div key={msg.id} className={`chat-msg ${isMine ? 'chat-msg-mine' : 'chat-msg-other'}`}>
                {!isMine && <div className="chat-msg-name">{profiles[msg.user_id]?.fav_team && <Flag team={profiles[msg.user_id].fav_team!} />} {name}</div>}
                {msg.image_url && (
                  <img
                    src={msg.image_url}
                    alt="shared image"
                    className="chat-msg-image"
                    loading="lazy"
                    onClick={() => setLightboxUrl(msg.image_url)}
                  />
                )}
                {editingId === msg.id ? (
                  <div className="chat-edit-row">
                    <input
                      className="chat-edit-input"
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') saveEdit(msg.id);
                        if (e.key === 'Escape') cancelEdit();
                      }}
                      autoFocus
                    />
                    <button type="button" className="chat-edit-save" onClick={() => saveEdit(msg.id)}>✓</button>
                    <button type="button" className="chat-edit-cancel" onClick={cancelEdit}>✕</button>
                  </div>
                ) : (
                  <>
                    {msg.text && <div className="chat-msg-text">{renderMessageText(msg.text, profiles)}</div>}
                    {isMine && editable && (
                      <div className="chat-msg-actions">
                        {msg.text && <button type="button" onClick={() => startEdit(msg)}>edit</button>}
                        <button type="button" onClick={() => deleteMsg(msg.id)}>delete</button>
                      </div>
                    )}
                  </>
                )}
                <div className="chat-msg-footer">
                  <span className="chat-msg-time">{relativeTime(msg.created_at)}</span>
                  {user && !msg.id.startsWith('temp-') && (
                    <button
                      type="button"
                      className="chat-react-btn"
                      onClick={() => setReactPickerMsgId(reactPickerMsgId === msg.id ? null : msg.id)}
                    >
                      +
                    </button>
                  )}
                </div>
                {reactPickerMsgId === msg.id && (
                  <div className="chat-react-picker">
                    {REACTION_EMOJIS.map(e => (
                      <button
                        key={e}
                        type="button"
                        className="chat-react-emoji"
                        onClick={() => toggleReaction(msg.id, e)}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
                {(() => {
                  const grouped = getReactions(msg.id);
                  const entries = Object.entries(grouped);
                  if (entries.length === 0) return null;
                  return (
                    <div className="chat-reactions">
                      {entries.map(([emoji, { count, mine, names }]) => (
                        <button
                          key={emoji}
                          type="button"
                          className={`chat-reaction-pill ${mine ? 'chat-reaction-mine' : ''}`}
                          onClick={() => toggleReaction(msg.id, emoji)}
                          title={names.join(', ')}
                        >
                          {emoji} {count}
                        </button>
                      ))}
                    </div>
                  );
                })()}
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
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="chat-file-input"
              onChange={handleImageSelect}
            />
            <button
              type="button"
              className="chat-image-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              aria-label="Send image"
            >
              {uploading ? '…' : '📷'}
            </button>
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
              disabled={sending || !inputText.trim() || uploading}
              aria-label="Send message"
            >
              ↑
            </button>
          </div>
        )}
      </div>
      {lightboxUrl && (
        <div className="chat-lightbox" onClick={() => setLightboxUrl(null)}>
          <img src={lightboxUrl} alt="Full size" onClick={e => e.stopPropagation()} />
          <button type="button" className="chat-lightbox-close" onClick={() => setLightboxUrl(null)}>×</button>
        </div>
      )}
    </section>
  );
}
