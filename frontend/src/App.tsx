import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { AppLayout } from './layouts/AppLayout';
import { LoginPage } from './pages/auth/LoginPage';
import { SignupPage } from './pages/auth/SignupPage';
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

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner spinner-lg" />
        <span>Loading...</span>
      </div>
    );
  }

  if (!user) return <Navigate to="/login" replace />;
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
