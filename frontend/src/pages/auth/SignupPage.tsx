import { useState, useEffect, useRef, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { GraduationCap, Mail, Lock, User, Hash, Loader2, Eye, EyeOff, ShieldCheck, ArrowLeft } from 'lucide-react';
import { api } from '../../lib/api';

export function SignupPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [tenantCode, setTenantCode] = useState('');
  const [memberId, setMemberId] = useState('');
  const [phone, setPhone] = useState('');

  // OTP verification state
  const [step, setStep] = useState<'form' | 'verify'>('form');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [emailVerified, setEmailVerified] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { signup } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown(c => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  // Send verification OTP
  const handleSendOtp = async () => {
    if (!email || !email.includes('@')) {
      toast('warning', 'Please enter a valid email address');
      return;
    }
    if (password.length < 6) {
      toast('warning', 'Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      toast('warning', 'Passwords do not match');
      return;
    }
    if (!memberId.trim()) {
      toast('warning', 'Member ID is required');
      return;
    }
    if (!tenantCode.trim()) {
      toast('warning', 'Faculty code is required');
      return;
    }

    setOtpSending(true);
    try {
      // Pre-validate faculty code first
      const checkRes = await api.get<{ valid: boolean; tenant_name: string }>(`/users/check-tenant/${tenantCode}`);
      if (!checkRes.success || !checkRes.data?.valid) {
        toast('error', checkRes.error?.message || 'Faculty code is invalid.');
        return;
      }

      // Send verification email
      const res = await api.post('/users/send-verification', { email });
      if (res.success) {
        toast('success', `Verification code sent to ${email}`);
        setStep('verify');
        setCountdown(600); // 10 minutes
        setOtp(['', '', '', '', '', '']);
        setTimeout(() => otpRefs.current[0]?.focus(), 100);
      } else {
        toast('error', res.error?.message || 'Failed to send verification code');
      }
    } catch (err: any) {
      toast('error', err.message || 'Failed to send verification code');
    } finally {
      setOtpSending(false);
    }
  };

  // Handle OTP input
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const paste = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (paste.length === 6) {
      setOtp(paste.split(''));
      otpRefs.current[5]?.focus();
    }
  };

  // Verify OTP then create account
  const handleVerifyAndSignup = async () => {
    const code = otp.join('');
    if (code.length !== 6) {
      toast('warning', 'Please enter the complete 6-digit code');
      return;
    }

    setOtpVerifying(true);
    try {
      // 1. Verify the OTP
      const verifyRes = await api.post('/users/verify-email', { email, code });
      if (!verifyRes.success) {
        toast('error', (verifyRes as any).error?.message || 'Invalid verification code');
        return;
      }

      setEmailVerified(true);

      // 2. Create account via Firebase + backend signup
      await signup(email, password, tenantCode, fullName, memberId, phone);
      toast('success', 'Account created successfully! Welcome to CampusRSO');
      navigate('/');
    } catch (err: any) {
      const msg = err.code === 'auth/email-already-in-use'
        ? 'An account with this email already exists'
        : err.message || 'Signup failed. Please try again.';
      toast('error', msg);
    } finally {
      setOtpVerifying(false);
    }
  };

  // Resend OTP
  const handleResend = async () => {
    setOtpSending(true);
    try {
      const res = await api.post('/users/send-verification', { email });
      if (res.success) {
        toast('success', 'New verification code sent!');
        setCountdown(600);
        setOtp(['', '', '', '', '', '']);
        otpRefs.current[0]?.focus();
      } else {
        toast('error', res.error?.message || 'Failed to resend code');
      }
    } catch {
      toast('error', 'Failed to resend code');
    } finally {
      setOtpSending(false);
    }
  };

  const formatCountdown = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <GraduationCap size={28} />
          </div>
          <h1 className="auth-title">
            {step === 'form' ? 'Create Account' : 'Verify Email'}
          </h1>
          <p className="auth-subtitle">
            {step === 'form'
              ? 'Join your faculty on CampusRSO'
              : `Enter the 6-digit code sent to ${email}`
            }
          </p>
        </div>

        {step === 'form' ? (
          /* ── Step 1: Registration Form ── */
          <form className="auth-form" onSubmit={(e: FormEvent) => { e.preventDefault(); handleSendOtp(); }}>
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
                <input id="signup-email" className="input" type="email" placeholder="you@gmail.com or you@uom.lk" value={email} onChange={e => setEmail(e.target.value)} required style={{ paddingLeft: 40 }} />
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
              <label className="input-label" htmlFor="signup-confirm-password">Re-enter Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input
                  id="signup-confirm-password"
                  className="input"
                  type={showConfirmPassword ? 'text' : 'password'}
                  placeholder="Confirm your password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  style={{ paddingLeft: 40, paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0 }}
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
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

            <button className="btn btn-primary btn-full btn-lg" type="submit" disabled={otpSending}>
              {otpSending ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
              {otpSending ? 'Sending Code...' : 'Send Verification Code'}
            </button>
          </form>
        ) : (
          /* ── Step 2: OTP Verification ── */
          <div className="auth-form" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            {/* OTP Visual */}
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '50%',
                background: emailVerified ? 'var(--color-success-bg, #dcfce7)' : 'var(--color-primary-bg, #e0e7ff)',
                color: emailVerified ? 'var(--color-success, #16a34a)' : 'var(--color-primary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto var(--space-4)',
                transition: 'all 0.3s ease',
              }}>
                {emailVerified ? <ShieldCheck size={28} /> : <Mail size={28} />}
              </div>
            </div>

            {/* OTP Input */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 'var(--space-2)' }} onPaste={handleOtpPaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { otpRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpChange(i, e.target.value)}
                  onKeyDown={e => handleOtpKeyDown(i, e)}
                  disabled={otpVerifying || emailVerified}
                  style={{
                    width: 48, height: 56,
                    textAlign: 'center',
                    fontSize: 'var(--font-size-xl)',
                    fontWeight: 700,
                    border: `2px solid ${digit ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-bg-elevated)',
                    color: 'var(--color-text)',
                    outline: 'none',
                    transition: 'border-color 0.2s ease',
                  }}
                />
              ))}
            </div>

            {/* Countdown */}
            {countdown > 0 && !emailVerified && (
              <p style={{ textAlign: 'center', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
                Code expires in <span style={{ fontWeight: 600, color: countdown < 60 ? 'var(--color-danger)' : 'var(--color-primary)' }}>{formatCountdown(countdown)}</span>
              </p>
            )}

            {/* Verify Button */}
            <button
              className="btn btn-primary btn-full btn-lg"
              onClick={handleVerifyAndSignup}
              disabled={otpVerifying || otp.join('').length !== 6 || emailVerified}
            >
              {otpVerifying ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
              {otpVerifying ? 'Verifying & Creating Account...' : 'Verify & Create Account'}
            </button>

            {/* Resend / Back */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { setStep('form'); setEmailVerified(false); }}
                disabled={otpVerifying}
              >
                <ArrowLeft size={14} /> Back
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleResend}
                disabled={otpSending || otpVerifying || countdown > 540}
                style={{ fontSize: 'var(--font-size-xs)' }}
              >
                {otpSending ? <Loader2 size={14} className="animate-spin" /> : null}
                Resend Code
              </button>
            </div>
          </div>
        )}

        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
