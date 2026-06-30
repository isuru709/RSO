import { useLocation, useNavigate, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Bell, Moon, Sun, LogOut, ChevronDown } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/resources': 'Resources',
  '/bookings': 'Bookings',
  '/notifications': 'Notifications',
  '/profile': 'Profile',
  '/admin/users': 'User Management',
  '/admin/tenants': 'Tenant Management',
};

export function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const title = pageTitles[location.pathname] || 'CampusRSO';

  useEffect(() => {
    const stored = localStorage.getItem('theme') as 'dark' | 'light' | null;
    if (stored) {
      setTheme(stored);
      document.documentElement.setAttribute('data-theme', stored);
    }
  }, []);

  useEffect(() => {
    const fetchUnread = () => {
      api.get<{ unread_count: number }>('/notifications/unread-count').then(res => {
        if (res.success && res.data) {
          setUnread(typeof res.data === 'number' ? res.data : (res.data as any).unread_count || 0);
        }
      }).catch(() => {});
    };

    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);

    // Listen for custom event from NotificationPage
    const handleNotificationUpdate = () => fetchUnread();
    window.addEventListener('notifications_updated', handleNotificationUpdate);

    return () => {
      clearInterval(interval);
      window.removeEventListener('notifications_updated', handleNotificationUpdate);
    };
  }, []);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
  };

  const handleLogout = async () => {
    await logout();
    toast('success', 'Logged out successfully');
    navigate('/login');
  };

  const initials = user?.displayName
    ? user.displayName.split(' ').map(n => n[0]).join('').toUpperCase()
    : user?.email?.[0]?.toUpperCase() || '?';

  return (
    <header className="topbar">
      <h1 className="topbar-title">{title}</h1>
      <div className="topbar-spacer" />

      <div className="topbar-actions">
        <button className="btn-icon btn-ghost" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>

        <NavLink to="/notifications" className="notification-bell" aria-label="Notifications">
          <Bell size={20} />
          {unread > 0 && <span className="notification-bell-badge">{unread > 9 ? '9+' : unread}</span>}
        </NavLink>

        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            className="btn-ghost"
            onClick={() => setMenuOpen(!menuOpen)}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', borderRadius: 'var(--radius-md)' }}
          >
            <div className="avatar avatar-sm">{initials}</div>
            <ChevronDown size={14} style={{ transition: 'transform 200ms', transform: menuOpen ? 'rotate(180deg)' : 'none' }} />
          </button>

          {menuOpen && (
            <div style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: '8px',
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              minWidth: '200px',
              padding: '8px',
              animation: 'fadeInDown 200ms ease forwards',
              zIndex: 'var(--z-dropdown)',
            }}>
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border)', marginBottom: '4px' }}>
                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{user?.displayName || 'User'}</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{user?.email}</div>
              </div>
              <NavLink to="/profile" className="nav-item" onClick={() => setMenuOpen(false)} style={{ fontSize: 'var(--font-size-sm)' }}>
                Profile & Settings
              </NavLink>
              <button
                className="nav-item"
                onClick={handleLogout}
                style={{ width: '100%', fontSize: 'var(--font-size-sm)', color: 'var(--color-danger)' }}
              >
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
