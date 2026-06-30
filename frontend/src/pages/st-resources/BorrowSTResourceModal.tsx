import { useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { X, Clock, Coins, Loader2, HandCoins } from 'lucide-react';

interface STResource {
  id: string;
  name: string;
  hourly_token_cost: number;
  pickup_location: string | null;
}

interface Props {
  resource: STResource;
  tokenBalance: number | null;
  onClose: () => void;
  onSuccess: () => void;
}

export function BorrowSTResourceModal({ resource, tokenBalance, onClose, onSuccess }: Props) {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  });
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [purpose, setPurpose] = useState('');
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const getDurationHours = () => {
    const startMs = new Date(`${startDate}T${startTime}:00`).getTime();
    const endMs = new Date(`${endDate}T${endTime}:00`).getTime();
    return Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60)));
  };

  const tokenCost = resource.hourly_token_cost > 0 ? Math.ceil(resource.hourly_token_cost * getDurationHours()) : 0;
  const hasEnoughTokens = tokenBalance === null || tokenCost === 0 || tokenBalance >= tokenCost;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const startMs = new Date(`${startDate}T${startTime}:00`).getTime();
    const endMs = new Date(`${endDate}T${endTime}:00`).getTime();
    if (endMs <= startMs) {
      toast('warning', 'End time must be after start time');
      return;
    }
    if (!hasEnoughTokens) {
      toast('error', `Insufficient tokens! Need ${tokenCost}, have ${tokenBalance}`);
      return;
    }

    setLoading(true);
    const res = await api.post(`/st-resources/${resource.id}/borrow`, {
      title: `Borrow: ${resource.name}`,
      purpose: purpose.trim() || null,
      start_time: new Date(`${startDate}T${startTime}:00`).toISOString(),
      end_time: new Date(`${endDate}T${endTime}:00`).toISOString(),
    });

    if (res.success) {
      const ownerInfo = (res.data as any)?.owner;
      const ownerName = ownerInfo?.full_name || 'the owner';
      toast('success', `Borrow request sent! Contact ${ownerName} for pickup.`);
      onSuccess();
    } else {
      toast('error', (res as any).error?.message || 'Failed to borrow');
    }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: '#f3e8ff', color: '#a855f7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <HandCoins size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 700 }}>Borrow Item</h2>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>{resource.name}</p>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* Pickup Location */}
          {resource.pickup_location && (
            <div style={{ padding: 'var(--space-3)', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)' }}>
              📍 Pickup: <strong>{resource.pickup_location}</strong>
            </div>
          )}

          {/* Dates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div className="input-group">
              <label className="input-label">Start Date</label>
              <input className="input" type="date" value={startDate} onChange={e => {
                setStartDate(e.target.value);
                if (endDate < e.target.value) setEndDate(e.target.value);
              }} required />
            </div>
            <div className="input-group">
              <label className="input-label">End Date</label>
              <input className="input" type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} required />
            </div>
          </div>

          {/* Times */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div className="input-group">
              <label className="input-label">Start Time</label>
              <input className="input" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required />
            </div>
            <div className="input-group">
              <label className="input-label">End Time</label>
              <input className="input" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required />
            </div>
          </div>

          {/* Duration */}
          <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Clock size={14} /> Duration: <strong>{getDurationHours()} hours</strong>
          </div>

          {/* Token Cost */}
          {resource.hourly_token_cost > 0 ? (
            <div style={{
              padding: 'var(--space-3)',
              borderRadius: 'var(--radius-md)',
              background: hasEnoughTokens ? 'var(--color-success-light)' : 'var(--color-danger-light)',
              border: `1px solid ${hasEnoughTokens ? 'var(--color-success)' : 'var(--color-danger)'}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <Coins size={16} style={{ color: hasEnoughTokens ? 'var(--color-success)' : 'var(--color-danger)' }} />
                  <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Token Cost</span>
                </div>
                <span style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)' }}>{tokenCost} tokens</span>
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 4 }}>
                {resource.hourly_token_cost} tokens/hr × {getDurationHours()}h
                {tokenBalance !== null && (
                  <span> · Balance: <strong>{tokenBalance}</strong></span>
                )}
                {!hasEnoughTokens && (
                  <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}> — Insufficient!</span>
                )}
              </div>
            </div>
          ) : (
            <div style={{ padding: 'var(--space-3)', background: 'var(--color-success-light)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)', color: '#16a34a', fontWeight: 600 }}>
              ✅ Free to borrow — no tokens required
            </div>
          )}

          {/* Purpose */}
          <div className="input-group">
            <label className="input-label">Purpose (optional)</label>
            <textarea className="input" placeholder="Why do you need this item?" value={purpose} onChange={e => setPurpose(e.target.value)} style={{ minHeight: 60 }} />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !hasEnoughTokens}
              style={{ background: '#a855f7', border: 'none' }}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : <HandCoins size={16} />}
              {loading ? 'Sending...' : 'Send Borrow Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
