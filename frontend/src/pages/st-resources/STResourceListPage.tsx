import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { BookOpen, Search, Plus, MapPin, Trash2, PowerOff, Power, Edit2, HandCoins } from 'lucide-react';
import { BorrowSTResourceModal } from './BorrowSTResourceModal';

interface STResource {
  id: string;
  name: string;
  description: string | null;
  item_type: string;
  condition: string;
  pickup_location: string | null;
  hourly_token_cost: number;
  is_available: boolean;
  created_by: string;
  created_at: string;
}

const conditionColors: Record<string, { color: string; bg: string }> = {
  excellent: { color: '#16a34a', bg: '#dcfce7' },
  good: { color: '#2563eb', bg: '#dbeafe' },
  fair: { color: '#d97706', bg: '#fef3c7' },
  poor: { color: '#dc2626', bg: '#fef2f2' },
};


export function STResourceListPage() {
  const [resources, setResources] = useState<STResource[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showMine, setShowMine] = useState(false);
  const [borrowTarget, setBorrowTarget] = useState<STResource | null>(null);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const navigate = useNavigate();
  const { claims, user } = useAuth();
  const { toast } = useToast();
  const isStudent = claims?.app_role === 'student';
  const canManageAny = ['main_admin', 'tenant_admin', 'lecturer', 'junior_lecturer'].includes(claims?.app_role || '');

  const loadResources = () => {
    const params = showMine ? '?mine=true' : '';
    api.get<STResource[]>(`/st-resources${params}`).then(res => {
      setResources(Array.isArray(res.data) ? res.data : []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { loadResources(); }, [showMine]);

  // Fetch token balance for students
  useEffect(() => {
    if (isStudent) {
      api.get<any>('/users/me/tokens').then(res => {
        if (res.success && res.data?.balance) {
          setTokenBalance(res.data.balance.balance);
        }
      });
    }
  }, []);

  const filtered = resources.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.description?.toLowerCase().includes(search.toLowerCase()) ||
    r.pickup_location?.toLowerCase().includes(search.toLowerCase())
  );

  const canManage = (r: STResource) => {
    if (canManageAny) return true;
    if (isStudent && r.created_by === user?.uid) return true;
    return false;
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this ST Resource?')) return;
    const res = await api.delete(`/st-resources/${id}`);
    if (res.success) {
      setResources(resources.filter(r => r.id !== id));
      toast('success', 'Resource deleted');
    } else {
      toast('error', res.error?.message || 'Failed to delete');
    }
  };

  const handleToggle = async (e: React.MouseEvent, r: STResource) => {
    e.stopPropagation();
    const res = await api.put(`/st-resources/${r.id}`, { is_available: !r.is_available });
    if (res.success) {
      setResources(resources.map(x => x.id === r.id ? { ...x, is_available: !x.is_available } : x));
      toast('success', r.is_available ? 'Resource disabled' : 'Resource enabled');
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
          <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BookOpen size={24} style={{ color: '#a855f7' }} /> ST Resources
          </h2>
          <p className="page-subtitle">{resources.length} student shared items</p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {isStudent && (
            <>
              <button className="btn" onClick={() => navigate('/st-resources/borrows')} style={{ background: '#f3e8ff', color: '#a855f7', border: 'none' }}>
                <HandCoins size={18} /> My Borrows
              </button>
              <button className="btn btn-primary" onClick={() => navigate('/st-resources/new')} style={{ background: '#a855f7', border: 'none' }}>
                <Plus size={18} /> Share My Item
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input className="input" placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
        </div>
        {isStudent && (
          <div className="tabs">
            <button className={`tab ${!showMine ? 'tab-active' : ''}`} onClick={() => setShowMine(false)}>All Items</button>
            <button className={`tab ${showMine ? 'tab-active' : ''}`} onClick={() => setShowMine(true)}>My Items</button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card empty-state">
          <BookOpen size={40} className="empty-state-icon" style={{ color: '#a855f7' }} />
          <p className="empty-state-title">No ST Resources found</p>
          <p>{isStudent ? 'Be the first to share an item!' : 'No students have shared items yet.'}</p>
          {isStudent && (
            <button className="btn" onClick={() => navigate('/st-resources/new')} style={{ marginTop: 'var(--space-4)', background: '#a855f7', color: 'white', border: 'none' }}>
              <Plus size={16} /> Share Your First Item
            </button>
          )}
        </div>
      ) : (
        <div className="grid-cards stagger">
          {filtered.map(r => {
            const cond = conditionColors[r.condition] || conditionColors.good;
            const manageable = canManage(r);
            const isOwner = r.created_by === user?.uid;
            const canBorrow = isStudent && !isOwner && r.is_available;
            return (
              <div
                key={r.id}
                className="card card-interactive"
                style={{ cursor: 'default', borderLeft: '3px solid #a855f7', opacity: r.is_available ? 1 : 0.6 }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-3)', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-md)', background: '#f3e8ff', color: '#a855f7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <BookOpen size={20} />
                  </div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {isOwner && (
                      <span className="badge" style={{ background: '#f3e8ff', color: '#a855f7', fontWeight: 600, fontSize: 10 }}>My Item</span>
                    )}
                    <span className="badge" style={{ background: cond.bg, color: cond.color, fontWeight: 500, fontSize: 10 }}>
                      {r.condition}
                    </span>
                    <span className={`badge ${r.is_available ? 'badge-success' : 'badge-neutral'}`} style={{ fontSize: 10 }}>
                      {r.is_available ? 'Available' : 'Unavailable'}
                    </span>
                  </div>
                </div>
                <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>{r.name}</h3>
                {r.description && (
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-2)' }}>{r.description}</p>
                )}
                <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
                  {r.pickup_location && <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><MapPin size={12} /> {r.pickup_location}</span>}
                  {r.hourly_token_cost > 0 && (
                    <span style={{ color: '#a855f7', fontWeight: 600 }}>{r.hourly_token_cost} tokens/hr</span>
                  )}
                  {r.hourly_token_cost === 0 && (
                    <span style={{ color: '#16a34a', fontWeight: 600 }}>Free</span>
                  )}
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {canBorrow && (
                    <button className="btn btn-sm" style={{ background: '#a855f7', color: 'white', border: 'none' }} onClick={() => setBorrowTarget(r)}>
                      <HandCoins size={14} /> Borrow
                    </button>
                  )}
                  {manageable && (
                    <>
                      {isOwner && (
                        <button className="btn btn-sm" style={{ background: '#f3e8ff', color: '#a855f7', border: 'none' }} onClick={() => navigate(`/st-resources/${r.id}/edit`)}>
                          <Edit2 size={14} /> Edit
                        </button>
                      )}
                      <button className="btn btn-icon btn-sm" style={{ color: 'var(--color-warning)', background: 'var(--color-warning-light)', padding: 5, borderRadius: 'var(--radius-md)' }} onClick={(e) => handleToggle(e, r)}>
                        {r.is_available ? <PowerOff size={14} /> : <Power size={14} />}
                      </button>
                      <button className="btn btn-icon btn-sm" style={{ color: 'var(--color-danger)', background: 'var(--color-danger-light)', padding: 5, borderRadius: 'var(--radius-md)' }} onClick={(e) => handleDelete(e, r.id)}>
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Borrow Modal */}
      {borrowTarget && (
        <BorrowSTResourceModal
          resource={borrowTarget}
          tokenBalance={tokenBalance}
          onClose={() => setBorrowTarget(null)}
          onSuccess={() => {
            setBorrowTarget(null);
            loadResources();
          }}
        />
      )}
    </div>
  );
}
