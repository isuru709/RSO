import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { Monitor, Search, Plus, MapPin, Users, Filter, Beaker, Presentation, Laptop, Wrench, Trash2, Edit, PowerOff, Power, BookOpen } from 'lucide-react';

interface Resource {
  id: string;
  name: string;
  resource_type: string;
  category: string;
  capacity: number;
  location: string;
  status: string;
  description?: string;
  created_by?: string;
  hourly_cost?: number;
  image_url?: string;
}

const typeIcons: Record<string, any> = {
  lab: Beaker, lecture_hall: Presentation, equipment: Laptop, meeting_room: Monitor, other: Wrench, student_resource: BookOpen,
};


const typeLabels: Record<string, string> = {
  all: 'All', lab: 'Lab', lecture_hall: 'Lecture Hall', equipment: 'Equipment',
  meeting_room: 'Meeting Room', student_resource: 'ST Resource', other: 'Other',
};

export function ResourceListPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { claims, user } = useAuth();
  const isAdmin = claims?.app_role === 'main_admin' || claims?.app_role === 'tenant_admin';
  const isStudent = claims?.app_role === 'student';
  const isLecturerOrAbove = ['main_admin', 'tenant_admin', 'lecturer', 'junior_lecturer'].includes(claims?.app_role || '');

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

  const types = ['all', 'lab', 'lecture_hall', 'equipment', 'meeting_room', 'student_resource', 'other'];

  // Check if user can manage (edit/disable/delete) a resource
  const canManage = (r: Resource) => {
    if (isAdmin) return true;
    if (r.category === 'ST_RESOURCE') {
      // Owner student
      if (isStudent && r.created_by === user?.uid) return true;
      // Lecturers and jr. lecturers
      if (isLecturerOrAbove) return true;
    }
    return false;
  };

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
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => navigate('/resources/new')}>
              <Plus size={18} /> Add Resource
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input className="input" placeholder="Search resources..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
        </div>
        <div className="tabs" style={{ overflowX: 'auto' }}>
          {types.map(t => (
            <button key={t} className={`tab ${typeFilter === t ? 'tab-active' : ''}`} onClick={() => setTypeFilter(t)}>
              {typeLabels[t] || t}
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
            const manageable = canManage(r);
            const isOwner = r.created_by === user?.uid;
            const imgSrc = r.image_url
              ? (r.image_url.startsWith('/uploads/') ? `${window.location.origin}${r.image_url}` : r.image_url)
              : null;

            return (
              <div
                key={r.id}
                className="card card-floating"
                style={{ padding: 0 }}
                onClick={() => navigate(`/resources/${r.id}`)}
              >
                {/* Hero Image / Placeholder */}
                {imgSrc ? (
                  <div className="card-hero-image">
                    <img
                      src={imgSrc}
                      alt={r.name}
                      onLoad={e => (e.currentTarget.classList.add('loaded'))}
                    />
                    <div className="card-hero-overlay" />
                    <div className="card-hero-badges">
                      {r.category === 'ST_RESOURCE' && (
                        <span className="card-hero-badge" style={{ background: 'rgba(168,85,247,0.85)', color: 'white' }}>
                          {isOwner ? 'My ST' : 'ST Resource'}
                        </span>
                      )}
                      <span className="card-hero-badge" style={{
                        background: r.status === 'available' ? 'rgba(16,185,129,0.85)' : 'rgba(100,116,139,0.85)',
                        color: 'white',
                      }}>
                        {r.status || 'available'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className={`card-hero-placeholder ${r.resource_type}`}>
                    <div className="card-hero-badges">
                      {r.category === 'ST_RESOURCE' && (
                        <span className="card-hero-badge" style={{ background: 'rgba(0,0,0,0.35)', color: 'white' }}>
                          {isOwner ? 'My ST' : 'ST Resource'}
                        </span>
                      )}
                      <span className="card-hero-badge" style={{
                        background: r.status === 'available' ? 'rgba(16,185,129,0.85)' : 'rgba(100,116,139,0.85)',
                        color: 'white',
                      }}>
                        {r.status || 'available'}
                      </span>
                    </div>
                    <Icon size={40} />
                  </div>
                )}

                {/* Card Body */}
                <div className="card-hero-body">
                  <h3 className="card-hero-title">{r.name}</h3>
                  <p className="card-hero-desc">
                    {r.description || `${(typeLabels[r.resource_type] || r.resource_type)} resource`}
                  </p>
                  <div className="card-hero-meta">
                    {r.location && (
                      <span className="card-hero-meta-item"><MapPin size={12} /> {r.location}</span>
                    )}
                    {r.capacity > 0 && (
                      <span className="card-hero-meta-item"><Users size={12} /> {r.capacity} seats</span>
                    )}
                    {r.hourly_cost != null && r.hourly_cost > 0 && r.category === 'ST_RESOURCE' && (
                      <span className="card-hero-meta-item" style={{ color: '#a855f7', fontWeight: 600 }}>
                        {r.hourly_cost} tokens/hr
                      </span>
                    )}
                  </div>
                </div>

                {/* Admin Actions */}
                {manageable && (
                  <div className="card-hero-actions">
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 'var(--font-size-xs)', padding: '4px 10px', color: 'var(--color-warning)' }}
                      onClick={(e) => handleToggleStatus(e, r)}
                      title={r.status === 'available' ? 'Disable' : 'Enable'}
                    >
                      {r.status === 'available' ? <PowerOff size={13} /> : <Power size={13} />}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 'var(--font-size-xs)', padding: '4px 10px', color: 'var(--color-info)' }}
                      onClick={(e) => { e.stopPropagation(); navigate(`/resources/${r.id}/edit`); }}
                    >
                      <Edit size={13} /> Edit
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 'var(--font-size-xs)', padding: '4px 10px', color: 'var(--color-danger)' }}
                      onClick={(e) => handleDelete(e, r.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
