import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { useToast } from '../../contexts/ToastContext';
import { CalendarDays, Clock, Users, FileText, ArrowLeft, Loader2, Check, Coins } from 'lucide-react';

import { useAuth } from '../../contexts/AuthContext';

interface Resource {
  id: string;
  name: string;
  category: string;
  capacity: number;
  location: string;
  hourly_cost: number | null;
}

export function NewBookingPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceId, setResourceId] = useState('');
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [attendeeCount, setAttendeeCount] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [tokenBalance, setTokenBalance] = useState<number | null>(null);
  const [monthlyQuota, setMonthlyQuota] = useState<number | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { claims } = useAuth();

  const isStudent = claims.app_role === 'student';

  useEffect(() => {
    api.get<Resource[]>('/resources').then(res => {
      setResources(Array.isArray(res.data) ? res.data : []);
    });
    // Default to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setDate(tomorrow.toISOString().split('T')[0]);

    // Fetch token balance for students
    if (isStudent) {
      api.get<any>('/users/me/tokens').then(res => {
        if (res.success && res.data?.balance) {
          setTokenBalance(res.data.balance.balance);
          setMonthlyQuota(res.data.balance.monthly_quota);
        }
      });
    }
  }, []);

  const selectedResource = resources.find(r => r.id === resourceId);
  const filteredResources = isStudent ? resources.filter(r => r.category === 'EQUIPMENT') : resources;

  // Calculate token cost
  const calculateTokenCost = () => {
    if (!selectedResource?.hourly_cost || !isStudent) return 0;
    const startMs = new Date(`${date}T${startTime}:00`).getTime();
    const endMs = new Date(`${date}T${endTime}:00`).getTime();
    const hours = Math.max(1, Math.ceil((endMs - startMs) / (1000 * 60 * 60)));
    return Math.ceil(selectedResource.hourly_cost * hours);
  };

  const tokenCost = calculateTokenCost();
  const hasEnoughTokens = tokenBalance === null || tokenBalance >= tokenCost;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!resourceId || !title || !date || !startTime || !endTime) {
      toast('warning', 'Please fill all required fields');
      return;
    }

    if (isStudent && !hasEnoughTokens) {
      toast('error', `Insufficient tokens! Need ${tokenCost}, have ${tokenBalance}`);
      return;
    }

    setLoading(true);
    const start_time = new Date(`${date}T${startTime}:00`).toISOString();
    const end_time = new Date(`${date}T${endTime}:00`).toISOString();

    const res = await api.post('/bookings', {
      resource_id: resourceId,
      title,
      purpose,
      start_time,
      end_time,
      attendee_count: attendeeCount ? parseInt(attendeeCount) : undefined,
    });

    if (res.success) {
      toast('success', 'Booking created successfully!');
      navigate('/bookings');
    } else {
      const msg = res.error?.message || 'Failed to create booking';
      toast('error', msg);
    }
    setLoading(false);
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <button className="btn btn-ghost" onClick={() => navigate('/bookings')} style={{ marginBottom: 'var(--space-4)' }}>
        <ArrowLeft size={18} /> Back to Bookings
      </button>

      <div className="card" style={{ padding: 'var(--space-8)' }}>
        <h2 style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>New Booking</h2>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)', fontSize: 'var(--font-size-sm)' }}>
          Reserve a resource for your event or class
        </p>

        {/* Student Token Balance Banner */}
        {isStudent && tokenBalance !== null && (
          <div style={{
            padding: 'var(--space-4)',
            background: 'linear-gradient(135deg, var(--color-primary-light), var(--color-info-light))',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 'var(--space-6)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
          }}>
            <div style={{
              width: 44, height: 44, borderRadius: 'var(--radius-md)',
              background: 'var(--color-primary)', color: 'white',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Coins size={22} />
            </div>
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Token Balance</div>
              <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700 }}>
                {tokenBalance} <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 400, color: 'var(--color-text-secondary)' }}>/ {monthlyQuota} monthly</span>
              </div>
            </div>
          </div>
        )}

        {/* Progress */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-8)' }}>
          {[1, 2, 3].map(s => (
            <div key={s} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: s <= step ? 'var(--color-primary)' : 'var(--color-bg-glass)',
              transition: 'background 300ms ease',
            }} />
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {step === 1 && (
            <div className="animate-fadeInUp">
              <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>
                Select Resource
              </h3>
              {isStudent && (
                <div style={{ padding: 'var(--space-3)', background: 'var(--color-warning-light)', color: '#b45309', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-sm)' }}>
                  🎓 As a student, you are only permitted to book EQUIPMENT resources. Tokens will be deducted based on hourly rate × duration.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {filteredResources.length === 0 ? (
                  <div style={{ padding: 'var(--space-4)', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
                    No available resources found matching your permissions.
                  </div>
                ) : filteredResources.map(r => (
                  <button
                    type="button"
                    key={r.id}
                    className="card"
                    onClick={() => { setResourceId(r.id); setStep(2); }}
                    style={{
                      padding: 'var(--space-4)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      borderColor: resourceId === r.id ? 'var(--color-primary)' : undefined,
                      background: resourceId === r.id ? 'var(--color-primary-light)' : undefined,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{r.name}</div>
                        <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
                          {r.category} · {r.location} · {r.capacity} seats
                          {isStudent && r.hourly_cost ? (
                            <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}> · 🪙 {r.hourly_cost} tokens/hr</span>
                          ) : null}
                        </div>
                      </div>
                      {resourceId === r.id && <Check size={18} style={{ color: 'var(--color-primary)' }} />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="animate-fadeInUp" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>
                Date & Time
              </h3>

              {selectedResource && (
                <div style={{ padding: 'var(--space-3) var(--space-4)', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-sm)' }}>
                  📍 {selectedResource.name} — {selectedResource.location}
                </div>
              )}

              <div className="input-group">
                <label className="input-label">Date</label>
                <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} required />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                <div className="input-group">
                  <label className="input-label">Start Time</label>
                  <input className="input" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} required />
                </div>
                <div className="input-group">
                  <label className="input-label">End Time</label>
                  <input className="input" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} required />
                </div>
              </div>

              {/* Token Cost Preview for Students */}
              {isStudent && selectedResource?.hourly_cost && date && startTime && endTime && (
                <div style={{
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  background: hasEnoughTokens ? 'var(--color-success-light)' : 'var(--color-danger-light)',
                  border: `1px solid ${hasEnoughTokens ? 'var(--color-success)' : 'var(--color-danger)'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <Coins size={18} style={{ color: hasEnoughTokens ? 'var(--color-success)' : 'var(--color-danger)' }} />
                      <span style={{ fontWeight: 600, fontSize: 'var(--font-size-sm)' }}>Token Cost</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 'var(--font-size-lg)' }}>
                      🪙 {tokenCost}
                    </div>
                  </div>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                    {selectedResource.hourly_cost} tokens/hr × {Math.max(1, Math.ceil((new Date(`${date}T${endTime}:00`).getTime() - new Date(`${date}T${startTime}:00`).getTime()) / 3600000))} hours
                    {!hasEnoughTokens && (
                      <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}> — Insufficient! You have {tokenBalance} tokens</span>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>Back</button>
                <button type="button" className="btn btn-primary" onClick={() => setStep(3)} disabled={isStudent && !hasEnoughTokens}>Continue</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="animate-fadeInUp" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
              <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600 }}>
                Details
              </h3>

              <div className="input-group">
                <label className="input-label">Booking Title *</label>
                <input className="input" placeholder="e.g., Data Structures Lecture" value={title} onChange={e => setTitle(e.target.value)} required />
              </div>

              <div className="input-group">
                <label className="input-label">Purpose (optional)</label>
                <textarea className="input" placeholder="Describe the event purpose..." value={purpose} onChange={e => setPurpose(e.target.value)} />
              </div>

              <div className="input-group">
                <label className="input-label">Expected Attendees</label>
                <input className="input" type="number" placeholder="e.g., 30" value={attendeeCount} onChange={e => setAttendeeCount(e.target.value)} />
              </div>

              {/* Summary */}
              <div className="card" style={{ background: 'var(--color-bg-glass)', padding: 'var(--space-4)' }}>
                <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: 1 }}>Booking Summary</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 'var(--font-size-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><FileText size={14} style={{ color: 'var(--color-text-muted)' }} /> {selectedResource?.name}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><CalendarDays size={14} style={{ color: 'var(--color-text-muted)' }} /> {date}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><Clock size={14} style={{ color: 'var(--color-text-muted)' }} /> {startTime} – {endTime}</div>
                  {attendeeCount && <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}><Users size={14} style={{ color: 'var(--color-text-muted)' }} /> {attendeeCount} attendees</div>}
                  {isStudent && tokenCost > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-primary)', fontWeight: 600 }}>
                      <Coins size={14} /> {tokenCost} tokens will be deducted (50% refund on cancel)
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setStep(2)}>Back</button>
                <button className="btn btn-primary btn-lg" type="submit" disabled={loading || (isStudent && !hasEnoughTokens)}>
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <CalendarDays size={18} />}
                  {loading ? 'Creating...' : 'Create Booking'}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
