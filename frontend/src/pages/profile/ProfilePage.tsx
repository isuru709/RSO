import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import {
  User, Mail, Phone, Hash, Shield, Camera, Save, LogOut, Trash2,
  Edit3, X, Loader2, Calendar,
} from 'lucide-react';
import { format } from 'date-fns';

interface UserProfile {
  firebase_uid: string;
  email: string;
  full_name: string;
  phone?: string;
  member_id?: string;
  role: string;
  avatar_url?: string;
  is_active: boolean;
  created_at: string;
  tenant_id: string;
}

const roleLabels: Record<string, string> = {
  super_admin: 'Super Admin',
  tenant_admin: 'Tenant Admin',
  lecturer: 'Lecturer',
  student: 'Student',
  staff: 'Staff',
};

export function ProfilePage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Editable fields
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editMemberId, setEditMemberId] = useState('');

  useEffect(() => {
    if (user) {
      api.get<UserProfile>(`/users/${user.uid}`).then(res => {
        if (res.success && res.data) {
          setProfile(res.data);
          setEditName(res.data.full_name || '');
          setEditPhone(res.data.phone || '');
          setEditMemberId(res.data.member_id || '');
        }
      }).finally(() => setLoading(false));
    }
  }, [user]);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;
    setSaving(true);
    const res = await api.put(`/users/${user.uid}`, {
      full_name: editName,
      phone: editPhone || null,
      member_id: editMemberId || null,
    });
    if (res.success) {
      toast('success', 'Profile updated');
      setProfile(prev => prev ? { ...prev, full_name: editName, phone: editPhone, member_id: editMemberId } : null);
      setEditing(false);
    } else {
      toast('error', res.error?.message || 'Update failed');
    }
    setSaving(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 1 * 1024 * 1024) {
      toast('warning', 'File too large. Max 1MB');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result as string;
      const res = await api.post(`/users/${user.uid}/avatar`, {
        image: base64,
        filename: file.name,
      });
      if (res.success && (res.data as any)?.avatar_url) {
        const newUrl = (res.data as any).avatar_url + '?t=' + Date.now();
        setProfile(prev => prev ? { ...prev, avatar_url: newUrl } : null);
        toast('success', 'Avatar updated');
      } else {
        toast('error', 'Failed to upload avatar');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    setDeleting(true);
    const res = await api.delete(`/users/${user.uid}`);
    if (res.success) {
      toast('success', 'Account deleted');
      await logout();
    } else {
      toast('error', res.error?.message || 'Failed to delete account');
    }
    setDeleting(false);
  };

  const getAvatarUrl = () => {
    if (profile?.avatar_url) {
      // If it's a relative URL, prepend the API base
      if (profile.avatar_url.startsWith('/uploads/')) {
        return `${window.location.origin}${profile.avatar_url}`;
      }
      return profile.avatar_url;
    }
    return null;
  };

  if (loading) {
    return (
      <div>
        <div className="page-header"><div className="skeleton skeleton-title" style={{ width: 200 }} /></div>
        <div className="card"><div className="skeleton" style={{ height: 300 }} /></div>
      </div>
    );
  }

  const initials = (profile?.full_name || user?.email || 'U')[0].toUpperCase();
  const avatarUrl = getAvatarUrl();

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="page-header">
        <h2 className="page-title">My Profile</h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {!editing && (
            <button className="btn btn-secondary" onClick={() => setEditing(true)}>
              <Edit3 size={16} /> Edit Profile
            </button>
          )}
          <button className="btn btn-ghost" onClick={logout} style={{ color: 'var(--color-danger)' }}>
            <LogOut size={16} /> Sign Out
          </button>
        </div>
      </div>

      {/* Avatar + Name Card */}
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 'var(--space-4)' }}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt="Avatar"
              style={{
                width: 100, height: 100, borderRadius: '50%',
                objectFit: 'cover', border: '3px solid var(--color-primary)',
              }}
            />
          ) : (
            <div style={{
              width: 100, height: 100, borderRadius: '50%',
              background: 'var(--gradient-primary)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '2.5rem', fontWeight: 700,
            }}>
              {initials}
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 32, height: 32, borderRadius: '50%',
              background: 'var(--color-primary)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '2px solid var(--color-bg-primary)', cursor: 'pointer',
            }}
          >
            <Camera size={14} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarUpload}
            style={{ display: 'none' }}
          />
        </div>

        <h3 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, marginBottom: 'var(--space-1)' }}>
          {profile?.full_name || 'Unknown'}
        </h3>
        <p style={{ color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>{profile?.email}</p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center', flexWrap: 'wrap' }}>
          <span className="badge badge-primary">{roleLabels[profile?.role || ''] || profile?.role}</span>
          {profile?.member_id && <span className="badge badge-info">{profile.member_id}</span>}
          <span className="badge badge-success">{profile?.is_active ? 'Active' : 'Inactive'}</span>
        </div>
      </div>

      {/* Profile Details / Edit Form */}
      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h3 className="card-title" style={{ marginBottom: 'var(--space-4)' }}>
          {editing ? 'Edit Profile' : 'Profile Details'}
        </h3>

        {editing ? (
          <form onSubmit={handleSave} style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <div className="input-group">
              <label className="input-label">Full Name</label>
              <div style={{ position: 'relative' }}>
                <User size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input className="input" value={editName} onChange={e => setEditName(e.target.value)} required style={{ paddingLeft: 32 }} />
              </div>
            </div>

            <div className="grid-2-col">
              <div className="input-group">
                <label className="input-label">Member ID</label>
                <div style={{ position: 'relative' }}>
                  <Hash size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                  <input className="input" value={editMemberId} onChange={e => setEditMemberId(e.target.value.toUpperCase())} placeholder="e.g. 230571F" style={{ paddingLeft: 32 }} />
                </div>
              </div>

              <div className="input-group">
                <label className="input-label">Mobile Number</label>
                <div style={{ position: 'relative' }}>
                  <Phone size={16} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                  <input className="input" type="tel" value={editPhone} onChange={e => setEditPhone(e.target.value)} placeholder="+94 77 123 4567" style={{ paddingLeft: 32 }} />
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                <X size={16} /> Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Save Changes
              </button>
            </div>
          </form>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: 'var(--space-4)' }}>
            <DetailItem icon={<Mail size={16} />} label="Email" value={profile?.email || '—'} />
            <DetailItem icon={<User size={16} />} label="Full Name" value={profile?.full_name || '—'} />
            <DetailItem icon={<Hash size={16} />} label="Member ID" value={profile?.member_id || '—'} />
            <DetailItem icon={<Phone size={16} />} label="Mobile" value={profile?.phone || '—'} />
            <DetailItem icon={<Shield size={16} />} label="Role" value={roleLabels[profile?.role || ''] || profile?.role || '—'} />
            <DetailItem icon={<Calendar size={16} />} label="Joined" value={profile?.created_at ? format(new Date(profile.created_at), 'MMM d, yyyy') : '—'} />
          </div>
        )}
      </div>

      {/* Danger Zone */}
      <div className="card" style={{ marginTop: 'var(--space-4)', borderColor: 'var(--color-danger)' }}>
        <h3 className="card-title" style={{ color: 'var(--color-danger)', marginBottom: 'var(--space-3)' }}>
          Danger Zone
        </h3>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
          Permanently delete your account and all associated data. This action cannot be undone.
        </p>
        {showDeleteConfirm ? (
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-danger)' }}>
              Are you sure? This is irreversible.
            </span>
            <button className="btn btn-danger btn-sm" onClick={handleDeleteAccount} disabled={deleting}>
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Yes, Delete
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn btn-danger" onClick={() => setShowDeleteConfirm(true)}>
            <Trash2 size={16} /> Delete Account
          </button>
        )}
      </div>
    </div>
  );
}

function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
      <div style={{
        width: 36, height: 36, borderRadius: 'var(--radius-md)',
        background: 'var(--color-primary-light)', color: 'var(--color-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {label}
        </div>
        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500, marginTop: 2 }}>
          {value}
        </div>
      </div>
    </div>
  );
}
