import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { ImageCropModal } from '../../components/ImageCropModal';
import {
  ArrowLeft, Loader2, Monitor, MapPin, Users, DollarSign, FileText, Beaker, Presentation, Laptop, Wrench, Check, Building, BookOpen, Share2, ImagePlus, X
} from 'lucide-react';

const resourceTypes = [
  { value: 'lab', label: 'Laboratory', icon: Beaker, color: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
  { value: 'lecture_hall', label: 'Lecture Hall', icon: Presentation, color: 'var(--color-success)', bg: 'var(--color-success-light)' },
  { value: 'equipment', label: 'Equipment', icon: Laptop, color: 'var(--color-warning)', bg: 'var(--color-warning-light)' },
  { value: 'meeting_room', label: 'Meeting Room', icon: Monitor, color: 'var(--color-info)', bg: 'var(--color-info-light)' },
  { value: 'other', label: 'Other', icon: Wrench, color: 'var(--color-text-muted)', bg: 'var(--color-bg-glass)' },
];

const stSuggestions = [
  'Old Notebooks', 'Short Notes', 'Past Papers', 'Circuit Boards', 'Calculators',
  'Lab Coats', 'Drawing Tools', 'Arduino Kits', 'Breadboards', 'Multimeters',
  'Textbooks', 'Reference Books', 'USB Drives', 'Soldering Kits', 'Raspberry Pi',
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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { claims } = useAuth();
  const isStudent = claims?.app_role === 'student';

  useEffect(() => {
    if (claims?.app_role === 'main_admin') {
      api.get<any[]>('/tenants').then(res => {
        if (res.success && Array.isArray(res.data)) {
          setTenants(res.data);
        }
      });
    }
    // Auto-set type for students
    if (isStudent) {
      setResourceType('student_resource');
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
    // Create a minimal File-like reference for the upload
    setImageFile(new File([], filename));
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  const uploadImage = async (resourceId: string) => {
    if (!imageFile || !imagePreview) return;
    await api.post(`/resources/${resourceId}/image`, {
      image: imagePreview,
      filename: imageFile.name,
    });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name || (!isStudent && !resourceType)) {
      toast('warning', 'Name and resource type are required');
      return;
    }

    setLoading(true);
    
    let computedCategory: string;
    let computedType: string;

    if (isStudent) {
      computedCategory = 'ST_RESOURCE';
      computedType = 'student_resource';
    } else {
      computedType = resourceType;
      if (resourceType === 'lab') computedCategory = 'LAB';
      else if (resourceType === 'equipment' || resourceType === 'other') computedCategory = 'EQUIPMENT';
      else computedCategory = 'HALL';
    }

    const payload: any = {
      name,
      resource_type: computedType,
      category: computedCategory,
      capacity: capacity ? parseInt(capacity) : 1,
      location: location || undefined,
      equipment_features: equipmentFeatures ? equipmentFeatures.split(',').map(s => s.trim()) : undefined,
      hourly_cost: hourlyCost ? parseFloat(hourlyCost) : undefined,
    };

    if (claims?.app_role === 'main_admin') {
      payload.tenant_id = selectedTenant === 'none' ? null : selectedTenant;
    }

    const res = await api.post('/resources', payload);

    if (res.success) {
      // Upload image if selected
      if (imageFile && (res.data as any)?.id) {
        try {
          await uploadImage((res.data as any).id);
        } catch {
          toast('warning', 'Resource created but image upload failed');
        }
      }
      toast('success', isStudent ? 'Your resource has been shared!' : 'Resource created successfully!');
      navigate('/resources');
    } else {
      toast('error', res.error?.message || 'Failed to create resource');
    }
    setLoading(false);
  };

  // Shared image upload UI component
  const ImageUploadField = () => (
    <div className="input-group">
      <label className="input-label">Image (optional, max 5MB)</label>
      {imagePreview ? (
        <div style={{ position: 'relative', display: 'inline-block' }}>
          <img
            src={imagePreview}
            alt="Preview"
            style={{
              width: '100%', maxHeight: 200, objectFit: 'cover',
              borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
            }}
          />
          <button
            type="button"
            onClick={removeImage}
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
  );

  // ========== STUDENT MODE ==========
  if (isStudent) {
    return (
      <>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <button className="btn btn-ghost" onClick={() => navigate('/resources')} style={{ marginBottom: 'var(--space-4)' }}>
            <ArrowLeft size={18} /> Back to Resources
          </button>

          <div className="card form-card" style={{ borderTop: '4px solid #a855f7' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              <div style={{ width: 44, height: 44, borderRadius: 'var(--radius-md)', background: '#f3e8ff', color: '#a855f7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Share2 size={24} />
              </div>
              <div>
                <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700 }}>Share Your Resource</h2>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>
                  List an item for other students to borrow
                </p>
              </div>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', marginTop: 'var(--space-6)' }}>
              {/* Suggested Items */}
              <div>
                <label className="input-label" style={{ marginBottom: 'var(--space-3)', display: 'block' }}>Quick Pick (or type your own below)</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                  {stSuggestions.map(s => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => setName(s)}
                      className="btn"
                      style={{
                        fontSize: 'var(--font-size-xs)',
                        padding: '6px 12px',
                        borderRadius: 'var(--radius-full)',
                        background: name === s ? '#a855f7' : '#f3e8ff',
                        color: name === s ? 'white' : '#a855f7',
                        border: 'none',
                        fontWeight: 500,
                        transition: 'all 200ms ease',
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Name */}
              <div className="input-group">
                <label className="input-label" htmlFor="st-name">Resource Name *</label>
                <div style={{ position: 'relative' }}>
                  <BookOpen size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                  <input id="st-name" className="input" placeholder="e.g., Data Structures Notebook" value={name} onChange={e => setName(e.target.value)} required style={{ paddingLeft: 40 }} />
                </div>
              </div>

              {/* Image Upload */}
              <ImageUploadField />

              {/* Location */}
              <div className="input-group">
                <label className="input-label" htmlFor="st-location">Pickup Location</label>
                <div style={{ position: 'relative' }}>
                  <MapPin size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                  <input id="st-location" className="input" placeholder="e.g., Library, Block C lobby" value={location} onChange={e => setLocation(e.target.value)} style={{ paddingLeft: 40 }} />
                </div>
              </div>

              {/* Description / Features */}
              <div className="input-group">
                <label className="input-label" htmlFor="st-features">Description / Condition</label>
                <div style={{ position: 'relative' }}>
                  <FileText size={18} style={{ position: 'absolute', left: 12, top: 14, color: 'var(--color-text-muted)' }} />
                  <textarea id="st-features" className="input" placeholder="Describe condition, edition, or details (comma-separated tags)" value={equipmentFeatures} onChange={e => setEquipmentFeatures(e.target.value)} style={{ paddingLeft: 40, minHeight: 80 }} />
                </div>
              </div>

              {/* Hourly Token Cost */}
              <div className="input-group">
                <label className="input-label" htmlFor="st-cost">Hourly Token Cost</label>
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-2)' }}>
                  How many tokens per hour should borrowers pay? (Leave empty for free)
                </p>
                <div style={{ position: 'relative' }}>
                  <DollarSign size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                  <input id="st-cost" className="input" type="number" step="1" min="0" placeholder="e.g., 5" value={hourlyCost} onChange={e => setHourlyCost(e.target.value)} style={{ paddingLeft: 40 }} />
                </div>
              </div>

              {/* Submit */}
              <button className="btn btn-lg btn-full" type="submit" disabled={loading} style={{ marginTop: 'var(--space-2)', background: '#a855f7', color: 'white', border: 'none' }}>
                {loading ? <Loader2 size={18} className="animate-spin" /> : <Share2 size={18} />}
                {loading ? 'Sharing...' : 'Share Resource'}
              </button>
            </form>
          </div>
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

  // ========== ADMIN MODE ==========
  return (
    <>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <button className="btn btn-ghost" onClick={() => navigate('/resources')} style={{ marginBottom: 'var(--space-4)' }}>
          <ArrowLeft size={18} /> Back to Resources
        </button>

        <div className="card form-card">
          <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>Add New Resource</h2>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)', fontSize: 'var(--font-size-sm)' }}>
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

            {/* Image Upload */}
            <ImageUploadField />

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
            <div className="grid-2-col">
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
                <label className="input-label" htmlFor="res-cost">Hourly Token Cost</label>
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
