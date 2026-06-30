import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { format } from 'date-fns';
import {
  Search, Plus, Clock, Check, X as XIcon, Ban, CalendarDays
} from 'lucide-react';

interface Booking {
  id: string;
  title: string;
  purpose?: string;
  status: string;
  start_time: string;
  end_time: string;
  attendee_count?: number;
  resource?: { name: string };
  resources?: { name: string };
  resource_id: string;
  created_at: string;
}

const statusConfig: Record<string, { class: string; label: string }> = {
  pending: { class: 'badge-warning', label: 'Pending' },
  approved: { class: 'badge-info', label: 'Approved' },
  active: { class: 'badge-success', label: 'Active' },
  completed: { class: 'badge-neutral', label: 'Completed' },
  rejected: { class: 'badge-danger', label: 'Rejected' },
  cancelled: { class: 'badge-neutral', label: 'Cancelled' },
  bumped: { class: 'badge-warning', label: 'Bumped' },
};

export function BookingListPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { claims } = useAuth();
  const { toast } = useToast();
  const isAdmin = claims?.app_role === 'main_admin' || claims?.app_role === 'tenant_admin';

  const loadBookings = async () => {
    // Auto-transition booking statuses (approved→active, active→completed)
    try {
      await api.post('/bookings/transitions');
    } catch { /* non-critical */ }

    const params = isAdmin ? '' : '?my_bookings=true';
    api.get<Booking[]>(`/bookings${params}`).then(res => {
      setBookings(Array.isArray(res.data) ? res.data : []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { loadBookings(); }, []);

  const handleAction = async (id: string, action: 'approve' | 'reject' | 'cancel') => {
    const res = await api.put(`/bookings/${id}/${action}`);
    if (res.success) {
      toast('success', `Booking ${action}d successfully`);
      loadBookings();
    } else {
      toast('error', res.error?.message || `Failed to ${action}`);
    }
  };

  const filtered = bookings.filter(b => {
    const matchFilter = filter === 'all' || b.status === filter;
    const matchSearch = b.title.toLowerCase().includes(search.toLowerCase()) ||
      (b.resource?.name || b.resources?.name || '').toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  if (loading) {
    return (
      <div>
        <div className="page-header"><div className="skeleton skeleton-title" style={{ width: 200 }} /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {[1,2,3,4].map(i => <div key={i} className="card skeleton" style={{ height: 80 }} />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Bookings</h2>
          <p className="page-subtitle">{bookings.length} total bookings</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/bookings/new')}>
          <Plus size={18} /> New Booking
        </button>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input className="input" placeholder="Search bookings..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
        </div>
        <div className="tabs">
          {['all', 'pending', 'approved', 'active', 'completed', 'rejected', 'cancelled'].map(s => (
            <button key={s} className={`tab ${filter === s ? 'tab-active' : ''}`} onClick={() => setFilter(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty-state">
          <CalendarDays size={40} className="empty-state-icon" />
          <p className="empty-state-title">No bookings found</p>
          <p>Create your first booking to get started</p>
          <button className="btn btn-primary" onClick={() => navigate('/bookings/new')}>
            <Plus size={16} /> Create Booking
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }} className="stagger">
          {filtered.map(b => {
            const sc = statusConfig[b.status] || statusConfig.pending;
            return (
              <div key={b.id} className="card card-interactive" style={{ padding: 'var(--space-4) var(--space-5)', cursor: 'pointer' }} onClick={() => navigate(`/bookings/${b.id}`)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-1)' }}>
                      <span style={{ fontWeight: 600 }}>{b.title}</span>
                      <span className={`badge ${sc.class}`}>{sc.label}</span>
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><CalendarDays size={12} /> {format(new Date(b.start_time), 'MMM d, yyyy')}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> {format(new Date(b.start_time), 'h:mm a')} – {format(new Date(b.end_time), 'h:mm a')}</span>
                      {(b.resource?.name || b.resources?.name) && <span>{b.resource?.name || b.resources?.name}</span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    {isAdmin && b.status === 'pending' && (
                      <>
                        <button className="btn btn-sm btn-success" onClick={(e) => { e.stopPropagation(); handleAction(b.id, 'approve'); }}>
                          <Check size={14} /> Approve
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); handleAction(b.id, 'reject'); }}>
                          <XIcon size={14} /> Reject
                        </button>
                      </>
                    )}
                    {b.status !== 'cancelled' && b.status !== 'rejected' && (
                      <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); handleAction(b.id, 'cancel'); }}>
                        <Ban size={14} /> Cancel
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
