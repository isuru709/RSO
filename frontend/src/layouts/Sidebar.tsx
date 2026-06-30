import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  Building2,
  Monitor,
  CalendarDays,
  Bell,
  Users,
  Settings,
  GraduationCap,
  BookOpen,
} from 'lucide-react';

export function Sidebar() {
  const { claims } = useAuth();
  const isAdmin = claims.app_role === 'main_admin' || claims.app_role === 'tenant_admin';

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon">
          <GraduationCap size={22} />
        </div>
        <span className="sidebar-brand-text">CampusRSO</span>
      </div>

      <nav className="sidebar-nav">
        <span className="sidebar-section-title">Main</span>

        <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <LayoutDashboard className="nav-icon" />
          <span className="nav-label">Dashboard</span>
        </NavLink>

        <NavLink to="/resources" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Monitor className="nav-icon" />
          <span className="nav-label">Resources</span>
        </NavLink>

        <NavLink to="/st-resources" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <BookOpen className="nav-icon" style={{ color: '#a855f7' }} />
          <span className="nav-label">ST Resource</span>
        </NavLink>

        <NavLink to="/bookings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <CalendarDays className="nav-icon" />
          <span className="nav-label">Bookings</span>
        </NavLink>

        <NavLink to="/notifications" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Bell className="nav-icon" />
          <span className="nav-label">Notifications</span>
        </NavLink>

        {isAdmin && (
          <>
            <span className="sidebar-section-title">Admin</span>

            <NavLink to="/admin/users" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Users className="nav-icon" />
              <span className="nav-label">Users</span>
            </NavLink>

            {claims.app_role === 'main_admin' && (
              <NavLink to="/admin/tenants" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Building2 className="nav-icon" />
                <span className="nav-label">Tenants</span>
              </NavLink>
            )}
          </>
        )}

        <span className="sidebar-section-title">Account</span>

        <NavLink to="/profile" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          <Settings className="nav-icon" />
          <span className="nav-label">Profile</span>
        </NavLink>
      </nav>
    </aside>
  );
}
