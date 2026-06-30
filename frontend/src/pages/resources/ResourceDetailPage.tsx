import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { format } from 'date-fns';
import {
  ArrowLeft, MapPin, Users, Monitor, CalendarDays, Clock, Edit3, Trash2, Save, X,
  Beaker, Presentation, Laptop, Wrench, DollarSign, CheckCircle2, XCircle, Loader2,
} from 'lucide-react';

interface Resource {
  id: string;
  name: string;
  resource_type: string;
  category?: string;
  capacity: number;
  location: string;
  status: string;
  equipment_features?: string[];
  hourly_cost?: number;
  is_bookable: boolean;
  created_at: string;
  description?: string;
}

interface AvailabilityBooking {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  status: string;
}

const typeIcons: Record<string, any> = { lab: Beaker, lecture_hall: Presentation, equipment: Laptop, meeting_room: Monitor, other: Wrench };
const typeColors: Record<string, { color: string; bg: string }> = {
  lab: { color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
  lecture_hall: { color: 'var(--color-success)', bg: 'var(--color-success-light)' },
  equipment: { color: 'var(--color-warning)', bg: 'var(--color-warning-light)' },
  meeting_room: { color: 'var(--color-info)', bg: 'var(--color-info-light)' },
  other: { color: 'var(--color-text-muted)', bg: 'var(--color-bg-glass)' },
};

export function ResourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { claims } = useAuth();
  const { toast } = useToast();
  const isAdmin = claims.app_role === 'super_admin' || claims.app_role === 'tenant_admin';

  const [resource, setResource] = useState<Resource | null>(null);
  const [todayBookings, setTodayBookings] = useState<AvailabilityBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editCapacity, setEditCapacity] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editCost, setEditCost] = useState('');

  useEffect(() => {
    if (!id) return;

    Promise.all([
      api.get<Resource>(`/resources/${id}`),
      api.get<{ bookings: AvailabilityBooking[] }>(`/resources/${id}/availability`),
    ]).then(([resRes, availRes]) => {
      if (resRes.success && resRes.data) {
        const r = resRes.data as Resource;
        setResource(r);
        setEditName(r.name);
        setEditLocation(r.location || '');
        setEditCapacity(r.capacity?.toString() || '');
        setEditCategory(r.category || '');
        setEditCost(r.hourly_cost?.toString() || '');
      } else {
        toast('error', 'Resource not found');
        navigate('/resources');
      }

      if (availRes.success && availRes.data) {
        const d = availRes.data as any;
        setTodayBookings(Array.isArray(d.bookings) ? d.bookings : []);
      }
    }).finally(() => setLoading(false));
  }, [id]);

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);

    const res = await api.put(`/resources/${id}`, {
      name: editName,
      location: editLocation || undefined,
      capacity: editCapacity ? parseInt(editCapacity) : undefined,
      category: editCategory || undefined,
      hourly_cost: editCost ? parseFloat(editCost) : undefined,
    });

    if (res.success && res.data) {
      setResource(res.data as Resource);
      setEditing(false);
      toast('success', 'Resource updated');
    } else {
      toast('error', res.error?.message || 'Failed to update');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!id || !confirm('Are you sure you want to retire this resource?')) return;

    const res = await api.delete(`/resources/${id}`);
    if (res.success) {
      toast('success', 'Resource retired');
      navigate('/resources');
    } else {
      toast('error', res.error?.message || 'Failed to retire');
    }
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        <div className="skeleton skeleton-title" style={{ width: 200, marginBottom: 'var(--space-6)' }} />
        <div className="card skeleton-card" style={{ height: 300 }} />
      </div>
    );
  }

  if (!resource) return null;

  const Icon = typeIcons[resource.resource_type] || Monitor;
  const colors = typeColors[resource.resource_type] || typeColors.other;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <button className="btn btn-ghost" onClick={() => navigate('/resources')} style={{ marginBottom: 'var(--space-4)' }}>
        <ArrowLeft size={18} /> Back to Resources
      </button>

      {/* Resource Header Card */}
      <div className="card" style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-5)', flexWrap: 'wrap' }}>
          <div style={{
            width: 64, height: 64, borderRadius: 'var(--radius-lg)',
            background: colors.bg, color: colors.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Icon size={28} />
          </div>

          <div style={{ flex: 1, minWidth: 200 }}>
            {editing ? (
              <input className="input" value={editName} onChange={e => setEditName(e.target.value)} style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }} />
            ) : (
              <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>{resource.name}</h2>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={`badge ${resource.status === 'available' ? 'badge-success' : 'badge-neutral'}`}>{resource.status}</span>
              <span className="badge badge-primary">{resource.resource_type}</span>
              {resource.is_bookable ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--color-success)' }}>
                  <CheckCircle2 size={12} /> Bookable
                </span>
              ) : (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--font-size-xs)', color: 'var(--color-danger)' }}>
                  <XCircle size={12} /> Not Bookable
                </span>
              )}
            </div>
          </div>

          {isAdmin && (
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {editing ? (
                <>
                  <button className="btn btn-success btn-sm" onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                    <X size={14} /> Cancel
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
                    <Edit3 size={14} /> Edit
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={handleDelete}>
                    <Trash2 size={14} /> Retire
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-6)' }}>
        {/* Details Card */}
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 'var(--space-5)' }}>Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-5)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-bg-glass)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MapPin size={18} style={{ color: 'var(--color-text-muted)' }} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Location</div>
                {editing ? (
                  <input className="input" value={editLocation} onChange={e => setEditLocation(e.target.value)} style={{ padding: '4px 8px', fontSize: 'var(--font-size-sm)' }} />
                ) : (
                  <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{resource.location || '—'}</div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-bg-glass)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users size={18} style={{ color: 'var(--color-text-muted)' }} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Capacity</div>
                {editing ? (
                  <input className="input" type="number" value={editCapacity} onChange={e => setEditCapacity(e.target.value)} style={{ padding: '4px 8px', fontSize: 'var(--font-size-sm)', width: 80 }} />
                ) : (
                  <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{resource.capacity || '—'} seats</div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-bg-glass)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <DollarSign size={18} style={{ color: 'var(--color-text-muted)' }} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Hourly Cost</div>
                {editing ? (
                  <input className="input" type="number" step="0.01" value={editCost} onChange={e => setEditCost(e.target.value)} style={{ padding: '4px 8px', fontSize: 'var(--font-size-sm)', width: 80 }} />
                ) : (
                  <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{resource.hourly_cost ? `$${resource.hourly_cost}` : 'Free'}</div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: 'var(--color-bg-glass)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CalendarDays size={18} style={{ color: 'var(--color-text-muted)' }} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>Created</div>
                <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{format(new Date(resource.created_at), 'MMM d, yyyy')}</div>
              </div>
            </div>
          </div>

          {/* Equipment Features */}
          {resource.equipment_features && resource.equipment_features.length > 0 && (
            <div style={{ marginTop: 'var(--space-5)', paddingTop: 'var(--space-5)', borderTop: '1px solid var(--color-border)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>Equipment & Features</div>
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                {resource.equipment_features.map((f, i) => (
                  <span key={i} className="badge badge-neutral">{f}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Today's Bookings */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Today's Schedule</h3>
            <button className="btn btn-primary btn-sm" onClick={() => navigate(`/bookings/new?resource=${id}`)}>
              <CalendarDays size={14} /> Book Now
            </button>
          </div>

          {todayBookings.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--space-8)' }}>
              <CalendarDays size={32} className="empty-state-icon" />
              <p className="empty-state-title">No bookings today</p>
              <p style={{ fontSize: 'var(--font-size-sm)' }}>This resource is available all day</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {todayBookings.map(b => (
                <div key={b.id} style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                  padding: 'var(--space-3) var(--space-4)',
                  background: 'var(--color-bg-glass)', borderRadius: 'var(--radius-md)',
                }}>
                  <Clock size={14} style={{ color: 'var(--color-text-muted)' }} />
                  <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>
                    {format(new Date(b.start_time), 'h:mm a')} – {format(new Date(b.end_time), 'h:mm a')}
                  </span>
                  <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', flex: 1 }}>{b.title}</span>
                  <span className={`badge ${b.status === 'approved' ? 'badge-success' : 'badge-warning'}`}>{b.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
