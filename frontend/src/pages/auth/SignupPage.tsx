import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { GraduationCap, Mail, Lock, User, Hash, Loader2, Eye, EyeOff } from 'lucide-react';
import { api } from '../../lib/api';

export function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [tenantCode, setTenantCode] = useState('');
  const [memberId, setMemberId] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const { signup } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      toast('warning', 'Password must be at least 6 characters');
      return;
    }
    if (!memberId.trim()) {
      toast('warning', 'Member ID is required');
      return;
    }
    
    setLoading(true);
    try {
      // 1. Pre-validate faculty code
      const checkRes = await api.get<{ valid: boolean; tenant_name: string }>(`/users/check-tenant/${tenantCode}`);
      if (!checkRes.success || !checkRes.data?.valid) {
        toast('error', checkRes.error?.message || 'Faculty code is invalid. Please check your faculty code.');
        setLoading(false);
        return;
      }
      
      // 2. Proceed with signup
      await signup(email, password, tenantCode, fullName, memberId, phone);
      toast('success', `Account created! Welcome to ${checkRes.data.tenant_name}`);
      navigate('/');
    } catch (err: any) {
      const msg = err.code === 'auth/email-already-in-use' ? 'Email already in use'
        : err.message || 'Signup failed. Please try again.';
      toast('error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <GraduationCap size={28} />
          </div>
          <h1 className="auth-title">Create Account</h1>
          <p className="auth-subtitle">Join your faculty on CampusRSO</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label" htmlFor="signup-name">Full Name</label>
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input id="signup-name" className="input" type="text" placeholder="John Doe" value={fullName} onChange={e => setFullName(e.target.value)} required style={{ paddingLeft: 40 }} />
            </div>
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="signup-email">Email</label>
            <div style={{ position: 'relative' }}>
              <Mail size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input id="signup-email" className="input" type="email" placeholder="you@university.edu" value={email} onChange={e => setEmail(e.target.value)} required style={{ paddingLeft: 40 }} />
            </div>
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="signup-password">Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input 
                id="signup-password" 
                className="input" 
                type={showPassword ? 'text' : 'password'} 
                placeholder="Min 6 characters" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                required 
                style={{ paddingLeft: 40, paddingRight: 40 }} 
              />
              <button 
                type="button" 
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0 }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="signup-code">Faculty Code</label>
            <div style={{ position: 'relative' }}>
              <Hash size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input id="signup-code" className="input" type="text" placeholder="Enter code from admin" value={tenantCode} onChange={e => setTenantCode(e.target.value)} required style={{ paddingLeft: 40 }} />
            </div>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Ask your department admin for the faculty code
            </span>
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="signup-member-id">Member ID *</label>
            <div style={{ position: 'relative' }}>
              <Hash size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input id="signup-member-id" className="input" type="text" placeholder="e.g. 230571F" value={memberId} onChange={e => setMemberId(e.target.value.toUpperCase())} required style={{ paddingLeft: 40 }} />
            </div>
            <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Your unique university member ID
            </span>
          </div>

          <div className="input-group">
            <label className="input-label" htmlFor="signup-phone">Mobile Number <span style={{ color: 'var(--color-text-muted)' }}>(optional)</span></label>
            <div style={{ position: 'relative' }}>
              <Hash size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input id="signup-phone" className="input" type="tel" placeholder="+94 77 123 4567" value={phone} onChange={e => setPhone(e.target.value)} style={{ paddingLeft: 40 }} />
            </div>
          </div>

          <button className="btn btn-primary btn-full btn-lg" type="submit" disabled={loading}>
            {loading ? <Loader2 size={18} className="animate-spin" /> : null}
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
