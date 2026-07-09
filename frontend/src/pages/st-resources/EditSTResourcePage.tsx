import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { ArrowLeft, Loader2, BookOpen, MapPin, FileText, DollarSign, Save } from 'lucide-react';

const conditions = [
  { value: 'excellent', label: 'Excellent', color: '#16a34a' },
  { value: 'good', label: 'Good', color: '#2563eb' },
  { value: 'fair', label: 'Fair', color: '#d97706' },
  { value: 'poor', label: 'Poor', color: '#dc2626' },
];

export function EditSTResourcePage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [condition, setCondition] = useState('good');
  const [pickupLocation, setPickupLocation] = useState('');
  const [hourlyTokenCost, setHourlyTokenCost] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    api.get<any>(`/st-resources/${id}`).then(res => {
      if (res.success && res.data) {
        setName(res.data.name || '');
        setDescription(res.data.description || '');
        setCondition(res.data.condition || 'good');
        setPickupLocation(res.data.pickup_location || '');
        setHourlyTokenCost(res.data.hourly_token_cost?.toString() || '0');
      } else {
        toast('error', 'Resource not found');
        navigate('/st-resources');
      }
    }).finally(() => setFetching(false));
  }, [id]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast('warning', 'Please enter a resource name');
      return;
    }

    setLoading(true);
    const res = await api.put(`/st-resources/${id}`, {
      name: name.trim(),
      description: description.trim() || null,
      condition,
      pickup_location: pickupLocation.trim() || null,
      hourly_token_cost: hourlyTokenCost ? parseInt(hourlyTokenCost) : 0,
    });

    if (res.success) {
      toast('success', 'Resource updated!');
      navigate('/st-resources');
    } else {
      toast('error', res.error?.message || 'Failed to update');
    }
    setLoading(false);
  };

  if (fetching) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: 'var(--space-8)', textAlign: 'center' }}>
        <div className="spinner spinner-lg" />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <button className="btn btn-ghost" onClick={() => navigate('/st-resources')} style={{ marginBottom: 'var(--space-4)' }}>
        <ArrowLeft size={18} /> Back to ST Resources
      </button>

      <div className="card form-card" style={{ borderTop: '4px solid #a855f7' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
          <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: '#f3e8ff', color: '#a855f7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Save size={24} />
          </div>
          <div>
            <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>Edit Resource</h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>Update your shared item details</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', marginTop: 'var(--space-6)' }}>
          {/* Name */}
          <div className="input-group">
            <label className="input-label" htmlFor="st-name">Item Name *</label>
            <div style={{ position: 'relative' }}>
              <BookOpen size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input id="st-name" className="input" placeholder="e.g., Data Structures Notebook" value={name} onChange={e => setName(e.target.value)} required style={{ paddingLeft: 40 }} />
            </div>
          </div>

          {/* Condition */}
          <div>
            <label className="input-label" style={{ marginBottom: 'var(--space-3)', display: 'block' }}>Condition</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {conditions.map(c => (
                <button
                  type="button"
                  key={c.value}
                  onClick={() => setCondition(c.value)}
                  className="btn"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    background: condition === c.value ? c.color : 'var(--color-bg-glass)',
                    color: condition === c.value ? 'white' : c.color,
                    border: `1px solid ${condition === c.value ? c.color : 'transparent'}`,
                    fontWeight: 600,
                    fontSize: 'var(--font-size-sm)',
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Location */}
          <div className="input-group">
            <label className="input-label" htmlFor="st-location">Pickup Location</label>
            <div style={{ position: 'relative' }}>
              <MapPin size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input id="st-location" className="input" placeholder="e.g., Library, Block C lobby" value={pickupLocation} onChange={e => setPickupLocation(e.target.value)} style={{ paddingLeft: 40 }} />
            </div>
          </div>

          {/* Description */}
          <div className="input-group">
            <label className="input-label" htmlFor="st-desc">Description</label>
            <div style={{ position: 'relative' }}>
              <FileText size={18} style={{ position: 'absolute', left: 12, top: 14, color: 'var(--color-text-muted)' }} />
              <textarea id="st-desc" className="input" placeholder="Describe condition, edition, or any details" value={description} onChange={e => setDescription(e.target.value)} style={{ paddingLeft: 40, minHeight: 80 }} />
            </div>
          </div>

          {/* Token Cost */}
          <div className="input-group">
            <label className="input-label" htmlFor="st-cost">Hourly Token Cost</label>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
              Set 0 or leave empty for free borrowing
            </p>
            <div style={{ position: 'relative' }}>
              <DollarSign size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input id="st-cost" className="input" type="number" step="1" min="0" placeholder="e.g., 5 (0 = free)" value={hourlyTokenCost} onChange={e => setHourlyTokenCost(e.target.value)} style={{ paddingLeft: 40 }} />
            </div>
          </div>

          <button className="btn btn-lg btn-full" type="submit" disabled={loading} style={{ marginTop: 'var(--space-2)', background: '#a855f7', color: 'white', border: 'none' }}>
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {loading ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  );
}
