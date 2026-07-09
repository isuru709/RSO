import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { ArrowLeft, CalendarDays, Clock, User, Phone, Mail, IdCard, Edit2, X } from 'lucide-react';
import { format } from 'date-fns';

export function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [booking, setBooking] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { claims } = useAuth();
  const { toast } = useToast();
  const isAdmin = claims?.app_role === 'main_admin' || claims?.app_role === 'tenant_admin';

  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', purpose: '', start_time: '', end_time: '' });

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await api.put('/bookings/' + id, editForm);
    if (res.success) {
      toast('success', 'Booking updated');
      setBooking(res.data);
      setShowEdit(false);
    } else {
      toast('error', res.error?.message || 'Failed to update');
    }
  };

  useEffect(() => {
    api.get<any>('/bookings/' + id)
      .then(res => {
        setBooking(res.data);
        if (res.data) {
          setEditForm({
            title: res.data.title,
            purpose: res.data.purpose || '',
            start_time: res.data.start_time.substring(0, 16),
            end_time: res.data.end_time.substring(0, 16),
          });
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ padding: 'var(--space-8)' }}>Loading...</div>;
  if (!booking) return <div style={{ padding: 'var(--space-8)' }}>Booking not found</div>;

  const resourceName = booking.resource?.name || booking.resources?.name || 'Unknown Resource';

  return (
    <div>
      <button className="btn btn-ghost btn-sm" style={{ marginBottom: 'var(--space-4)' }} onClick={() => navigate(-1)}>
        <ArrowLeft size={18} /> Back
      </button>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, wordBreak: 'break-word' }}>{booking.title}</h2>
          {isAdmin && (
            <button className="btn btn-outline btn-sm" onClick={() => setShowEdit(true)}>
              <Edit2 size={16} /> Edit Booking
            </button>
          )}
        </div>
        <div className="grid-2-col" style={{ marginBottom: 'var(--space-6)' }}>
          <div>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 4 }}>Resource</p>
            <p style={{ fontWeight: 600, fontSize: 'var(--font-size-lg)' }}>{resourceName}</p>
          </div>
          <div>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 4 }}>Status</p>
            <span className="badge badge-info">{booking.status}</span>
          </div>
        </div>
        <div className="grid-2-col" style={{ marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <CalendarDays size={20} style={{ color: 'var(--color-text-muted)' }} />
            <div>
              <p style={{ color: 'var(--color-text-secondary)' }}>Date</p>
              <p>{format(new Date(booking.start_time), 'MMMM d, yyyy')}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <Clock size={20} style={{ color: 'var(--color-text-muted)' }} />
            <div>
              <p style={{ color: 'var(--color-text-secondary)' }}>Time</p>
              <p>{format(new Date(booking.start_time), 'h:mm a')} - {format(new Date(booking.end_time), 'h:mm a')}</p>
            </div>
          </div>
        </div>
        {booking.purpose && (
          <div style={{ marginBottom: 'var(--space-6)' }}>
            <p style={{ color: 'var(--color-text-secondary)', marginBottom: 4 }}>Purpose</p>
            <p style={{ background: 'var(--color-bg-glass)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)' }}>{booking.purpose}</p>
          </div>
        )}

        {isAdmin && booking.user && (
          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-6)', marginTop: 'var(--space-6)' }}>
            <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>Booked By</h3>
            <div className="grid-2-col">
              <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <User size={16} style={{ color: 'var(--color-text-muted)' }} />
                <span>{booking.user.full_name || 'Unknown'}</span>
              </div>
              {booking.user.email && (
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <Mail size={16} style={{ color: 'var(--color-text-muted)' }} />
                  <span>{booking.user.email}</span>
                </div>
              )}
              {booking.user.phone && (
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <Phone size={16} style={{ color: 'var(--color-text-muted)' }} />
                  <span>{booking.user.phone}</span>
                </div>
              )}
              {booking.user.member_id && (
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                  <IdCard size={16} style={{ color: 'var(--color-text-muted)' }} />
                  <span>{booking.user.member_id}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showEdit && (
        <div className="modal-overlay" onClick={() => setShowEdit(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Edit Booking</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowEdit(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleEditSubmit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div>
                <label className="label">Title</label>
                <input className="input" value={editForm.title} onChange={e => setEditForm({...editForm, title: e.target.value})} required />
              </div>
              <div className="grid-2-col">
                <div>
                  <label className="label">Start Time</label>
                  <input type="datetime-local" className="input" value={editForm.start_time} onChange={e => setEditForm({...editForm, start_time: e.target.value})} required />
                </div>
                <div>
                  <label className="label">End Time</label>
                  <input type="datetime-local" className="input" value={editForm.end_time} onChange={e => setEditForm({...editForm, end_time: e.target.value})} required />
                </div>
              </div>
              <div>
                <label className="label">Purpose</label>
                <textarea className="input" style={{ minHeight: 100 }} value={editForm.purpose} onChange={e => setEditForm({...editForm, purpose: e.target.value})} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowEdit(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
