import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../lib/api';
import {
  Monitor, CalendarDays, Clock, Users, TrendingUp, ArrowRight, Plus,
} from 'lucide-react';
import { format } from 'date-fns';

interface Stats {
  totalResources: number;
  activeBookings: number;
  pendingApprovals: number;
  totalUsers: number;
}

interface Booking {
  id: string;
  title: string;
  status: string;
  start_time: string;
  end_time: string;
  resource?: { name: string };
  resources?: { name: string };
}

export function DashboardPage() {
  const { user, claims } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats>({ totalResources: 0, activeBookings: 0, pendingApprovals: 0, totalUsers: 0 });
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const isAdmin = claims?.app_role === 'main_admin' || claims?.app_role === 'tenant_admin';
        const params = isAdmin ? '' : '?my_bookings=true';

        const [resourcesRes, bookingsRes] = await Promise.all([
          api.get<any[]>('/resources'),
          api.get<any[]>(`/bookings${params}`),
        ]);

        const resources = resourcesRes.data || [];
        const bookings = bookingsRes.data || [];

        setStats({
          totalResources: Array.isArray(resources) ? resources.length : 0,
          activeBookings: Array.isArray(bookings) ? bookings.filter((b: any) => b.status === 'active' || b.status === 'approved').length : 0,
          pendingApprovals: Array.isArray(bookings) ? bookings.filter((b: any) => b.status === 'pending').length : 0,
          totalUsers: 0,
        });

        setRecentBookings(Array.isArray(bookings) ? bookings.slice(0, 5) : []);
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const statCards = [
    { label: 'Total Resources', value: stats.totalResources, icon: Monitor, color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
    { label: 'Active Bookings', value: stats.activeBookings, icon: CalendarDays, color: 'var(--color-success)', bg: 'var(--color-success-light)' },
    { label: 'Pending Approvals', value: stats.pendingApprovals, icon: Clock, color: 'var(--color-warning)', bg: 'var(--color-warning-light)' },
    { label: 'Your Role', value: claims.app_role?.replace('_', ' ') || 'member', icon: Users, color: 'var(--color-info)', bg: 'var(--color-info-light)', isText: true },
  ];

  const statusBadge = (status: string) => {
    const map: Record<string, string> = { pending: 'badge-warning', approved: 'badge-success', rejected: 'badge-danger', cancelled: 'badge-neutral' };
    return <span className={`badge ${map[status] || 'badge-neutral'}`}>{status}</span>;
  };

  if (loading) {
    return (
      <div>
        <div className="page-header">
          <div><div className="skeleton skeleton-title" style={{ width: 250 }} /><div className="skeleton skeleton-text" style={{ width: 180, marginTop: 8 }} /></div>
        </div>
        <div className="grid-stats stagger">
          {[1,2,3,4].map(i => <div key={i} className="card skeleton-card" />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">
            Welcome back, {user?.displayName?.split(' ')[0] || 'there'} 👋
          </h2>
          <p className="page-subtitle">
            Here's what's happening with your campus resources
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/bookings/new')}>
          <Plus size={18} /> New Booking
        </button>
      </div>

      <div className="grid-stats stagger" style={{ marginBottom: 'var(--space-8)' }}>
        {statCards.map((s, i) => (
          <div key={i} className="card stat-card">
            <div className="stat-card-header">
              <span className="stat-card-label">{s.label}</span>
              <div className="stat-card-icon" style={{ background: s.bg, color: s.color }}>
                <s.icon size={20} />
              </div>
            </div>
            <div className="stat-card-value" style={s.isText ? { fontSize: 'var(--font-size-xl)', textTransform: 'capitalize' } : {}}>
              {s.isText ? s.value : s.value}
            </div>
            {!s.isText && (
              <div className="stat-card-change" style={{ color: 'var(--color-success)' }}>
                <TrendingUp size={12} /> Active
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-6)' }}>
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recent Bookings</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/bookings')}>
              View All <ArrowRight size={14} />
            </button>
          </div>

          {recentBookings.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
              <CalendarDays size={40} className="empty-state-icon" />
              <p className="empty-state-title">No bookings yet</p>
              <p>Create your first booking to get started</p>
              <button className="btn btn-primary" onClick={() => navigate('/bookings/new')}>
                <Plus size={16} /> Create Booking
              </button>
            </div>
          ) : (
            <div className="table-wrapper" style={{ border: 'none' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Resource</th>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentBookings.map(b => (
                    <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/bookings/${b.id}`)}>
                      <td style={{ fontWeight: 600 }}>{b.title}</td>
                      <td style={{ color: 'var(--color-text-secondary)' }}>{b.resource?.name || b.resources?.name || '—'}</td>
                      <td>{format(new Date(b.start_time), 'MMM d, yyyy')}</td>
                      <td>{format(new Date(b.start_time), 'h:mm a')} – {format(new Date(b.end_time), 'h:mm a')}</td>
                      <td>{statusBadge(b.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Quick Actions</h3>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
            <button className="card card-interactive" style={{ padding: 'var(--space-5)', textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/resources')}>
              <Monitor size={24} style={{ color: 'var(--color-primary)', marginBottom: 8 }} />
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Browse Resources</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>Find labs, halls & equipment</div>
            </button>
            <button className="card card-interactive" style={{ padding: 'var(--space-5)', textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/bookings/new')}>
              <CalendarDays size={24} style={{ color: 'var(--color-success)', marginBottom: 8 }} />
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>New Booking</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>Reserve a time slot</div>
            </button>
            <button className="card card-interactive" style={{ padding: 'var(--space-5)', textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/notifications')}>
              <Clock size={24} style={{ color: 'var(--color-warning)', marginBottom: 8 }} />
              <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Notifications</div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>Check latest updates</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
