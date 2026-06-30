import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Monitor, Search, Plus, MapPin, Users, Filter, Beaker, Presentation, Laptop, Wrench, Trash2, Edit, PowerOff, Power } from 'lucide-react';

interface Resource {
  id: string;
  name: string;
  resource_type: string;
  capacity: number;
  location: string;
  status: string;
  description?: string;
}

const typeIcons: Record<string, any> = {
  lab: Beaker, lecture_hall: Presentation, equipment: Laptop, meeting_room: Monitor, other: Wrench,
};

const typeColors: Record<string, { color: string; bg: string }> = {
  lab: { color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
  lecture_hall: { color: 'var(--color-success)', bg: 'var(--color-success-light)' },
  equipment: { color: 'var(--color-warning)', bg: 'var(--color-warning-light)' },
  meeting_room: { color: 'var(--color-info)', bg: 'var(--color-info-light)' },
  other: { color: 'var(--color-text-muted)', bg: 'var(--color-bg-glass)' },
};

export function ResourceListPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { claims } = useAuth();
  const isAdmin = claims?.app_role === 'main_admin' || claims?.app_role === 'tenant_admin';

  useEffect(() => {
    api.get<Resource[]>('/resources/').then(res => {
      setResources(Array.isArray(res.data) ? res.data : []);
    }).finally(() => setLoading(false));
  }, []);

  const filtered = resources.filter(r => {
    const matchSearch = r.name.toLowerCase().includes(search.toLowerCase()) ||
      r.location?.toLowerCase().includes(search.toLowerCase());
    const matchType = typeFilter === 'all' || r.resource_type === typeFilter;
    return matchSearch && matchType;
  });

  const types = ['all', 'lab', 'lecture_hall', 'equipment', 'meeting_room', 'other'];

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this resource?')) return;
    try {
      await api.delete(`/resources/${id}`);
      setResources(resources.filter(r => r.id !== id));
    } catch (err) {
      console.error('Failed to delete resource', err);
    }
  };

  const handleToggleStatus = async (e: React.MouseEvent, r: Resource) => {
    e.stopPropagation();
    const newStatus = r.status === 'available' ? 'maintenance' : 'available';
    const newBookable = newStatus === 'available';
    try {
      await api.put(`/resources/${r.id}`, { status: newStatus, is_bookable: newBookable });
      setResources(resources.map(res => res.id === r.id ? { ...res, status: newStatus } : res));
    } catch (err) {
      console.error('Failed to toggle status', err);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="page-header"><div className="skeleton skeleton-title" style={{ width: 200 }} /></div>
        <div className="grid-cards stagger">
          {[1,2,3,4,5,6].map(i => <div key={i} className="card skeleton-card" />)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Resources</h2>
          <p className="page-subtitle">{resources.length} resources available</p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={() => navigate('/resources/new')}>
            <Plus size={18} /> Add Resource
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input className="input" placeholder="Search resources..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
        </div>
        <div className="tabs">
          {types.map(t => (
            <button key={t} className={`tab ${typeFilter === t ? 'tab-active' : ''}`} onClick={() => setTypeFilter(t)}>
              {t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty-state">
          <Filter size={40} className="empty-state-icon" />
          <p className="empty-state-title">No resources found</p>
          <p>Try adjusting your search or filter</p>
        </div>
      ) : (
        <div className="grid-cards stagger">
          {filtered.map(r => {
            const Icon = typeIcons[r.resource_type] || Monitor;
            const colors = typeColors[r.resource_type] || typeColors.other;
            return (
              <div
                key={r.id}
                className="card card-interactive"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/resources/${r.id}`)}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
                  <div style={{ width: 48, height: 48, borderRadius: 'var(--radius-md)', background: colors.bg, color: colors.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon size={24} />
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className={`badge ${r.status === 'available' ? 'badge-success' : 'badge-neutral'}`}>
                      {r.status || 'available'}
                    </span>
                    {isAdmin && (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button 
                          className="btn btn-icon" 
                          style={{ color: 'var(--color-warning)', background: 'var(--color-warning-light)', padding: 6, borderRadius: 'var(--radius-md)' }}
                          onClick={(e) => handleToggleStatus(e, r)}
                          title={r.status === 'available' ? "Temporarily Disable" : "Enable Resource"}
                        >
                          {r.status === 'available' ? <PowerOff size={16} /> : <Power size={16} />}
                        </button>
                        <button 
                          className="btn btn-icon" 
                          style={{ color: 'var(--color-info)', background: 'var(--color-info-light)', padding: 6, borderRadius: 'var(--radius-md)' }}
                          onClick={(e) => { e.stopPropagation(); navigate(`/resources/${r.id}/edit`); }}
                        >
                          <Edit size={16} />
                        </button>
                        <button 
                          className="btn btn-icon" 
                          style={{ color: 'var(--color-danger)', background: 'var(--color-danger-light)', padding: 6, borderRadius: 'var(--radius-md)' }}
                          onClick={(e) => handleDelete(e, r.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>{r.name}</h3>
                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>
                  {r.description || `${r.resource_type.charAt(0).toUpperCase() + r.resource_type.slice(1)} resource`}
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                  {r.location && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={12} /> {r.location}</span>}
                  {r.capacity && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Users size={12} /> {r.capacity} seats</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
