import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  Users, Search, Mail, Calendar, Trash2, Plus, X, Loader2,
  ShieldBan, ShieldCheck, Coins,
} from 'lucide-react';
import { format } from 'date-fns';

interface UserProfile {
  firebase_uid: string;
  email: string;
  full_name: string;
  role: string;
  phone?: string;
  member_id?: string;
  is_active: boolean;
  created_at: string;
  tenant_id: string;
}

const roleBadge: Record<string, string> = {
  main_admin: 'badge-primary',
  tenant_admin: 'badge-warning',
  lecturer: 'badge-info',
  junior_lecturer: 'badge-info',
  student: 'badge-success',
  staff: 'badge-neutral',
};

const roleLabels: Record<string, string> = {
  main_admin: 'Main Admin',
  tenant_admin: 'Tenant Admin',
  lecturer: 'Lecturer',
  junior_lecturer: 'Junior Lecturer',
  student: 'Student',
  staff: 'Staff',
};

export function AdminUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [tokenModalUser, setTokenModalUser] = useState<UserProfile | null>(null);
  const { toast } = useToast();
  const { claims } = useAuth();
  const isMainAdmin = claims.app_role === 'main_admin';

  const fetchUsers = () => {
    setLoading(true);
    api.get<UserProfile[]>('/users').then(res => {
      setUsers(Array.isArray(res.data) ? res.data : []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchUsers(); }, []);

  const [roleModalUser, setRoleModalUser] = useState<UserProfile | null>(null);
  const handleDelete = async (uid: string, name: string) => {
    if (!window.confirm(`Delete user "${name}"? This will permanently remove their account.`)) return;
    const res = await api.delete(`/users/${uid}`);
    if (res.success) {
      toast('success', 'User deleted');
      setUsers(prev => prev.filter(u => u.firebase_uid !== uid));
    } else {
      toast('error', res.error?.message || 'Failed to delete user');
    }
  };

  const handleBan = async (uid: string, name: string) => {
    if (!window.confirm(`Suspend user "${name}"? They will not be able to access the platform.`)) return;
    const res = await api.put(`/users/${uid}/ban`, { reason: 'Suspended by administrator' });
    if (res.success) {
      toast('success', `${name} has been suspended`);
      setUsers(prev => prev.map(u => u.firebase_uid === uid ? { ...u, is_active: false } : u));
    } else {
      toast('error', res.error?.message || 'Failed to suspend user');
    }
  };

  const handleUnban = async (uid: string, name: string) => {
    const res = await api.put(`/users/${uid}/unban`, {});
    if (res.success) {
      toast('success', `${name} has been reactivated`);
      setUsers(prev => prev.map(u => u.firebase_uid === uid ? { ...u, is_active: true } : u));
    } else {
      toast('error', res.error?.message || 'Failed to reactivate user');
    }
  };

  const filtered = users.filter(u => {
    const matchSearch = (u.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const roles = ['all', 'main_admin', 'tenant_admin', 'lecturer', 'junior_lecturer', 'staff', 'student'];

  if (loading) {
    return (
      <div>
        <div className="page-header"><div className="skeleton skeleton-title" style={{ width: 200 }} /></div>
        {[1,2,3,4].map(i => <div key={i} className="card skeleton-card" style={{ marginBottom: 'var(--space-3)' }} />)}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">User Management</h2>
          <p className="page-subtitle">{users.length} users registered</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowRegister(true)}>
          <Plus size={18} /> Register User
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
          <input className="input" placeholder="Search by name or email..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
        </div>
        <div className="tabs">
          {roles.map(r => (
            <button key={r} className={`tab ${roleFilter === r ? 'tab-active' : ''}`} onClick={() => setRoleFilter(r)}>
              {r === 'all' ? 'All' : roleLabels[r] || r}
            </button>
          ))}
        </div>
      </div>

      {/* User Table */}
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th className="mobile-hide">Member ID</th>
              <th>Role</th>
              <th className="mobile-hide">Joined</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
                  <Users size={32} style={{ margin: '0 auto var(--space-2)', opacity: 0.3 }} />
                  <p>No users found</p>
                </td>
              </tr>
            ) : filtered.map(user => (
              <tr key={user.firebase_uid} style={{ opacity: user.is_active ? 1 : 0.6 }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: user.is_active ? 'var(--gradient-primary)' : 'linear-gradient(135deg, #fca5a5, #f87171)',
                      color: 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 'var(--font-size-sm)', fontWeight: 700,
                    }}>
                      {(user.full_name || user.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{user.full_name || '—'}</span>
                        {!user.is_active && (
                          <span className="badge badge-danger" style={{ fontSize: 9, padding: '1px 6px' }}>Banned</span>
                        )}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                        <Mail size={10} /> <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <td className="mobile-hide">
                  <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, fontFamily: 'monospace' }}>
                    {(user as any).member_id || '—'}
                  </span>
                </td>
                <td>
                  <button
                    className={`badge ${roleBadge[user.role] || 'badge-neutral'}`}
                    style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 'var(--space-1) var(--space-2)' }}
                    onClick={() => setRoleModalUser(user)}
                    title="Click to change role or faculty"
                  >
                    {roleLabels[user.role] || user.role}
                  </button>
                </td>
                <td className="mobile-hide">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Calendar size={12} /> {format(new Date(user.created_at), 'MMM d, yyyy')}
                  </div>
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {/* Token management for students */}
                    {user.role === 'student' && (
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={() => setTokenModalUser(user)}
                        title="Manage tokens"
                        style={{ gap: 4, color: 'var(--color-warning, #d97706)', padding: '4px 8px' }}
                      >
                        <Coins size={12} />
                        <span className="mobile-hide">Tokens</span>
                      </button>
                    )}
                    {/* Ban/Unban for main admin */}
                    {isMainAdmin && user.role !== 'main_admin' && (
                      user.is_active ? (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => handleBan(user.firebase_uid, user.full_name || user.email)}
                          title="Suspend user"
                          style={{ gap: 4, color: 'var(--color-danger)', padding: '4px 8px' }}
                        >
                          <ShieldBan size={12} />
                          <span className="mobile-hide">Ban</span>
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => handleUnban(user.firebase_uid, user.full_name || user.email)}
                          title="Reactivate user"
                          style={{ gap: 4, color: 'var(--color-success, #16a34a)', padding: '4px 8px' }}
                        >
                          <ShieldCheck size={12} />
                          <span className="mobile-hide">Unban</span>
                        </button>
                      )
                    )}
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => handleDelete(user.firebase_uid, user.full_name || user.email)}
                      style={{ gap: 4, padding: '4px 8px' }}
                    >
                      <Trash2 size={12} />
                      <span className="mobile-hide">Delete</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Register User Modal */}
      {showRegister && (
        <RegisterUserModal
          onClose={() => setShowRegister(false)}
          onCreated={() => { setShowRegister(false); fetchUsers(); }}
        />
      )}

      {/* Change Role Modal */}
      {roleModalUser && (
        <ChangeRoleModal
          user={roleModalUser}
          onClose={() => setRoleModalUser(null)}
          onChanged={() => { setRoleModalUser(null); fetchUsers(); }}
        />
      )}

      {/* Token Management Modal */}
      {tokenModalUser && (
        <TokenManagementModal
          user={tokenModalUser}
          onClose={() => setTokenModalUser(null)}
          onUpdated={() => { setTokenModalUser(null); fetchUsers(); }}
        />
      )}
    </div>
  );
}

/* ========================================================================
   Change Role Modal
   ======================================================================== */
function ChangeRoleModal({ user, onClose, onChanged }: { user: UserProfile; onClose: () => void; onChanged: () => void }) {
  const [role, setRole] = useState(user.role);
  const [tenantId, setTenantId] = useState(user.tenant_id || '');
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    api.get<any[]>('/tenants').then(res => setTenants(res.data || []));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (role !== 'main_admin' && (!tenantId || tenantId === 'null')) {
      toast('warning', 'A faculty/tenant must be selected for this role.');
      return;
    }
    setLoading(true);
    try {
      const payload = { role, tenant_id: role === 'main_admin' ? null : tenantId };
      const res = await api.put(`/users/${user.firebase_uid}/role`, payload);
      if (res.success) {
        toast('success', `Role updated to ${roleLabels[role] || role}`);
        onChanged();
      } else {
        toast('error', res.error?.message || 'Failed to update role');
      }
    } catch {
      toast('error', 'Failed to update role');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div className="card" style={{
        width: '100%', maxWidth: 400, padding: 'var(--space-6)',
        animation: 'fadeInUp 0.2s ease',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
          <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>Change Role / Faculty</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ fontWeight: 600 }}>{user.full_name || user.email}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{user.email}</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="input-group">
            <label className="input-label">Role</label>
            <select className="input" value={role} onChange={e => setRole(e.target.value)}>
              {Object.entries(roleLabels).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          <div className="input-group" style={{ opacity: role === 'main_admin' ? 0.5 : 1 }}>
            <label className="input-label">Faculty / Tenant</label>
            <select 
              className="input" 
              value={role === 'main_admin' ? '' : tenantId} 
              onChange={e => setTenantId(e.target.value)}
              disabled={role === 'main_admin'}
            >
              <option value="">-- Select Faculty --</option>
              {tenants.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {role === 'main_admin' && (
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                Main admins have global access across all faculties.
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ========================================================================
   Register User Modal — Admin creates a new user account
   ======================================================================== */
function RegisterUserModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [memberId, setMemberId] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('student');
  const [tenantId, setTenantId] = useState('');
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    api.get<any>('/tenants').then(res => {
      // res.data could be an array if using sendSuccess with array, or inside res.data if paginated
      const items = Array.isArray(res.data) ? res.data : [];
      setTenants(items);
      if (items.length === 1) {
        setTenantId(items[0].id);
      }
    });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !fullName) {
      toast('warning', 'Email, password, and full name are required');
      return;
    }
    if (password.length < 6) {
      toast('warning', 'Password must be at least 6 characters');
      return;
    }
    if (role !== 'main_admin' && !tenantId) {
      // Only enforce if the current user has access to multiple tenants, but to be safe:
      if (tenants.length > 1 || tenants.length === 0) {
         toast('warning', 'A faculty/tenant must be selected');
         return;
      }
    }

    setLoading(true);
    try {
      const res = await api.post('/users/register', {
        email,
        password,
        full_name: fullName,
        role,
        member_id: memberId || undefined,
        phone: phone || undefined,
        tenant_id: role === 'main_admin' ? null : tenantId || undefined,
      });
      if (res.success) {
        toast('success', `User "${fullName}" created successfully`);
        onCreated();
      } else {
        toast('error', res.error?.message || 'Failed to create user');
      }
    } catch {
      toast('error', 'Failed to create user');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div className="card" style={{
        width: '100%', maxWidth: 480, padding: 'var(--space-6)',
        animation: 'fadeInUp 0.2s ease',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-5)' }}>
          <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>Register New User</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="input-group">
            <label className="input-label">Full Name *</label>
            <input className="input" type="text" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="John Doe" required />
          </div>

          <div className="input-group">
            <label className="input-label">Email *</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@university.edu" required />
          </div>

          <div className="input-group">
            <label className="input-label">Password *</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 6 characters" required minLength={6} />
          </div>

          <div className="grid-2-col">
            <div className="input-group">
              <label className="input-label">Member ID</label>
              <input className="input" type="text" value={memberId} onChange={e => setMemberId(e.target.value.toUpperCase())} placeholder="230571F" />
            </div>
            <div className="input-group">
              <label className="input-label">Role</label>
              <select className="input" value={role} onChange={e => setRole(e.target.value)}>
                <option value="student">Student</option>
                <option value="lecturer">Lecturer</option>
                <option value="staff">Staff</option>
                <option value="tenant_admin">Tenant Admin</option>
              </select>
            </div>
          </div>
          
          {/* Only show tenant selection if assigning a non-main-admin role and if user has access to multiple tenants */}
          {(role !== 'main_admin' && tenants.length > 0) && (
            <div className="input-group">
              <label className="input-label">Faculty / Tenant</label>
              <select 
                className="input" 
                value={tenantId} 
                onChange={e => setTenantId(e.target.value)}
                required={role !== 'main_admin'}
              >
                <option value="">-- Select Faculty --</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="input-group">
            <label className="input-label">Mobile (optional)</label>
            <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+94 71 234 5678" />
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {loading ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ========================================================================
   Token Management Modal — Admin adjusts a specific student's tokens
   ======================================================================== */
function TokenManagementModal({ user, onClose, onUpdated }: { user: UserProfile; onClose: () => void; onUpdated: () => void }) {
  const [balance, setBalance] = useState<number | ''>('');
  const [monthlyQuota, setMonthlyQuota] = useState<number | ''>('');
  const [loadingData, setLoadingData] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentBalance, setCurrentBalance] = useState(0);
  const [currentQuota, setCurrentQuota] = useState(0);
  const { toast } = useToast();

  // Fetch current token data
  useEffect(() => {
    setLoadingData(true);
    api.get<any>(`/users/${user.firebase_uid}/tokens`).then(res => {
      if (res.success && res.data) {
        // API response: { balance: { balance: N, monthly_quota: N, ... }, transactions: [...] }
        const tokenData = res.data;
        const bal = tokenData.balance || tokenData;
        const b = typeof bal.balance === 'number' ? bal.balance : 0;
        const q = typeof bal.monthly_quota === 'number' ? bal.monthly_quota : 100;
        setCurrentBalance(b);
        setCurrentQuota(q);
        setBalance(b);
        setMonthlyQuota(q);
      }
    }).catch(() => {
      setBalance(0);
      setMonthlyQuota(100);
    }).finally(() => setLoadingData(false));
  }, [user.firebase_uid]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (balance === '' && monthlyQuota === '') {
      toast('warning', 'Enter at least one value to update');
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, number> = {};
      if (balance !== '' && balance !== currentBalance) payload.balance = Number(balance);
      if (monthlyQuota !== '' && monthlyQuota !== currentQuota) payload.monthly_quota = Number(monthlyQuota);

      if (Object.keys(payload).length === 0) {
        toast('info', 'No changes to save');
        onClose();
        return;
      }

      const res = await api.put(`/users/${user.firebase_uid}/tokens`, payload);
      if (res.success) {
        toast('success', `Tokens updated for ${user.full_name || user.email}`);
        onUpdated();
      } else {
        toast('error', res.error?.message || 'Failed to update tokens');
      }
    } catch {
      toast('error', 'Failed to update tokens');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div className="card" style={{
        width: '100%', maxWidth: 420, padding: 'var(--space-6)',
        animation: 'fadeInUp 0.2s ease',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', gap: 'var(--space-2)' }}>
          <h3 style={{ fontSize: 'var(--font-size-base)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
            <Coins size={18} style={{ color: '#d97706', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Manage Tokens</span>
          </h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ flexShrink: 0 }}><X size={18} /></button>
        </div>

        {/* User info */}
        <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', background: 'var(--color-bg-subtle)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ fontWeight: 600 }}>{user.full_name || user.email}</div>
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{user.email}</div>
        </div>

        {loadingData ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
            <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-text-muted)', margin: '0 auto' }} />
          </div>
        ) : (
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Current stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div style={{
                padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: '#92400e' }}>{currentBalance}</div>
                <div style={{ fontSize: '10px', color: '#92400e', fontWeight: 500 }}>Current Balance</div>
              </div>
              <div style={{
                padding: 'var(--space-3)', borderRadius: 'var(--radius-md)',
                background: 'linear-gradient(135deg, #e0e7ff, #c7d2fe)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: '#3730a3' }}>{currentQuota}</div>
                <div style={{ fontSize: '10px', color: '#3730a3', fontWeight: 500 }}>Monthly Quota</div>
              </div>
            </div>

            {/* Editable fields */}
            <div className="input-group">
              <label className="input-label">Set Token Balance</label>
              <input
                className="input"
                type="number"
                min={0}
                value={balance}
                onChange={e => setBalance(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="e.g. 100"
              />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                Current available tokens for this student
              </span>
            </div>

            <div className="input-group">
              <label className="input-label">Set Monthly Quota</label>
              <input
                className="input"
                type="number"
                min={0}
                value={monthlyQuota}
                onChange={e => setMonthlyQuota(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="e.g. 100"
              />
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                Tokens refreshed monthly for this student
              </span>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving} style={{ minWidth: 0 }}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Coins size={16} />}
                {saving ? 'Saving...' : 'Update Tokens'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
