// layouts/ManagerLayout.jsx
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
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
  const navigate = useNavigate();
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkManager = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        navigate('/');
        setLoading(false);
        return;
      }

      const { data: managerData } = await supabase
        .from('manager')
        .select('manager_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!managerData) {
        // Not a manager – sign out and redirect
        await supabase.auth.signOut();
        navigate('/');
        setLoading(false);
        return;
      }

      setIsManager(true);
      setLoading(false);
    };

    checkManager();
  }, [navigate]);

  // If still loading, show a simple loader
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  // If not manager (should be redirected already), but just in case:
  if (!isManager) {
    return null;
  }

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
          <span className="font-semibold underline decoration-2 underline-offset-4">Owner</span>
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

            {/* Sign Out Link */}
            <Link
              to="/"
              className={`${styles.navItem} text-slate-600 font-medium hover:bg-slate-50 hover:text-slate-900`}
              onClick={async () => {
                await supabase.auth.signOut();
                // Navigate is handled by the Link
              }}
            >
              <LogOut size={18} className="text-slate-400" /> Sign Out
            </Link>
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