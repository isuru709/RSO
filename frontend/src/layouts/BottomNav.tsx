import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard, Monitor, CalendarDays, BookOpen, User,
  Users, Building2, MoreHorizontal, Bell, HandCoins, X,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

export function BottomNav() {
  const { claims } = useAuth();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const isAdmin = claims?.app_role === 'main_admin' || claims?.app_role === 'tenant_admin';
  const isMainAdmin = claims?.app_role === 'main_admin';

  // Close "More" menu on route change
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    if (moreOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [moreOpen]);

  // Build "more" menu items based on role
  const moreItems: { to: string; icon: any; label: string }[] = [
    { to: '/notifications', icon: Bell, label: 'Notifications' },
    { to: '/st-resources/borrows', icon: HandCoins, label: 'ST Borrows' },
  ];

  if (isAdmin) {
    moreItems.push({ to: '/admin/users', icon: Users, label: 'Users' });
  }
  if (isMainAdmin) {
    moreItems.push({ to: '/admin/tenants', icon: Building2, label: 'Tenants' });
  }

  // Check if any "more" item is currently active
  const moreActive = moreItems.some(item => location.pathname.startsWith(item.to));

  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <LayoutDashboard size={20} />
        <span>Home</span>
      </NavLink>
      <NavLink to="/resources" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <Monitor size={20} />
        <span>Resources</span>
      </NavLink>
      <NavLink to="/st-resources" end className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <BookOpen size={20} />
        <span>ST Share</span>
      </NavLink>
      <NavLink to="/bookings" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <CalendarDays size={20} />
        <span>Bookings</span>
      </NavLink>

      {/* "More" menu for admin + extra links */}
      <div ref={moreRef} style={{ position: 'relative' }}>
        <button
          className={`bottom-nav-item ${moreActive ? 'active' : ''}`}
          onClick={() => setMoreOpen(!moreOpen)}
          style={{ background: 'none', border: 'none', cursor: 'pointer' }}
        >
          {moreOpen ? <X size={20} /> : <MoreHorizontal size={20} />}
          <span>More</span>
        </button>

        {moreOpen && (
          <>
            {/* Backdrop */}
            <div
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.3)',
                zIndex: 1,
              }}
              onClick={() => setMoreOpen(false)}
            />
            {/* Menu */}
            <div style={{
              position: 'absolute',
              bottom: 'calc(100% + 8px)',
              right: 0,
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: 'var(--shadow-lg)',
              padding: 'var(--space-2)',
              minWidth: '180px',
              animation: 'fadeIn 150ms ease forwards',
              zIndex: 2,
            }}>
              {moreItems.map(item => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setMoreOpen(false)}
                  style={{ fontSize: 'var(--font-size-sm)', padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', borderRadius: 'var(--radius-md)', textDecoration: 'none' }}
                >
                  <item.icon size={18} />
                  {item.label}
                </NavLink>
              ))}

              {/* Profile link in More */}
              <div style={{ borderTop: '1px solid var(--color-border)', margin: 'var(--space-1) 0' }} />
              <NavLink
                to="/profile"
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                onClick={() => setMoreOpen(false)}
                style={{ fontSize: 'var(--font-size-sm)', padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', borderRadius: 'var(--radius-md)', textDecoration: 'none' }}
              >
                <User size={18} />
                Profile
              </NavLink>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}
