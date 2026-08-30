// src/pages/Login.jsx
import { useState, useEffect } from 'react';
import { Eye, EyeOff, Mail, Lock, AlertCircle, Info, Check } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabase';
import { useAuth } from '../contexts/AuthContext';
import toast from 'react-hot-toast';

export default function Login() {
  const navigate = useNavigate();
  const { isManager, loading: authLoading, sessionConflictMessage, clearSessionConflictMessage, markFreshLoginAttempt } = useAuth();

  // Read at first render, not in an effect. localStorage is available
  // synchronously, so mirroring it into state afterwards only bought an extra
  // render — and a visible flash of an empty email box on a page whose whole
  // point is that it remembered you.
  const [formData, setFormData] = useState(() => {
    let email = '', rememberMe = false;
    try {
      const saved = localStorage.getItem('rememberedEmail');
      if (saved && localStorage.getItem('rememberMe') === 'true') {
        email = saved;
        rememberMe = true;
      }
    } catch {
      // Private mode or blocked site data — start blank rather than crash.
    }
    return { email, password: '', rememberMe };
  });

  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Once AuthContext confirms this is a fully-authenticated manager
  // (password verified, session lock claimed), move into the app. Uses
  // `replace` so the login page's history entry is replaced rather than
  // kept — otherwise pressing Back from the dashboard would land back on
  // the login form (still authenticated underneath, just a confusing
  // "am I logged in or not" flash) instead of leaving the app entirely.
  useEffect(() => {
    if (authLoading || !isManager) return undefined;

    // isManager alone is not enough to redirect on. On SIGNED_OUT the context
    // defers clearing it by 500ms, so for that half-second it still reads true
    // with no session behind it. The password-reset flow lands exactly in that
    // window -- updateUser fires USER_UPDATED (which re-verifies the manager
    // and sets the flag), then signOut, then navigate here -- and this effect
    // would bounce to /app, only for the deferred clear to eject back to
    // /login a moment later. Confirming the session makes the flag's staleness
    // harmless: no session, no redirect.
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!cancelled && data?.session) {
        navigate('/app', { replace: true });
      }
    })();
    return () => { cancelled = true; };
  }, [authLoading, isManager, navigate]);

  // A fresh login can be rejected because the account is already active
  // elsewhere (single-session enforcement) — AuthContext discovers this
  // asynchronously, after signInWithPassword already succeeded, so it's
  // surfaced here rather than inside handleSubmit's own try/catch.
  useEffect(() => {
    if (sessionConflictMessage) {
      setErrorMsg(sessionConflictMessage);
      setIsLoading(false);
      clearSessionConflictMessage();
    }
  }, [sessionConflictMessage, clearSessionConflictMessage]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
    if (errorMsg) setErrorMsg('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setErrorMsg('');

    const email = formData.email.trim();
    const password = formData.password.trim();

    if (!email) {
      setErrorMsg('Please enter your email address.');
      setIsLoading(false);
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setErrorMsg('Please enter a valid email address (e.g., name@domain.com).');
      setIsLoading(false);
      return;
    }

    if (!password) {
      setErrorMsg('Please enter your password.');
      setIsLoading(false);
      return;
    }

 try {
      // Marks the very next SIGNED_IN event as a real login attempt, so
      // AuthContext knows to enforce the single-session check on it —
      // see the comment on freshLoginAttemptRef in AuthContext.jsx.
      markFreshLoginAttempt();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

      // 1. ROBUST ERROR CHECKING (No strict switch statements)
      if (error) {
        let userMessage = 'Invalid email or password. Please try again.';
        const errorMessage = error.message?.toLowerCase() || '';

        if (errorMessage.includes('email not confirmed')) {
          userMessage = 'Please confirm your email address before logging in. Check your inbox.';
        } else if (errorMessage.includes('network') || errorMessage.includes('fetch')) {
          userMessage = 'Network connection issue. Please check your internet and try again.';
        } else if (errorMessage.includes('rate limit')) {
          userMessage = 'Too many login attempts. Please wait a moment and try again.';
        }

        setErrorMsg(userMessage);
        setIsLoading(false);
        return;
      }

      // 2. MANAGER VERIFICATION (fast local check; AuthContext independently
      // verifies this too before granting access, and also handles the
      // single-active-session claim)
      const { data: managerData, error: managerError } = await supabase
        .from('manager')
        .select('manager_id')
        .eq('user_id', data.user.id)
        .maybeSingle();

      if (managerError || !managerData) {
        // Local scope: this rejects a non-manager from the admin console, it
        // does not sign them out of everything. The customer mobile app shares
        // this Supabase project, so a global signOut here would log a customer
        // out of that app for the crime of trying the wrong login page.
        await supabase.auth.signOut({ scope: 'local' });
        toast.error('Access denied. This login page is restricted to authorized manager accounts only.', {
          duration: 6000
        });
        setIsLoading(false);
        return;
      }

      // 3. Remember-me + hand off to AuthContext (which is reacting to the
      // SIGNED_IN event right now and will flip `isManager` once it's done).
      localStorage.setItem('rememberMe', String(formData.rememberMe));
      if (formData.rememberMe) {
        localStorage.setItem('rememberedEmail', email);
      } else {
        localStorage.removeItem('rememberedEmail');
      }

      // Don't toast "Welcome back!" here — AuthContext is still finishing
      // the session-lock claim. The isManager effect below shows the
      // success toast once that's actually done.
      setIsLoading(false);

    } catch (error) {
      console.error('Login error:', error.message);
      setErrorMsg('Something went wrong. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    // Panels split 46/54, but every block inside them is capped and centred in
    // its own half. Before, brand copy sat at a fixed 48px from the left while
    // the form floated dead centre, so at 2560px the headline clung to the edge
    // of 710px of empty green and the two halves shared no alignment at all.
    // Centring both means the gutters grow together instead of one staying
    // pinned while the other doubles.
    <div className="min-h-screen flex font-sans">
      {/* BRAND PANEL */}
      <div className="relative overflow-hidden flex-[1_1_46%] min-w-0 hidden lg:flex flex-col justify-between px-[clamp(2rem,3.5vw,4.5rem)] py-[clamp(2.5rem,4vh,3.5rem)] bg-[linear-gradient(155deg,#00753b_0%,#008A45_45%,#00A854_100%)]">
        <div className="absolute -top-[120px] -right-[140px] w-[420px] h-[420px] rounded-full bg-white/[0.06]" />
        <div className="absolute -bottom-[180px] -left-[120px] w-[460px] h-[460px] rounded-full bg-white/[0.05]" />
        <div className="absolute top-[190px] right-[90px] w-[130px] h-[130px] rounded-full bg-white/[0.04]" />

        <div className="relative w-full max-w-[560px] mx-auto flex items-center gap-3.5">
          <div className="w-[52px] h-[52px] rounded-full overflow-hidden bg-white/10 ring-2 ring-white/50 shrink-0">
            <img src="/logo.svg" alt="CaterSync" className="w-full h-full object-cover" />
          </div>
          <span className="text-[clamp(22px,1.6vw,26px)] font-bold tracking-[0.02em] text-white">CaterSync</span>
        </div>

        <div className="relative w-full max-w-[560px] mx-auto py-8">
          {/* Fluid rather than fixed: a 34px headline that never grows looks
              stranded once the panel passes ~1000px. */}
          <h2 className="text-[clamp(30px,2.7vw,46px)] leading-[1.18] font-bold tracking-[-0.025em] text-white [text-wrap:pretty]">
            Every event, every tray, every peso — in one place.
          </h2>
          <p className="mt-5 text-[clamp(16px,1.15vw,19px)] leading-[1.55] text-white/85 [text-wrap:pretty]">
            The manager console for PG&apos;s Catering. Bookings, payments, equipment and fleet, from one dashboard.
          </p>
          <div className="flex flex-wrap gap-2.5 mt-9 pt-7 border-t border-white/[0.18]">
            {['Bookings & short orders', 'Payment verification', 'Equipment & fleet', 'Reports'].map(f => (
              <span key={f} className="inline-flex items-center gap-2 pl-3.5 pr-4 py-2 rounded-full bg-white/[0.12] text-[clamp(13.5px,0.95vw,15px)] font-medium text-white/90 whitespace-nowrap">
                <Check size={14} className="shrink-0" /> {f}
              </span>
            ))}
          </div>
        </div>

        <p className="relative w-full max-w-[560px] mx-auto text-[13.5px] text-white/60">
          &copy; {new Date().getFullYear()} PG&apos;s Catering. All rights reserved.
        </p>
      </div>

      {/* FORM PANEL */}
      <div className="flex-[1_1_54%] min-w-0 flex items-center justify-center px-[clamp(1.25rem,3.5vw,4.5rem)] py-[clamp(2.5rem,4vh,3.5rem)] bg-slate-50">
        <div className="w-full max-w-[440px]">
          <div className="flex lg:hidden items-center gap-3 mb-9">
            <div className="w-12 h-12 rounded-full overflow-hidden ring-2 ring-[#008A45]/20 shrink-0">
              <img src="/logo.svg" alt="CaterSync" className="w-full h-full object-cover" />
            </div>
            <span className="text-[22px] font-bold text-slate-900">CaterSync</span>
          </div>

          <h1 className="text-[clamp(28px,2.1vw,36px)] font-bold tracking-[-0.025em] text-slate-900">Welcome back</h1>
          <p className="mt-2.5 mb-8 text-[clamp(15.5px,1.1vw,17px)] text-slate-600">Sign in to your account.</p>

          {errorMsg && (
            <div className="flex items-start gap-2.5 mb-6 px-4 py-3.5 border border-[#f3c9c9] rounded-xl bg-[#fef4f4]">
              <AlertCircle size={17} className="shrink-0 mt-px text-red-700" />
              <span className="text-[14.5px] leading-[1.45] text-red-700 [text-wrap:pretty]">{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div>
              <label htmlFor="email" className="block text-[14px] font-semibold text-slate-700 mb-2">
                Email
              </label>
              <div className="relative">
                <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                {/* 16px, not 15: below 16 iOS Safari zooms the whole page when
                    the field takes focus, which is its own kind of weird. */}
                <input
                  id="email"
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className="w-full border border-slate-200 rounded-xl pl-[46px] pr-4 py-[15px] text-[16px] text-slate-900 focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45] outline-none bg-white"
                  required
                  placeholder="Enter your email"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-[14px] font-semibold text-slate-700 mb-2">
                Password
              </label>
              <div className="relative">
                <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className="w-full border border-slate-200 rounded-xl pl-[46px] pr-[50px] py-[15px] text-[16px] text-slate-900 focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45] outline-none bg-white"
                  required
                  placeholder="Enter your password"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-9 h-9 rounded-[10px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  disabled={isLoading}
                >
                  {showPassword ? <Eye size={19} /> : <EyeOff size={19} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  name="rememberMe"
                  checked={formData.rememberMe}
                  onChange={handleInputChange}
                  className="w-[18px] h-[18px] rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                  disabled={isLoading}
                />
                <span className="text-[15px] text-slate-700">Remember me</span>
              </label>
              <Link to="/forgot-password" className="text-[14.5px] font-semibold text-[#007038] hover:text-[#00532a]">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full mt-1 py-4 rounded-xl bg-[#008A45] hover:bg-[#007038] text-white text-[16px] font-semibold transition-colors ${
                isLoading ? 'opacity-70 cursor-not-allowed' : ''
              }`}
            >
              {isLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="flex items-start gap-2.5 mt-7 pt-6 border-t border-slate-200">
            <Info size={16} className="shrink-0 mt-px text-slate-400" />
            <p className="text-[13.5px] leading-[1.5] text-slate-500 [text-wrap:pretty]">
              Only one session per account. If this account is already signed in elsewhere, you&apos;ll be told where before you can continue.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
