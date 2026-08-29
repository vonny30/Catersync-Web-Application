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

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const savedEmail = localStorage.getItem('rememberedEmail');
    const rememberMe = localStorage.getItem('rememberMe') === 'true';
    if (savedEmail && rememberMe) {
      setFormData(prev => ({ ...prev, email: savedEmail, rememberMe: true }));
    }
  }, []);

  // Once AuthContext confirms this is a fully-authenticated manager
  // (password verified, session lock claimed), move into the app. Uses
  // `replace` so the login page's history entry is replaced rather than
  // kept — otherwise pressing Back from the dashboard would land back on
  // the login form (still authenticated underneath, just a confusing
  // "am I logged in or not" flash) instead of leaving the app entirely.
  useEffect(() => {
    if (!authLoading && isManager) {
      navigate('/app', { replace: true });
    }
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
        await supabase.auth.signOut();
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
    <div className="min-h-screen flex font-sans">
      {/* BRAND PANEL — the old green header bar and the footer both fold into
          this. Hidden below lg, where the form stands alone with the mobile
          logo block instead, so nothing is lost on a phone. */}
      <div className="relative overflow-hidden flex-[1_1_46%] min-w-0 hidden lg:flex flex-col justify-between px-12 py-11 bg-[linear-gradient(155deg,#00753b_0%,#008A45_45%,#00A854_100%)]">
        {/* Depth without an image asset. */}
        <div className="absolute -top-[120px] -right-[140px] w-[420px] h-[420px] rounded-full bg-white/[0.06]" />
        <div className="absolute -bottom-[180px] -left-[120px] w-[460px] h-[460px] rounded-full bg-white/[0.05]" />
        <div className="absolute top-[190px] right-[90px] w-[130px] h-[130px] rounded-full bg-white/[0.04]" />

        <div className="relative flex items-center gap-3">
          <div className="w-[46px] h-[46px] rounded-full overflow-hidden bg-white/10 ring-2 ring-white/50 shrink-0">
            <img src="/logo.svg" alt="CaterSync" className="w-full h-full object-cover" />
          </div>
          <span className="text-[22px] font-bold tracking-[0.02em] text-white">CaterSync</span>
        </div>

        <div className="relative max-w-[420px]">
          <h2 className="text-[34px] leading-[1.2] font-bold tracking-[-0.025em] text-white [text-wrap:pretty]">
            Every event, every tray, every peso — in one place.
          </h2>
          <p className="mt-4 text-[15.5px] leading-[1.55] text-white/80 [text-wrap:pretty]">
            The manager console for PG&apos;s Catering. Bookings, payments, equipment and fleet, from one dashboard.
          </p>
          <div className="flex flex-wrap gap-2.5 mt-8 pt-[26px] border-t border-white/[0.18]">
            {['Bookings & short orders', 'Payment verification', 'Equipment & fleet', 'Reports'].map(f => (
              <span key={f} className="inline-flex items-center gap-2 pl-3 pr-3.5 py-[7px] rounded-full bg-white/[0.12] text-[13.5px] font-medium text-white/90 whitespace-nowrap">
                <Check size={13} className="shrink-0" /> {f}
              </span>
            ))}
          </div>
        </div>

        <p className="relative text-[13px] text-white/60">
          &copy; {new Date().getFullYear()} PG&apos;s Catering. All rights reserved.
        </p>
      </div>

      {/* FORM PANEL */}
      <div className="flex-[1_1_54%] min-w-0 flex items-center justify-center px-8 py-11 bg-slate-50">
        <div className="w-full max-w-[392px]">
          <div className="flex lg:hidden items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-full overflow-hidden ring-2 ring-[#008A45]/20 shrink-0">
              <img src="/logo.svg" alt="CaterSync" className="w-full h-full object-cover" />
            </div>
            <span className="text-xl font-bold text-slate-900">CaterSync</span>
          </div>

          {/* One heading. The page previously said the same thing three times
              in three sizes: "Welcome back", "Sign-in to your account", "Login". */}
          <h1 className="text-[28px] font-bold tracking-[-0.025em] text-slate-900">Welcome back</h1>
          <p className="mt-2 mb-[30px] text-[15px] text-slate-600">Sign in to your account.</p>

          {errorMsg && (
            <div className="flex items-start gap-2.5 mb-[22px] px-[15px] py-3.5 border border-[#f3c9c9] rounded-[11px] bg-[#fef4f4]">
              <AlertCircle size={16} className="shrink-0 mt-px text-red-700" />
              <span className="text-[13.5px] leading-[1.45] text-red-700 [text-wrap:pretty]">{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
            <div>
              <label htmlFor="email" className="block text-[13px] font-semibold text-slate-700 mb-[7px]">
                Email
              </label>
              <div className="relative">
                <Mail size={17} className="absolute left-[15px] top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className="w-full border border-slate-200 rounded-[11px] pl-[42px] pr-[15px] py-[13px] text-[15px] focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45] outline-none bg-white"
                  required
                  placeholder="Enter your email"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div>
              {/* The forgot-password route existed but nothing linked to it —
                  the only way there was typing the URL. */}
              <div className="flex items-baseline justify-between gap-3 mb-[7px]">
                <label htmlFor="password" className="text-[13px] font-semibold text-slate-700">
                  Password
                </label>
                <Link to="/forgot-password" className="text-[13px] font-semibold text-[#007038] hover:text-[#00532a]">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <Lock size={17} className="absolute left-[15px] top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className="w-full border border-slate-200 rounded-[11px] pl-[42px] pr-[46px] py-[13px] text-[15px] focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45] outline-none bg-white"
                  required
                  placeholder="Enter your password"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center justify-center w-[34px] h-[34px] rounded-[9px] text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  disabled={isLoading}
                >
                  {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-[9px] cursor-pointer select-none">
              <input
                type="checkbox"
                name="rememberMe"
                checked={formData.rememberMe}
                onChange={handleInputChange}
                className="w-[17px] h-[17px] rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                disabled={isLoading}
              />
              <span className="text-sm text-slate-700">Remember me</span>
            </label>

            <button
              type="submit"
              disabled={isLoading}
              className={`w-full mt-1 py-3.5 rounded-[11px] bg-[#008A45] hover:bg-[#007038] text-white text-[15px] font-semibold transition-colors ${
                isLoading ? 'opacity-70 cursor-not-allowed' : ''
              }`}
            >
              {isLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* AuthContext enforces one session per account. Users met that rule
              only at the moment it blocked them, where it reads like a bug. */}
          <div className="flex items-start gap-[9px] mt-[26px] pt-[22px] border-t border-slate-100">
            <Info size={15} className="shrink-0 mt-px text-slate-400" />
            <p className="text-[13px] leading-[1.5] text-slate-500 [text-wrap:pretty]">
              Only one session per account. If this account is already signed in elsewhere, you&apos;ll be told where before you can continue.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
