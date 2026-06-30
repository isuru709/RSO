import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Monitor, CalendarDays, Bell, User } from 'lucide-react';

export function BottomNav() {
  return (
    <nav className="bottom-nav">
      <NavLink to="/" end className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <LayoutDashboard size={20} />
        <span>Home</span>
      </NavLink>
      <NavLink to="/resources" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <Monitor size={20} />
        <span>Resources</span>
      </NavLink>
      <NavLink to="/bookings" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <CalendarDays size={20} />
        <span>Bookings</span>
      </NavLink>
      <NavLink to="/notifications" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <Bell size={20} />
        <span>Alerts</span>
      </NavLink>
      <NavLink to="/profile" className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
        <User size={20} />
        <span>Profile</span>
      </NavLink>
    </nav>
  );
}
