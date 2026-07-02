import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import {
  Users, Search, Mail, Calendar, Trash2, Plus, X, Loader2,
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
  const { toast } = useToast();

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
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-6)', flexWrap: 'wrap' }}>
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
              <tr key={user.firebase_uid} style={{ opacity: user.is_active ? 1 : 0.5 }}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: 'var(--gradient-primary)', color: 'white',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 'var(--font-size-sm)', fontWeight: 700,
                    }}>
                      {(user.full_name || user.email)[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>{user.full_name || '—'}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Mail size={10} /> {user.email}
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
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDelete(user.firebase_uid, user.full_name || user.email)}
                    style={{ gap: 4 }}
                  >
                    <Trash2 size={12} /> Delete
                  </button>
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
