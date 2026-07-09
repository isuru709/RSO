import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { AppLayout } from './layouts/AppLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ResourceListPage } from './pages/resources/ResourceListPage';
import { NewResourcePage } from './pages/resources/NewResourcePage';
import { EditResourcePage } from './pages/resources/EditResourcePage';
import { ResourceDetailPage } from './pages/resources/ResourceDetailPage';
import { BookingListPage } from './pages/bookings/BookingListPage';
import { NewBookingPage } from './pages/bookings/NewBookingPage';
import { BookingDetailPage } from './pages/bookings/BookingDetailPage';
import { NotificationPage } from './pages/notifications/NotificationPage';
import { ProfilePage } from './pages/profile/ProfilePage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminTenantsPage } from './pages/admin/AdminTenantsPage';
import { STResourceListPage } from './pages/st-resources/STResourceListPage';
import { NewSTResourcePage } from './pages/st-resources/NewSTResourcePage';
import { EditSTResourcePage } from './pages/st-resources/EditSTResourcePage';
import { STBorrowsPage } from './pages/st-resources/STBorrowsPage';
import { ToastContainer } from './components/ToastContainer';

import './styles/variables.css';
import './styles/reset.css';
import './styles/animations.css';
import './styles/components.css';
import './styles/layout.css';

function SuspendedScreen() {
  const { logout } = useAuth();
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-bg)',
      padding: 'var(--space-6)',
    }}>
      <div className="card" style={{
        maxWidth: 440, width: '100%', padding: 'var(--space-8)',
        textAlign: 'center',
      }}>
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: 'linear-gradient(135deg, #fecaca, #fca5a5)',
          color: '#dc2626',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto var(--space-5)',
          fontSize: 32,
        }}>
          🚫
        </div>
        <h2 style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, marginBottom: 'var(--space-2)' }}>
          Account Suspended
        </h2>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)', lineHeight: 1.6 }}>
          Your account has been temporarily suspended by an administrator.
          Please contact your faculty admin for more information.
        </p>
        <button className="btn btn-outline btn-full" onClick={() => logout()}>
          Sign Out
        </button>
      </div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, claims, loading } = useAuth();

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner spinner-lg" />
        <span>Loading...</span>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
  if (claims.is_banned) return <SuspendedScreen />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/signup" element={<PublicRoute><SignupPage /></PublicRoute>} />
      <Route path="/forgot-password" element={<PublicRoute><ForgotPasswordPage /></PublicRoute>} />

      {/* Protected routes */}
      <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="resources" element={<ResourceListPage />} />
        <Route path="resources/new" element={<NewResourcePage />} />
        <Route path="resources/:id/edit" element={<EditResourcePage />} />
        <Route path="resources/:id" element={<ResourceDetailPage />} />
        <Route path="st-resources" element={<STResourceListPage />} />
        <Route path="st-resources/new" element={<NewSTResourcePage />} />
        <Route path="st-resources/:id/edit" element={<EditSTResourcePage />} />
        <Route path="st-resources/borrows" element={<STBorrowsPage />} />
        <Route path="bookings" element={<BookingListPage />} />
        <Route path="bookings/new" element={<NewBookingPage />} />
        <Route path="bookings/:id" element={<BookingDetailPage />} />
        <Route path="notifications" element={<NotificationPage />} />
        <Route path="profile" element={<ProfilePage />} />
        {/* Admin routes */}
        <Route path="admin/users" element={<AdminUsersPage />} />
        <Route path="admin/tenants" element={<AdminTenantsPage />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
        <ToastContainer />
      </ToastProvider>
    </BrowserRouter>
  );
}
