import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  ArrowLeft, Loader2, Monitor, MapPin, Users, DollarSign, FileText, Beaker, Presentation, Laptop, Wrench, Check, Building
} from 'lucide-react';

const resourceTypes = [
  { value: 'lab', label: 'Laboratory', icon: Beaker, color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
  { value: 'lecture_hall', label: 'Lecture Hall', icon: Presentation, color: 'var(--color-success)', bg: 'var(--color-success-light)' },
  { value: 'equipment', label: 'Equipment', icon: Laptop, color: 'var(--color-warning)', bg: 'var(--color-warning-light)' },
  { value: 'meeting_room', label: 'Meeting Room', icon: Monitor, color: 'var(--color-info)', bg: 'var(--color-info-light)' },
  { value: 'other', label: 'Other', icon: Wrench, color: 'var(--color-text-muted)', bg: 'var(--color-bg-glass)' },
];

export function NewResourcePage() {
  const [name, setName] = useState('');
  const [resourceType, setResourceType] = useState('');

  const [capacity, setCapacity] = useState('');
  const [location, setLocation] = useState('');
  const [equipmentFeatures, setEquipmentFeatures] = useState('');
  const [hourlyCost, setHourlyCost] = useState('');
  const [loading, setLoading] = useState(false);
  const [tenants, setTenants] = useState<any[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('none');
  const navigate = useNavigate();
  const { toast } = useToast();
  const { claims } = useAuth();

  useEffect(() => {
    if (claims?.app_role === 'main_admin') {
      api.get<any[]>('/tenants').then(res => {
        if (res.success && Array.isArray(res.data)) {
          setTenants(res.data);
        }
      });
    }
  }, [claims]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || !resourceType) {
      toast('warning', 'Name and resource type are required');
      return;
    }

    setLoading(true);
    
    let computedCategory = 'HALL';
    if (resourceType === 'lab') computedCategory = 'LAB';
    else if (resourceType === 'equipment' || resourceType === 'other') computedCategory = 'EQUIPMENT';

    const payload: any = {
      name,
      resource_type: resourceType,
      category: computedCategory,
      capacity: capacity ? parseInt(capacity) : undefined,
      location: location || undefined,
      equipment_features: equipmentFeatures ? equipmentFeatures.split(',').map(s => s.trim()) : undefined,
      hourly_cost: hourlyCost ? parseFloat(hourlyCost) : undefined,
    };

    if (claims?.app_role === 'main_admin') {
      payload.tenant_id = selectedTenant === 'none' ? null : selectedTenant;
    }

    const res = await api.post('/resources', payload);

    if (res.success) {
      toast('success', 'Resource created successfully!');
      navigate('/resources');
    } else {
      toast('error', res.error?.message || 'Failed to create resource');
    }
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <button className="btn btn-ghost" onClick={() => navigate('/resources')} style={{ marginBottom: 'var(--space-4)' }}>
        <ArrowLeft size={18} /> Back to Resources
      </button>

      <div className="card" style={{ padding: 'var(--space-8)' }}>
        <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>Add New Resource</h2>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-8)', fontSize: 'var(--font-size-sm)' }}>
          Create a new bookable resource for your faculty
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          {/* Resource Type Selection */}
          <div>
            <label className="input-label" style={{ marginBottom: 'var(--space-3)', display: 'block' }}>Resource Type *</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)' }}>
              {resourceTypes.map(rt => {
                const Icon = rt.icon;
                const selected = resourceType === rt.value;
                return (
                  <button
                    type="button"
                    key={rt.value}
                    onClick={() => setResourceType(rt.value)}
                    className="card"
                    style={{
                      padding: 'var(--space-4)',
                      cursor: 'pointer',
                      textAlign: 'center',
                      borderColor: selected ? rt.color : undefined,
                      background: selected ? rt.bg : undefined,
                      transition: 'all 200ms ease',
                    }}
                  >
                    <Icon size={24} style={{ color: rt.color, margin: '0 auto 8px' }} />
                    <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>{rt.label}</div>
                    {selected && <Check size={14} style={{ color: rt.color, margin: '4px auto 0' }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name */}
          <div className="input-group">
            <label className="input-label" htmlFor="res-name">Resource Name *</label>
            <div style={{ position: 'relative' }}>
              <Monitor size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input id="res-name" className="input" placeholder="e.g., Computer Lab A" value={name} onChange={e => setName(e.target.value)} required style={{ paddingLeft: 40 }} />
            </div>
          </div>

          {/* Tenant Selection (Main Admin Only) */}
          {claims?.app_role === 'main_admin' && (
            <div className="input-group">
              <label className="input-label" htmlFor="res-tenant">Assigned Faculty / Tenant</label>
              <div style={{ position: 'relative' }}>
                <Building size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', zIndex: 1 }} />
                <select 
                  id="res-tenant" 
                  className="input" 
                  value={selectedTenant} 
                  onChange={e => setSelectedTenant(e.target.value)} 
                  style={{ paddingLeft: 40 }}
                >
                  <option value="none">Campus Wide (No Specific Faculty)</option>
                  {tenants.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}


          {/* Location & Capacity */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <div className="input-group">
              <label className="input-label" htmlFor="res-location">Location</label>
              <div style={{ position: 'relative' }}>
                <MapPin size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input id="res-location" className="input" placeholder="e.g., Block A, Room 201" value={location} onChange={e => setLocation(e.target.value)} style={{ paddingLeft: 40 }} />
              </div>
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="res-capacity">Capacity</label>
              <div style={{ position: 'relative' }}>
                <Users size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input id="res-capacity" className="input" type="number" placeholder="e.g., 40" value={capacity} onChange={e => setCapacity(e.target.value)} style={{ paddingLeft: 40 }} />
              </div>
            </div>
          </div>

          {/* Equipment Features */}
          <div className="input-group">
            <label className="input-label" htmlFor="res-features">Equipment & Features</label>
            <div style={{ position: 'relative' }}>
              <FileText size={18} style={{ position: 'absolute', left: 12, top: 14, color: 'var(--color-text-muted)' }} />
              <textarea id="res-features" className="input" placeholder="Projector, Whiteboard, Air Conditioning (comma-separated)" value={equipmentFeatures} onChange={e => setEquipmentFeatures(e.target.value)} style={{ paddingLeft: 40, minHeight: 80 }} />
            </div>
          </div>

          {/* Hourly Token Cost (Equipment only) */}
          {(resourceType === 'equipment' || resourceType === 'other') && (
            <div className="input-group">
              <label className="input-label" htmlFor="res-cost">🪙 Hourly Token Cost</label>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
                Students will spend this many tokens per hour when booking this equipment
              </p>
              <div style={{ position: 'relative' }}>
                <DollarSign size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input id="res-cost" className="input" type="number" step="1" min="0" placeholder="e.g., 10" value={hourlyCost} onChange={e => setHourlyCost(e.target.value)} style={{ paddingLeft: 40 }} />
              </div>
            </div>
          )}

          {/* Submit */}
          <button className="btn btn-primary btn-lg btn-full" type="submit" disabled={loading} style={{ marginTop: 'var(--space-2)' }}>
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Monitor size={18} />}
            {loading ? 'Creating...' : 'Create Resource'}
          </button>
        </form>
      </div>
    </div>
  );
}
