import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { ImageCropModal } from '../../components/ImageCropModal';
import {
  ArrowLeft, Loader2, Monitor, Beaker, Presentation, Laptop, Wrench, Check, Building, ImagePlus, X
} from 'lucide-react';

const resourceTypes = [
  { value: 'lab', label: 'Laboratory', icon: Beaker, color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
  { value: 'lecture_hall', label: 'Lecture Hall', icon: Presentation, color: 'var(--color-success)', bg: 'var(--color-success-light)' },
  { value: 'equipment', label: 'Equipment', icon: Laptop, color: 'var(--color-warning)', bg: 'var(--color-warning-light)' },
  { value: 'meeting_room', label: 'Meeting Room', icon: Monitor, color: 'var(--color-info)', bg: 'var(--color-info-light)' },
  { value: 'other', label: 'Other', icon: Wrench, color: 'var(--color-text-muted)', bg: 'var(--color-bg-glass)' },
];

export function EditResourcePage() {
  const { id } = useParams<{ id: string }>();
  const [name, setName] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [capacity, setCapacity] = useState('');
  const [location, setLocation] = useState('');
  const [equipmentFeatures, setEquipmentFeatures] = useState('');
  const [hourlyCost, setHourlyCost] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [tenants, setTenants] = useState<any[]>([]);
  const [selectedTenant, setSelectedTenant] = useState('none');
  const [existingImageUrl, setExistingImageUrl] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { claims } = useAuth();

  useEffect(() => {
    if (claims && claims.app_role !== 'main_admin' && claims.app_role !== 'tenant_admin') {
      navigate('/resources');
    }
  }, [claims, navigate]);

  useEffect(() => {
    if (!id) return;
    api.get(`/resources/${id}`)
      .then(res => {
        if (res.success) {
          const data = res.data as any;
          setName(data.name || '');
          setResourceType(data.resource_type || '');
          setCapacity(data.capacity ? String(data.capacity) : '');
          setLocation(data.location || '');
          setEquipmentFeatures(
            Array.isArray(data.equipment_features) 
              ? data.equipment_features.join(', ') 
              : (data.equipment_features || '')
          );
          setHourlyCost(data.hourly_cost ? String(data.hourly_cost) : '');
          setSelectedTenant(data.tenant_id || 'none');
          if (data.image_url) {
            setExistingImageUrl(data.image_url);
          }
        }
      })
      .catch(err => {
        console.error(err);
        toast('error', 'Failed to load resource');
        navigate('/resources');
      })
      .finally(() => setFetching(false));
  }, [id, navigate, toast]);

  useEffect(() => {
    if (claims?.app_role === 'main_admin') {
      api.get<any[]>('/tenants').then(res => {
        if (res.success && Array.isArray(res.data)) {
          setTenants(res.data);
        }
      });
    }
  }, [claims]);

  const [cropFile, setCropFile] = useState<File | null>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast('warning', 'Image must be 5MB or less');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast('warning', 'Please select an image file');
      return;
    }
    setCropFile(file);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const handleCropComplete = (base64: string, filename: string) => {
    setCropFile(null);
    setImagePreview(base64);
    setImageFile(new File([], filename));
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const getDisplayImageUrl = () => {
    if (imagePreview) return imagePreview;
    if (existingImageUrl) {
      if (existingImageUrl.startsWith('/uploads/')) {
        return `${window.location.origin}${existingImageUrl}`;
      }
      return existingImageUrl;
    }
    return null;
  };

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

    try {
      const res = await api.put(`/resources/${id}`, payload);
      if (res.success) {
        // Upload new image if selected
        if (imageFile && imagePreview) {
          try {
            await api.post(`/resources/${id}/image`, {
              image: imagePreview,
              filename: imageFile.name,
            });
          } catch {
            toast('warning', 'Resource updated but image upload failed');
          }
        }
        toast('success', 'Resource updated successfully!');
        navigate('/resources');
      } else {
        toast('error', res.error?.message || 'Failed to update resource');
      }
    } catch (error: any) {
      toast('error', 'Failed to update resource');
    }
    setLoading(false);
  };

  const displayImage = getDisplayImageUrl();

  return (
    <>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button className="btn btn-ghost" onClick={() => navigate('/resources')} style={{ marginBottom: 'var(--space-4)' }}>
          <ArrowLeft size={18} /> Back to Resources
        </button>

      <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>Edit Resource</h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>Update resource details and availability</p>
      </div>

      {fetching ? (
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card form-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
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

          <div className="input-group">
            <label className="input-label" htmlFor="res-name">Resource Name *</label>
            <div style={{ position: 'relative' }}>
              <Monitor size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input id="res-name" className="input" placeholder="e.g., Computer Lab A" value={name} onChange={e => setName(e.target.value)} required style={{ paddingLeft: 40 }} />
            </div>
          </div>

          {/* Image Upload */}
          <div className="input-group">
            <label className="input-label">Image (optional, max 1MB)</label>
            {displayImage ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img
                  src={displayImage}
                  alt="Resource"
                  style={{
                    width: '100%', maxHeight: 200, objectFit: 'cover',
                    borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => { removeImage(); setExistingImageUrl(null); }}
                  style={{
                    position: 'absolute', top: 8, right: 8,
                    width: 28, height: 28, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.6)', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: 'none', cursor: 'pointer',
                  }}
                >
                  <X size={14} />
                </button>
                {existingImageUrl && !imagePreview && (
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    style={{
                      position: 'absolute', bottom: 8, right: 8,
                      padding: '4px 10px', borderRadius: 'var(--radius-md)',
                      background: 'rgba(0,0,0,0.6)', color: 'white',
                      border: 'none', cursor: 'pointer', fontSize: 'var(--font-size-xs)',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <ImagePlus size={12} /> Change
                  </button>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                style={{
                  width: '100%', padding: 'var(--space-6)',
                  border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg-glass)', cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)',
                  color: 'var(--color-text-muted)', transition: 'border-color 200ms ease',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--color-primary)')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
              >
                <ImagePlus size={24} />
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>Click to upload an image</span>
                <span style={{ fontSize: 'var(--font-size-xs)' }}>JPG, PNG, WebP, GIF — Max 1MB</span>
              </button>
            )}
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleImageSelect}
              style={{ display: 'none' }}
            />
          </div>

          {claims?.app_role === 'main_admin' && (
            <div className="input-group">
              <label className="input-label" htmlFor="res-tenant">Assigned Faculty / Tenant</label>
              <div style={{ position: 'relative' }}>
                <Building size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)', zIndex: 1 }} />
                <select id="res-tenant" className="input" value={selectedTenant} onChange={e => setSelectedTenant(e.target.value)} style={{ paddingLeft: 40 }}>
                  <option value="none">Campus Wide (No Specific Faculty)</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="grid-2-col">
            <div className="input-group">
              <label className="input-label" htmlFor="res-location">Location</label>
              <input id="res-location" className="input" placeholder="Room 201" value={location} onChange={e => setLocation(e.target.value)} />
            </div>
            <div className="input-group">
              <label className="input-label" htmlFor="res-capacity">Capacity</label>
              <input id="res-capacity" className="input" type="number" placeholder="40" value={capacity} onChange={e => setCapacity(e.target.value)} />
            </div>
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="res-features">Equipment & Features</label>
            <textarea id="res-features" className="input" placeholder="Projector, Whiteboard" value={equipmentFeatures} onChange={e => setEquipmentFeatures(e.target.value)} style={{ minHeight: 80 }} />
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="res-cost">Hourly Cost</label>
            <input id="res-cost" className="input" type="number" step="0.01" placeholder="0.00" value={hourlyCost} onChange={e => setHourlyCost(e.target.value)} />
          </div>

          <button className="btn btn-primary btn-lg btn-full" type="submit" disabled={loading} style={{ marginTop: 'var(--space-2)' }}>
            {loading ? <Loader2 size={18} className="animate-spin" /> : 'Save Changes'}
          </button>
        </form>
      )}
      </div>
      {cropFile && (
        <ImageCropModal
          file={cropFile}
          aspectRatio={16 / 9}
          maxOutputSize={800}
          onCrop={handleCropComplete}
          onCancel={() => setCropFile(null)}
        />
      )}
    </>
  );
}
