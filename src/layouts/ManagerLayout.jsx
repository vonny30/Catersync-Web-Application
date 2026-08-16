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
  ChevronDown,
  User,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';

const styles = {
  wrapper: 'flex flex-col h-screen bg-slate-50 font-sans overflow-hidden',
  header:
    'bg-gradient-to-r from-[#00753b] to-[#009c4d] text-white h-16 flex items-center justify-between px-4 md:px-6 z-20 w-full shrink-0 relative shadow-md',
  profileMenu:
    'flex items-center gap-2.5 cursor-pointer hover:bg-white/10 pl-2 pr-3 py-1.5 rounded-full transition-colors border border-white/0 hover:border-white/20',
  profileAvatar:
    'w-8 h-8 rounded-full bg-white text-[#008A45] flex items-center justify-center overflow-hidden shadow-sm',
  mainContainer: 'flex flex-1 overflow-hidden relative z-0',
  sidebarDesktop:
    'w-64 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0 hidden md:flex relative z-10',
  sidebarMobile:
    'fixed inset-y-0 left-0 w-64 bg-white border-r border-slate-200 flex flex-col z-50 transform transition-transform duration-300 ease-in-out md:hidden shadow-2xl',
  sidebarOpen: 'translate-x-0',
  sidebarClosed: '-translate-x-full',
  navItem: 'relative flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all duration-200',
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
      // AuthContext's own SIGNED_OUT handler already shows the
      // "Logged out successfully" toast — don't show a second one here.
      await logout();
    } catch (error) {
      toast.error('Failed to log out');
    }
  };

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
          {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-[#008A45]" />}
          <Icon size={18} className={isActive ? 'text-[#008A45]' : 'text-slate-400'} />
          {link.name}
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
        {isSettingsActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-[#008A45]" />}
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
        className={`${styles.navItem} group text-slate-600 font-medium hover:bg-red-50 hover:text-red-600 w-full text-left`}
      >
        <LogOut size={18} className="text-slate-400 group-hover:text-red-500" /> Sign Out
      </button>
    );

    return (
      <>
        <nav className="p-3 space-y-1">{navItems}</nav>
        <div className="p-3 space-y-1 mt-auto border-t border-slate-100 pt-4">
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
          <button
            onClick={toggleSidebar}
            className="md:hidden p-1 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Toggle menu"
          >
            <MenuIcon size={24} />
          </button>
          <Link to="/app" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
            <div className="w-9 h-9 rounded-full overflow-hidden ring-2 ring-white/40 flex-shrink-0 bg-white/10">
              <img
                src="/logo.svg"
                alt="Catersync"
                className="w-full h-full object-cover"
              />
            </div>
            <h1 className="text-xl font-bold tracking-wide">Catersync</h1>
          </Link>
        </div>

        <div className="relative" ref={profileRef}>
          <div
            className={styles.profileMenu}
            onClick={() => setIsProfileOpen(!isProfileOpen)}
          >
            <div className={styles.profileAvatar}>
              <User size={16} strokeWidth={2.5} />
            </div>
            <span className="font-semibold text-sm hidden sm:inline">Manager</span>
            <ChevronDown
              size={15}
              className={`hidden sm:inline transition-transform duration-200 ${isProfileOpen ? 'rotate-180' : ''}`}
            />
          </div>

          {isProfileOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50 animate-in fade-in zoom-in-95 duration-150 origin-top-right">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#EAF3F2] text-[#008A45] flex items-center justify-center shrink-0">
                  <User size={16} strokeWidth={2.5} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 truncate">
                    {user?.email || 'Owner'}
                  </p>
                  <p className="text-xs text-slate-500">Manager</p>
                </div>
              </div>
              <Link
                to="/app/settings"
                className="flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                onClick={() => setIsProfileOpen(false)}
              >
                <Settings size={16} className="text-slate-400" />
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

      <div className={styles.mainContainer}>
        {/* DESKTOP SIDEBAR */}
        <aside className={styles.sidebarDesktop}>{renderNavItems(false)}</aside>

        {/* MOBILE SIDEBAR – Proper spacing */}
        <aside
          className={`${styles.sidebarMobile} ${
            isSidebarOpen ? styles.sidebarOpen : styles.sidebarClosed
          }`}
        >
          {/* Header – compact */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0 bg-gradient-to-r from-[#00753b] to-[#009c4d]">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full overflow-hidden ring-2 ring-white/40 bg-white/10">
                <img src="/logo.svg" alt="Catersync" className="w-full h-full object-cover" />
              </div>
              <span className="font-bold text-white">Catersync</span>
            </div>
            <button
              onClick={closeSidebar}
              className="p-1 rounded-lg hover:bg-white/10 transition-colors"
              aria-label="Close menu"
            >
              <X size={20} className="text-white" />
            </button>
          </div>

          {/* Navigation – fills space, Settings pushed to bottom with mt-auto */}
          <div className="flex-1 flex flex-col overflow-y-auto">
            {/* Small gap at top (pt-2) so it's not flush against the header */}
            <div className="pt-2 flex-1 flex flex-col">
              {renderNavItems(true)}
            </div>
          </div>
        </aside>

        <main className={styles.contentWindow}>
          <div key={location.pathname} className="page-transition h-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}