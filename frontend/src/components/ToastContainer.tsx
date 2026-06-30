import { useToast } from '../contexts/ToastContext';
import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-react';

const icons = {
  success: <CheckCircle2 size={18} style={{ color: 'var(--color-success)' }} />,
  error: <AlertCircle size={18} style={{ color: 'var(--color-danger)' }} />,
  warning: <AlertTriangle size={18} style={{ color: 'var(--color-warning)' }} />,
  info: <Info size={18} style={{ color: 'var(--color-primary)' }} />,
};

export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          {icons[t.type]}
          <span style={{ flex: 1, fontSize: 'var(--font-size-sm)' }}>{t.message}</span>
          <button className="btn-ghost btn-icon" onClick={() => dismiss(t.id)} style={{ width: 28, height: 28 }}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
