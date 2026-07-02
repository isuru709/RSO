import { useState, useEffect, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import {
  Building2, Plus, Search, Edit3, Save, X, ToggleLeft, ToggleRight, Mail, Hash, Loader2,
} from 'lucide-react';
import { format } from 'date-fns';

interface Tenant {
  id: string;
  name: string;
  code: string;
  slug: string;
  description?: string;
  contact_email?: string;
  is_active: boolean;
  created_at: string;
}

export function AdminTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Form state
  const [formName, setFormName] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formEmail, setFormEmail] = useState('');

  const fetchTenants = () => {
    setLoading(true);
    api.get<Tenant[]>('/tenants').then(res => {
      setTenants(Array.isArray(res.data) ? res.data : []);
    }).finally(() => setLoading(false));
  };

  useEffect(() => { fetchTenants(); }, []);

  const resetForm = () => {
    setFormName(''); setFormCode(''); setFormSlug(''); setFormDesc(''); setFormEmail('');
    setShowForm(false); setEditingId(null);
  };

  const startEdit = (t: Tenant) => {
    setEditingId(t.id);
    setFormName(t.name);
    setFormCode(t.code);
    setFormSlug(t.slug);
    setFormDesc(t.description || '');
    setFormEmail(t.contact_email || '');
    setShowForm(true);
  };

  const startCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formName || !formCode) { toast('warning', 'Name and Code are required'); return; }

    setSaving(true);
    const body = {
      name: formName,
      code: formCode,
      slug: formSlug || formCode.toLowerCase().replace(/[^a-z0-9]/g, '-'),
      description: formDesc || undefined,
      contact_email: formEmail || undefined,
    };

    let res;
    if (editingId) {
      res = await api.put(`/tenants/${editingId}`, body);
    } else {
      res = await api.post('/tenants', body);
    }

    if (res.success) {
      toast('success', editingId ? 'Tenant updated' : 'Tenant created');
      fetchTenants();
      resetForm();
    } else {
      toast('error', res.error?.message || 'Operation failed');
    }
    setSaving(false);
  };

  const handleToggleActive = async (t: Tenant) => {
    const res = await api.put(`/tenants/${t.id}`, { is_active: !t.is_active });
    if (res.success) {
      toast('success', t.is_active ? 'Tenant deactivated' : 'Tenant activated');
      setTenants(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !t.is_active } : x));
    } else {
      toast('error', 'Failed to update tenant');
    }
  };

  const filtered = tenants.filter(t =>
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.code.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div>
        <div className="page-header"><div className="skeleton skeleton-title" style={{ width: 200 }} /></div>
        {[1,2,3].map(i => <div key={i} className="card skeleton-card" style={{ marginBottom: 'var(--space-3)' }} />)}
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title">Tenant Management</h2>
          <p className="page-subtitle">{tenants.length} faculties/departments</p>
        </div>
        <button className="btn btn-primary" onClick={startCreate}>
          <Plus size={18} /> Add Tenant
        </button>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="card" style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--color-primary)' }}>
          <h3 className="card-title" style={{ marginBottom: 'var(--space-4)' }}>
            {editingId ? 'Edit Tenant' : 'Create New Tenant'}
          </h3>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))', gap: 'var(--space-4)' }}>
            <div className="input-group">
              <label className="input-label">Name *</label>
              <input className="input" placeholder="Faculty of Computing" value={formName} onChange={e => setFormName(e.target.value)} required />
            </div>
            <div className="input-group">
              <label className="input-label">Code *</label>
              <div style={{ position: 'relative' }}>
                <Hash size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input className="input" placeholder="FOC" value={formCode} onChange={e => setFormCode(e.target.value.toUpperCase())} required style={{ paddingLeft: 32 }} />
              </div>
            </div>
            <div className="input-group">
              <label className="input-label">Slug</label>
              <input className="input" placeholder="foc (auto-generated)" value={formSlug} onChange={e => setFormSlug(e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label">Contact Email</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input className="input" type="email" placeholder="admin@faculty.edu" value={formEmail} onChange={e => setFormEmail(e.target.value)} style={{ paddingLeft: 32 }} />
              </div>
            </div>
            <div className="input-group" style={{ gridColumn: '1 / -1' }}>
              <label className="input-label">Description</label>
              <textarea className="input" placeholder="Brief description of the faculty/department" value={formDesc} onChange={e => setFormDesc(e.target.value)} style={{ minHeight: 60 }} />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={resetForm}><X size={16} /> Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {editingId ? 'Update' : 'Create'} Tenant
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 'var(--space-6)' }}>
        <Search size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
        <input className="input" placeholder="Search tenants..." value={search} onChange={e => setSearch(e.target.value)} style={{ paddingLeft: 40 }} />
      </div>

      {/* Tenant Cards */}
      <div className="grid-cards stagger">
        {filtered.map(t => (
          <div key={t.id} className="card" style={{ opacity: t.is_active ? 1 : 0.5 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
              <div style={{
                width: 48, height: 48, borderRadius: 'var(--radius-md)',
                background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Building2 size={24} />
              </div>
              <span className={`badge ${t.is_active ? 'badge-success' : 'badge-neutral'}`}>
                {t.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>

            <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>{t.name}</h3>
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
              Code: <strong>{t.code}</strong> &bull; Slug: {t.slug}
            </p>
            {t.description && (
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>{t.description}</p>
            )}
            {t.contact_email && (
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 'var(--space-3)' }}>
                <Mail size={12} /> {t.contact_email}
              </p>
            )}
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-4)' }}>
              Created {format(new Date(t.created_at), 'MMM d, yyyy')}
            </p>

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => startEdit(t)} style={{ flex: 1 }}>
                <Edit3 size={14} /> Edit
              </button>
              <button
                className={`btn btn-sm ${t.is_active ? 'btn-danger' : 'btn-success'}`}
                onClick={() => handleToggleActive(t)}
                style={{ flex: 1 }}
              >
                {t.is_active ? <><ToggleRight size={14} /> Deactivate</> : <><ToggleLeft size={14} /> Activate</>}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
