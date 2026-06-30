import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { HandCoins, Check, X, RotateCcw, User, Mail, Phone, IdCard, Clock, MapPin } from 'lucide-react';
import { format } from 'date-fns';

interface STBorrow {
  id: string;
  st_resource_id: string;
  borrower_uid: string;
  owner_uid: string;
  title: string;
  purpose: string | null;
  start_time: string;
  end_time: string;
  status: string;
  notes: string | null;
  created_at: string;
  st_resources?: {
    name: string;
    condition: string;
    pickup_location: string | null;
    hourly_token_cost: number;
  };
  contact?: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
    member_id: string | null;
  };
  contact_role?: 'borrower' | 'owner';
}

const statusStyles: Record<string, { bg: string; color: string; label: string }> = {
  pending: { bg: '#fef3c7', color: '#d97706', label: 'Pending' },
  approved: { bg: '#dcfce7', color: '#16a34a', label: 'Approved' },
  rejected: { bg: '#fef2f2', color: '#dc2626', label: 'Rejected' },
  cancelled: { bg: '#f3f4f6', color: '#6b7280', label: 'Cancelled' },
  returned: { bg: '#dbeafe', color: '#2563eb', label: 'Returned' },
};

export function STBorrowsPage() {
  const [borrows, setBorrows] = useState<STBorrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'my' | 'lent'>('my');
  const { user } = useAuth();
  const { toast } = useToast();

  const loadBorrows = () => {
    setLoading(true);
    const params = tab === 'lent' ? '?tab=lent' : '';
    api.get<STBorrow[]>(`/st-resources/borrows${params}`).then(res => {
      setBorrows(Array.isArray(res.data) ? res.data : []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { loadBorrows(); }, [tab]);

  const handleAction = async (id: string, action: 'approve' | 'reject' | 'cancel' | 'return') => {
    const res = await api.put(`/st-resources/borrows/${id}/${action}`, {});
    if (res.success) {
      toast('success', `Borrow ${action}${action.endsWith('e') ? 'd' : 'ed'}`);
      loadBorrows();
    } else {
      toast('error', (res as any).error?.message || `Failed to ${action}`);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <HandCoins size={24} style={{ color: '#a855f7' }} /> ST Borrows
          </h2>
          <p className="page-subtitle">Manage your borrowing and lending</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: 'var(--space-6)' }}>
        <button className={`tab ${tab === 'my' ? 'tab-active' : ''}`} onClick={() => setTab('my')}>
          My Borrows
        </button>
        <button className={`tab ${tab === 'lent' ? 'tab-active' : ''}`} onClick={() => setTab('lent')}>
          Lent Out (My Items)
        </button>
      </div>

      {loading ? (
        <div className="grid-cards stagger">
          {[1,2,3].map(i => <div key={i} className="card skeleton-card" />)}
        </div>
      ) : borrows.length === 0 ? (
        <div className="card empty-state">
          <HandCoins size={40} className="empty-state-icon" style={{ color: '#a855f7' }} />
          <p className="empty-state-title">{tab === 'my' ? 'No borrows yet' : 'No items lent out'}</p>
          <p>{tab === 'my' ? 'Browse ST Resources to borrow items' : 'When others borrow your items, they appear here'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {borrows.map(b => {
            const st = statusStyles[b.status] || statusStyles.pending;
            const res = b.st_resources;
            const isOwnerView = tab === 'lent';

            return (
              <div key={b.id} className="card" style={{ padding: 'var(--space-5)', borderLeft: '3px solid #a855f7' }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                  <div>
                    <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 4 }}>
                      {res?.name || b.title}
                    </h3>
                    <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={12} />
                        {format(new Date(b.start_time), 'MMM d, h:mm a')} → {format(new Date(b.end_time), 'MMM d, h:mm a')}
                      </span>
                      {res?.pickup_location && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <MapPin size={12} /> {res.pickup_location}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="badge" style={{ background: st.bg, color: st.color, fontWeight: 600, fontSize: 11 }}>
                    {st.label}
                  </span>
                </div>

                {/* Purpose */}
                {b.purpose && (
                  <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)', fontStyle: 'italic' }}>
                    "{b.purpose}"
                  </p>
                )}

                {/* Rejection note */}
                {b.status === 'rejected' && b.notes && (
                  <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--color-danger-light)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: '#dc2626', marginBottom: 'var(--space-3)' }}>
                    Reason: {b.notes}
                  </div>
                )}

                {/* Contact Details */}
                {b.contact && (
                  <div style={{
                    padding: 'var(--space-3)',
                    background: 'var(--color-bg-glass)',
                    borderRadius: 'var(--radius-md)',
                    marginBottom: 'var(--space-3)',
                  }}>
                    <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {b.contact_role === 'owner' ? '📤 Owner Contact' : '📥 Borrower Contact'}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                      {b.contact.full_name && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <User size={14} style={{ color: 'var(--color-text-muted)' }} />
                          <span>{b.contact.full_name}</span>
                        </div>
                      )}
                      {b.contact.email && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <Mail size={14} style={{ color: 'var(--color-text-muted)' }} />
                          <a href={`mailto:${b.contact.email}`} style={{ color: 'var(--color-primary)' }}>{b.contact.email}</a>
                        </div>
                      )}
                      {b.contact.phone && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <Phone size={14} style={{ color: 'var(--color-text-muted)' }} />
                          <a href={`tel:${b.contact.phone}`} style={{ color: 'var(--color-primary)' }}>{b.contact.phone}</a>
                        </div>
                      )}
                      {b.contact.member_id && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                          <IdCard size={14} style={{ color: 'var(--color-text-muted)' }} />
                          <span>{b.contact.member_id}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {isOwnerView && b.status === 'pending' && (
                    <>
                      <button className="btn btn-sm" style={{ background: '#16a34a', color: 'white', border: 'none' }} onClick={() => handleAction(b.id, 'approve')}>
                        <Check size={14} /> Approve
                      </button>
                      <button className="btn btn-sm" style={{ background: '#dc2626', color: 'white', border: 'none' }} onClick={() => handleAction(b.id, 'reject')}>
                        <X size={14} /> Reject
                      </button>
                    </>
                  )}
                  {isOwnerView && b.status === 'approved' && (
                    <button className="btn btn-sm" style={{ background: '#2563eb', color: 'white', border: 'none' }} onClick={() => handleAction(b.id, 'return')}>
                      <RotateCcw size={14} /> Mark Returned
                    </button>
                  )}
                  {!isOwnerView && (b.status === 'pending' || b.status === 'approved') && (
                    <button className="btn btn-sm btn-danger" onClick={() => handleAction(b.id, 'cancel')}>
                      <X size={14} /> Cancel
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
