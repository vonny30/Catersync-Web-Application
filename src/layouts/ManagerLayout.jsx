// src/layouts/ManagerLayout.jsx
import { useState, useRef, useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  CalendarDays,
  ShoppingBag,
  CreditCard,
  Wrench,
  Truck,
  BarChart3,
  Menu as MenuIcon,
  Settings,
  LogOut,
  ChevronRight,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

const styles = {
  wrapper: 'flex flex-col h-screen bg-slate-50 font-sans overflow-hidden',
  header:
    'bg-[#008A45] text-white h-16 flex items-center justify-between px-4 md:px-6 z-20 w-full shrink-0 relative',
  logoContainer: 'flex items-center gap-3',
  logoBadge:
    'bg-white rounded-full w-9 h-9 flex items-center justify-center text-[#008A45] font-bold text-xs',
  profileMenu:
    'flex items-center gap-3 cursor-pointer hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors',
  profileAvatar:
    'w-8 h-8 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center overflow-hidden border-2 border-white',
  mainContainer: 'flex flex-1 overflow-hidden relative z-0',
  sidebarDesktop:
    'w-64 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0 hidden md:flex relative z-10',
  sidebarMobile:
    'fixed inset-y-0 left-0 w-64 bg-white border-r border-slate-200 flex flex-col justify-between z-50 transform transition-transform duration-300 ease-in-out md:hidden shadow-2xl',
  sidebarOpen: 'translate-x-0',
  sidebarClosed: '-translate-x-full',
  navItem: 'flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200',
  contentWindow: 'flex-1 overflow-y-auto bg-transparent p-4 md:p-8',
};

export default function ManagerLayout() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const profileRef = useRef(null);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);
  const closeSidebar = () => setIsSidebarOpen(false);

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navLinks = [
    { name: 'Dashboard', path: '/app', icon: LayoutDashboard },
    { name: 'Bookings', path: '/app/bookings', icon: CalendarDays },
    { name: 'Short Orders', path: '/app/orders', icon: ShoppingBag },
    { name: 'Payments', path: '/app/payments', icon: CreditCard },
    { name: 'Equipment', path: '/app/equipment', icon: Wrench },
    { name: 'Vehicles', path: '/app/vehicles', icon: Truck },
    { name: 'Reports', path: '/app/reports', icon: BarChart3 },
    { name: 'Packages & Menus', path: '/app/packages-menu', icon: MenuIcon },
  ];

  const isSettingsActive = location.pathname === '/app/settings';

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('Logged out successfully');
    } catch (error) {
      toast.error('Failed to log out');
    }
  };

  // Helper to render nav items (used in both desktop and mobile sidebars)
  const renderNavItems = (isMobile = false) => {
    const navItems = navLinks.map((link) => {
      const Icon = link.icon;
      const isActive = location.pathname === link.path;

      const activeStyles = isActive
        ? 'bg-[#EAF3F2] font-bold text-[#008A45]'
        : 'text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900';

      return (
        <Link
          key={link.name}
          to={link.path}
          onClick={isMobile ? closeSidebar : undefined}
          className={`${styles.navItem} ${activeStyles}`}
        >
          <Icon size={18} className={isActive ? 'text-[#008A45]' : 'text-slate-400'} />
          {link.name}
          <ChevronRight
            size={16}
            className={`ml-auto ${isActive ? 'text-[#008A45]' : 'text-slate-300'}`}
          />
        </Link>
      );
    });

    const settingsLink = (
      <Link
        key="settings"
        to="/app/settings"
        onClick={isMobile ? closeSidebar : undefined}
        className={`${styles.navItem} ${
          isSettingsActive
            ? 'bg-[#EAF3F2] font-bold text-[#008A45]'
            : 'text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        <Settings size={18} className={isSettingsActive ? 'text-[#008A45]' : 'text-slate-400'} />
        Settings
      </Link>
    );

    const logoutButton = (
      <button
        key="logout"
        onClick={() => {
          handleLogout();
          if (isMobile) closeSidebar();
        }}
        className={`${styles.navItem} text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900 w-full text-left`}
      >
        <LogOut size={18} className="text-slate-400" /> Sign Out
      </button>
    );

    return (
      <>
        <nav className="p-3 space-y-1 mt-2">{navItems}</nav>
        <div className="p-3 space-y-1 mb-2 border-t border-slate-100 pt-4">
          {settingsLink}
          {logoutButton}
        </div>
      </>
    );
  };

  return (
    <div className={styles.wrapper}>
      {/* TOP NAVIGATION BAR */}
      <header className={styles.header}>
        <div className="flex items-center gap-3">
          {/* Hamburger button (visible on mobile) */}
          <button
            onClick={toggleSidebar}
            className="md:hidden p-1 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Toggle menu"
          >
            <MenuIcon size={24} />
          </button>
          <div className={styles.logoContainer}>
            <div className={styles.logoBadge}>CS</div>
            <h1 className="text-xl font-bold tracking-wide">Catersync</h1>
          </div>
        </div>

        {/* Profile dropdown – shows only icon and "Manager" label */}
        <div className="relative" ref={profileRef}>
          <div
            className={styles.profileMenu}
            onClick={() => setIsProfileOpen(!isProfileOpen)}
          >
            <div className={styles.profileAvatar}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2m8-10a4 4 0 100-8 4 4 0 000 8z"
                />
              </svg>
            </div>
            <span className="font-semibold text-sm hidden sm:inline">Manager</span>
            <span className="text-xs hidden sm:inline">
              {isProfileOpen ? '▲' : '▼'}
            </span>
          </div>

          {/* Dropdown – shows email and role */}
          {isProfileOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50">
              <div className="px-4 py-2 border-b border-slate-100">
                <p className="text-sm font-semibold text-slate-900 truncate">
                  {user?.email || 'Owner'}
                </p>
                <p className="text-xs text-slate-500">Manager</p>
              </div>
              <Link
                to="/app/settings"
                className="flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={() => setIsProfileOpen(false)}
              >
                <Settings size={16} />
                Profile Settings
              </Link>
              <button
                onClick={() => {
                  setIsProfileOpen(false);
                  handleLogout();
                }}
                className="flex items-center gap-3 w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors border-t border-slate-100"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <div className={styles.mainContainer}>
        {/* DESKTOP SIDEBAR */}
        <aside className={styles.sidebarDesktop}>{renderNavItems(false)}</aside>

        {/* MOBILE SIDEBAR (slide-out) */}
        <aside
          className={`${styles.sidebarMobile} ${
            isSidebarOpen ? styles.sidebarOpen : styles.sidebarClosed
          }`}
        >
          {/* Mobile sidebar header with close button */}
          <div className="flex items-center justify-between p-4 border-b border-slate-200">
            <div className="flex items-center gap-3">
              <div className={styles.logoBadge}>CS</div>
              <span className="font-bold text-slate-900">Catersync</span>
            </div>
            <button
              onClick={closeSidebar}
              className="p-1 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label="Close menu"
            >
              <X size={20} className="text-slate-500" />
            </button>
          </div>
          {renderNavItems(true)}
        </aside>

        {/* PAGE CONTENT WINDOW */}
        <main className={styles.contentWindow}>
          <div key={location.pathname} className="page-transition h-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}