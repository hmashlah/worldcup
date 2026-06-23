import { useState, useRef, useEffect, useMemo } from 'react';
import { useNotifications, useNotificationRealtime, useMarkAllRead } from '@/hooks/useNotifications';
import { useUI } from '@/lib/ui-store';
import { relativeTime } from '@/lib/utils';

export function NotificationBell() {
  const notificationsQ = useNotifications();
  const { unreadFlash } = useNotificationRealtime();
  const markAllRead = useMarkAllRead();
  const setTab = useUI(s => s.setTab);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const notifications = notificationsQ.data ?? [];
  const unreadCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleBellClick = () => {
    setOpen(o => !o);
    if (!open && unreadCount > 0) {
      markAllRead.mutate();
    }
  };

  const handleNotificationClick = () => {
    setTab('chat');
    setOpen(false);
  };

  return (
    <div className="notif-bell-wrapper" ref={dropdownRef}>
      <button
        type="button"
        className={`notif-bell ${unreadFlash ? 'notif-bell-flash' : ''}`}
        onClick={handleBellClick}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 13a2 2 0 0 0 4 0" />
          <path d="M12.3 10c-.5-.7-.8-1.6-.8-3V6a3.5 3.5 0 0 0-7 0v1c0 1.4-.3 2.3-.8 3H12.3z" />
        </svg>
        {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-header">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button type="button" className="notif-mark-read" onClick={() => markAllRead.mutate()}>
                Mark all read
              </button>
            )}
          </div>
          <div className="notif-dropdown-list">
            {notifications.length === 0 && (
              <p className="notif-empty">No notifications yet</p>
            )}
            {notifications.slice(0, 20).map(n => (
              <button
                key={n.id}
                type="button"
                className={`notif-item ${n.read ? '' : 'notif-item-unread'}`}
                onClick={() => handleNotificationClick()}
              >
                <span className="notif-item-text">{n.text}</span>
                <span className="notif-item-time">{relativeTime(n.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
