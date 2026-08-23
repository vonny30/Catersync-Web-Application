// src/pages/Login.jsx
import { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <header className="bg-[#008A45] text-white h-[72px] flex items-center px-6 w-full shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white shadow-sm flex-shrink-0">
            <img src="/logo.svg" alt="CaterSync" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold tracking-wide">CaterSync</h1>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-slate-900 mb-2">Welcome back</h2>
          <p className="text-lg text-slate-700">Sign-in to your account</p>
        </div>

        <div className="bg-[#F8F9FA] border-2 border-slate-200 rounded-lg shadow-lg w-full max-w-md p-10">
          <h3 className="text-2xl font-bold text-slate-900 text-center mb-6">Login</h3>

          {errorMsg && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-md text-center">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-slate-500 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="w-full border border-slate-300 rounded-md p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                required
                placeholder="Enter your email"
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-slate-500 mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className="w-full border border-slate-300 rounded-md p-2.5 pr-10 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                  required
                  placeholder="Enter your password"
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  disabled={isLoading}
                >
                  {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="rememberMe"
                  checked={formData.rememberMe}
                  onChange={handleInputChange}
                  className="w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                  disabled={isLoading}
                />
                <span className="text-xs font-medium text-slate-500">Remember me</span>
              </label>
            </div>

            <div className="pt-4 flex justify-center">
              <button
                type="submit"
                disabled={isLoading}
                className={`bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm py-2.5 px-8 rounded transition-colors shadow-sm ${
                  isLoading ? 'opacity-70 cursor-not-allowed' : ''
                }`}
              >
                {isLoading ? 'SIGNING IN...' : 'SIGN-IN'}
              </button>
            </div>
          </form>
        </div>
      </main>

      <footer className="bg-[#C1DEDC] py-5 text-center flex items-center justify-center gap-4 text-xs font-semibold text-slate-800">
        <span>@2023 all rights reserved</span>
        <span>PG's Catering</span>
      </footer>
    </div>
  );
}
