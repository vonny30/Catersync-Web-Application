// layouts/ManagerLayout.jsx
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
} from 'lucide-react';

const styles = {
  wrapper: 'flex flex-col h-screen bg-slate-50 font-sans overflow-hidden',
  header:
    'bg-[#008A45] text-white h-16 flex items-center justify-between px-6 z-10 w-full shrink-0 relative',
  logoContainer: 'flex items-center gap-3',
  logoBadge:
    'bg-white rounded-full w-9 h-9 flex items-center justify-center text-[#008A45] font-bold text-xs',
  profileMenu:
    'flex items-center gap-3 cursor-pointer hover:bg-white/10 px-3 py-1.5 rounded-lg transition-colors',
  profileAvatar:
    'w-8 h-8 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center overflow-hidden border-2 border-white',
  mainContainer: 'flex flex-1 overflow-hidden relative z-0',
  sidebar:
    'w-64 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0 hidden md:flex relative z-10',
  navItem: 'flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200',
  contentWindow: 'flex-1 overflow-y-auto bg-transparent p-8',
};

export default function ManagerLayout() {
  const location = useLocation();
  const { user, logout } = useAuth(); // get user and logout from context

  // Note: ProtectedRoute already ensures user is authenticated and is a manager,
  // so we don't need to check again.

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
    await logout();
    // ProtectedRoute will redirect to login automatically,
    // but we can also navigate if needed – no need, because logout clears user state.
  };

  return (
    <div className={styles.wrapper}>
      {/* TOP NAVIGATION BAR */}
      <header className={styles.header}>
        <div className={styles.logoContainer}>
          <div className={styles.logoBadge}>CS</div>
          <h1 className="text-xl font-bold tracking-wide">Catersync</h1>
        </div>

        <div className={styles.profileMenu}>
          <div className={styles.profileAvatar}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2m8-10a4 4 0 100-8 4 4 0 000 8z"
              />
            </svg>
          </div>
          <span className="font-semibold underline decoration-2 underline-offset-4">
            {user?.email || 'Owner'}
          </span>
          <span className="text-xs">▼</span>
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <div className={styles.mainContainer}>
        {/* SIDEBAR */}
        <aside className={styles.sidebar}>
          <nav className="p-3 space-y-1 mt-2">
            {navLinks.map((link) => {
              const Icon = link.icon;
              const isActive = location.pathname === link.path;

              const activeStyles = isActive
                ? 'bg-[#EAF3F2] font-bold text-[#008A45]'
                : 'text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900';

              return (
                <Link key={link.name} to={link.path} className={`${styles.navItem} ${activeStyles}`}>
                  <Icon size={18} className={isActive ? 'text-[#008A45]' : 'text-slate-400'} />
                  {link.name}
                  <ChevronRight
                    size={16}
                    className={`ml-auto ${isActive ? 'text-[#008A45]' : 'text-slate-300'}`}
                  />
                </Link>
              );
            })}
          </nav>

          <div className="p-3 space-y-1 mb-2 border-t border-slate-100 pt-4">
            {/* Settings Link */}
            <Link
              to="/app/settings"
              className={`${styles.navItem} ${
                isSettingsActive
                  ? 'bg-[#EAF3F2] font-bold text-[#008A45]'
                  : 'text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <Settings size={18} className={isSettingsActive ? 'text-[#008A45]' : 'text-slate-400'} />
              Settings
            </Link>

            {/* Sign Out Link – now uses logout from context */}
            <button
              onClick={handleLogout}
              className={`${styles.navItem} text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900 w-full text-left`}
            >
              <LogOut size={18} className="text-slate-400" /> Sign Out
            </button>
          </div>
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