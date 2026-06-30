import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { Bell, Check, CheckCheck, Trash2, Mail, CalendarDays, Info } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

const typeIcons: Record<string, any> = {
  booking_created: CalendarDays,
  booking_approved: Check,
  booking_rejected: Info,
  booking_cancelled: Trash2,
  email: Mail,
};

export function NotificationPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const load = () => {
    api.get<Notification[]>('/notifications').then(res => {
      setNotifications(Array.isArray(res.data) ? res.data : []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const markRead = async (id: string) => {
    await api.put(`/notifications/${id}/read`);
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    window.dispatchEvent(new Event('notifications_updated'));
  };

  const markAllRead = async () => {
    await api.put('/notifications/read-all');
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    toast('success', 'All notifications marked as read');
    window.dispatchEvent(new Event('notifications_updated'));
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  if (loading) {
    return (
      <div>
        <div className="page-header"><div className="skeleton skeleton-title" style={{ width: 200 }} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[1,2,3].map(i => <div key={i} className="card skeleton" style={{ height: 72 }} />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Notifications</h2>
          <p className="page-subtitle">{unreadCount} unread</p>
        </div>
        {unreadCount > 0 && (
          <button className="btn btn-secondary" onClick={markAllRead}>
            <CheckCheck size={16} /> Mark All Read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="card empty-state">
          <Bell size={40} className="empty-state-icon" />
          <p className="empty-state-title">No notifications</p>
          <p>You're all caught up!</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }} className="stagger">
          {notifications.map(n => {
            const Icon = typeIcons[n.type] || Bell;
            return (
              <div
                key={n.id}
                className="card"
                onClick={() => !n.is_read && markRead(n.id)}
                style={{
                  padding: 'var(--space-4) var(--space-5)',
                  cursor: n.is_read ? 'default' : 'pointer',
                  borderLeft: n.is_read ? undefined : '3px solid var(--color-primary)',
                  opacity: n.is_read ? 0.7 : 1,
                }}
              >
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 'var(--radius-full)',
                    background: n.is_read ? 'var(--color-bg-glass)' : 'var(--color-primary-light)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: n.is_read ? 'var(--color-text-muted)' : 'var(--color-primary)',
                    flexShrink: 0,
                  }}>
                    <Icon size={16} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: n.is_read ? 400 : 600, fontSize: 'var(--font-size-sm)' }}>{n.title || n.type}</div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 2 }}>{n.body}</div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                    </div>
                  </div>
                  {!n.is_read && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-primary)', flexShrink: 0, marginTop: 6 }} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
