import { useState, useRef, useEffect, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../lib/api';
import { GraduationCap, Mail, Hash, Lock, Loader2, ArrowLeft, Eye, EyeOff, ShieldCheck, CheckCircle2 } from 'lucide-react';

type Step = 'request' | 'verify' | 'success';

export function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>('request');
  const [email, setEmail] = useState('');
  const [memberId, setMemberId] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Countdown timer for resend
  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // ── Step 1: Send reset code ──
  const handleSendCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) { toast('error', 'Please enter a valid email'); return; }
    if (!memberId.trim()) { toast('error', 'Please enter your Member ID'); return; }

    setSending(true);
    try {
      const res = await api.post<any>('/users/forgot-password', {
        email: email.trim(),
        member_id: memberId.trim(),
      });
      if (res.success) {
        toast('success', 'Reset code sent to your email');
        setStep('verify');
        setCountdown(60);
        setTimeout(() => otpRefs.current[0]?.focus(), 200);
      } else {
        toast('error', res.error?.message || 'Failed to send reset code');
      }
    } catch {
      toast('error', 'Network error. Please try again.');
    } finally {
      setSending(false);
    }
  };

  // ── OTP input handlers ──
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[index] = value.slice(-1);
    setOtp(next);
    if (value && index < 5) otpRefs.current[index + 1]?.focus();
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(''));
      otpRefs.current[5]?.focus();
    }
  };

  // ── Resend code ──
  const handleResend = async () => {
    if (countdown > 0) return;
    setSending(true);
    try {
      const res = await api.post<any>('/users/forgot-password', {
        email: email.trim(),
        member_id: memberId.trim(),
      });
      if (res.success) {
        toast('success', 'New code sent');
        setCountdown(60);
        setOtp(['', '', '', '', '', '']);
        otpRefs.current[0]?.focus();
      } else {
        toast('error', res.error?.message || 'Failed to resend');
      }
    } catch {
      toast('error', 'Network error');
    } finally {
      setSending(false);
    }
  };

  // ── Step 2: Reset password ──
  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    const code = otp.join('');
    if (code.length !== 6) { toast('error', 'Please enter the full 6-digit code'); return; }
    if (newPassword.length < 6) { toast('error', 'Password must be at least 6 characters'); return; }
    if (newPassword !== confirmPassword) { toast('error', 'Passwords do not match'); return; }

    setResetting(true);
    try {
      const res = await api.post<any>('/users/reset-password', {
        email: email.trim(),
        code,
        new_password: newPassword,
      });
      if (res.success) {
        toast('success', 'Password reset successfully!');
        setStep('success');
      } else {
        toast('error', res.error?.message || 'Failed to reset password');
      }
    } catch {
      toast('error', 'Network error. Please try again.');
    } finally {
      setResetting(false);
    }
  };

  // ── Success Screen ──
  if (step === 'success') {
    return (
      <div className="auth-layout">
        <div className="auth-card">
          <div className="auth-logo">
            <div style={{
              width: 64, height: 64, borderRadius: '50%',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 16px',
            }}>
              <CheckCircle2 size={32} style={{ color: '#fff' }} />
            </div>
            <h1 className="auth-title">Password Reset</h1>
            <p className="auth-subtitle">
              Your password has been reset successfully. You can now sign in with your new password.
            </p>
          </div>
          <button
            className="btn btn-primary btn-full btn-lg"
            onClick={() => navigate('/login')}
            style={{ marginTop: 'var(--space-4)' }}
          >
            Go to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            {step === 'request' ? <GraduationCap size={28} /> : <ShieldCheck size={28} />}
          </div>
          <h1 className="auth-title">
            {step === 'request' ? 'Forgot Password' : 'Reset Password'}
          </h1>
          <p className="auth-subtitle">
            {step === 'request'
              ? 'Enter your registered email and member ID to receive a reset code'
              : `Enter the 6-digit code sent to ${email}`
            }
          </p>
        </div>

        {/* ── Step 1: Request Code ── */}
        {step === 'request' && (
          <form className="auth-form" onSubmit={handleSendCode}>
            <div className="input-group">
              <label className="input-label" htmlFor="fp-email">Registered Email</label>
              <div style={{ position: 'relative' }}>
                <Mail size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input
                  id="fp-email"
                  className="input"
                  type="email"
                  placeholder="you@university.edu"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  style={{ paddingLeft: 40 }}
                />
              </div>
            </div>

            <div className="input-group">
              <label className="input-label" htmlFor="fp-member-id">Member ID</label>
              <div style={{ position: 'relative' }}>
                <Hash size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input
                  id="fp-member-id"
                  className="input"
                  type="text"
                  placeholder="e.g. 230571F"
                  value={memberId}
                  onChange={e => setMemberId(e.target.value)}
                  required
                  style={{ paddingLeft: 40, textTransform: 'uppercase' }}
                />
              </div>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                The ID you registered with (e.g. student index number)
              </span>
            </div>

            <button className="btn btn-primary btn-full btn-lg" type="submit" disabled={sending}>
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}
              {sending ? 'Sending Code...' : 'Send Reset Code'}
            </button>
          </form>
        )}

        {/* ── Step 2: Verify & Reset ── */}
        {step === 'verify' && (
          <form className="auth-form" onSubmit={handleResetPassword}>
            {/* OTP Input */}
            <div className="input-group">
              <label className="input-label">Verification Code</label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }} onPaste={handleOtpPaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => { otpRefs.current[i] = el; }}
                    className="input"
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOtpChange(i, e.target.value)}
                    onKeyDown={e => handleOtpKeyDown(i, e)}
                    style={{
                      width: 44, height: 52, textAlign: 'center',
                      fontSize: 'var(--font-size-xl)', fontWeight: 700,
                      padding: 0, letterSpacing: 0,
                    }}
                  />
                ))}
              </div>
              <div style={{ textAlign: 'center', marginTop: 'var(--space-2)' }}>
                {countdown > 0 ? (
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
                    Resend code in {countdown}s
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={sending}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--color-primary)', fontSize: 'var(--font-size-xs)',
                      fontWeight: 600, padding: 0,
                    }}
                  >
                    {sending ? 'Sending...' : 'Resend Code'}
                  </button>
                )}
              </div>
            </div>

            {/* New Password */}
            <div className="input-group">
              <label className="input-label" htmlFor="fp-new-password">New Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input
                  id="fp-new-password"
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="At least 6 characters"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  minLength={6}
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

            {/* Confirm Password */}
            <div className="input-group">
              <label className="input-label" htmlFor="fp-confirm-password">Confirm Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                <input
                  id="fp-confirm-password"
                  className="input"
                  type={showConfirm ? 'text' : 'password'}
                  placeholder="Re-enter your password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  style={{ paddingLeft: 40, paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: 0 }}
                >
                  {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-error)' }}>
                  Passwords do not match
                </span>
              )}
            </div>

            <button
              className="btn btn-primary btn-full btn-lg"
              type="submit"
              disabled={resetting || otp.join('').length !== 6 || newPassword.length < 6 || newPassword !== confirmPassword}
            >
              {resetting ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
              {resetting ? 'Resetting...' : 'Reset Password'}
            </button>

            <button
              type="button"
              className="btn btn-ghost btn-full"
              onClick={() => { setStep('request'); setOtp(['', '', '', '', '', '']); setNewPassword(''); setConfirmPassword(''); }}
              style={{ marginTop: 'var(--space-1)' }}
            >
              <ArrowLeft size={16} /> Back
            </button>
          </form>
        )}

        <p className="auth-footer">
          Remember your password? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
