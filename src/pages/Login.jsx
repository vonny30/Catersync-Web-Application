// pages/Login.jsx
import { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';

export default function Login() {
  const navigate = useNavigate();

  // Form State
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false,
  });

  // UI State
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // --- Auto-redirect if already logged in and is a manager ---
  useEffect(() => {
    const checkSession = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Verify manager existence
        const { data: manager, error } = await supabase
          .from('manager')
          .select('manager_id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (!error && manager) {
          navigate('/app');
        } else {
          // Not a manager – sign out to avoid stale session
          await supabase.auth.signOut();
        }
      }
    };
    checkSession();
  }, [navigate]);

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

    try {
      // 1. Authenticate with Supabase Auth (email/password)
      const { data, error } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (error) throw error;

      // 2. Check if this user is authorized as a manager
      //    The manager table has a user_id column referencing auth.users.id
      const { data: managerData, error: managerError } = await supabase
        .from('manager')
        .select('manager_id')
        .eq('user_id', data.user.id)
        .maybeSingle();

      if (managerError) throw managerError;

      if (!managerData) {
        // User exists in auth but not in manager table – deny access
        await supabase.auth.signOut();
        throw new Error('You are not authorized to access this system.');
      }

      // 3. Success – redirect to dashboard
      navigate('/app');
    } catch (error) {
      console.error('Login error:', error.message);
      setErrorMsg(error.message || 'Invalid email or password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      {/* HEADER */}
      <header className="bg-[#008A45] text-white h-[72px] flex items-center px-6 w-full shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="bg-white rounded-full w-12 h-12 flex items-center justify-center text-slate-800 font-bold text-[10px] text-center leading-tight shadow-sm border-2 border-slate-100">
            <span className="opacity-80">Cater<br />Sync</span>
          </div>
          <h1 className="text-2xl font-bold tracking-wide">Catersync</h1>
        </div>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-slate-900 mb-2">Welcome back, Owner!</h2>
          <p className="text-lg text-slate-700">Sign-in to your account</p>
        </div>

        {/* LOGIN CARD */}
        <div className="bg-[#F8F9FA] border-2 border-slate-200 rounded-lg shadow-lg w-full max-w-md p-10">
          <h3 className="text-2xl font-bold text-slate-900 text-center mb-6">Login</h3>

          {/* Error Message Display */}
          {errorMsg && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-md text-center">
              {errorMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="w-full border border-slate-300 rounded-md p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                required
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className="w-full border border-slate-300 rounded-md p-2.5 pr-10 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between mt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  name="rememberMe"
                  checked={formData.rememberMe}
                  onChange={handleInputChange}
                  className="w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                />
                <span className="text-xs font-medium text-slate-500">Remember me</span>
              </label>
              <a href="#" className="text-xs font-medium text-slate-500 hover:text-slate-800 underline decoration-slate-300 underline-offset-2">
                Forgot password?
              </a>
            </div>

            {/* Submit Button */}
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

      {/* FOOTER */}
      <footer className="bg-[#C1DEDC] py-5 text-center flex items-center justify-center gap-4 text-xs font-semibold text-slate-800">
        <span>@2023 all rights reserved</span>
        <span>PG's Catering</span>
      </footer>
    </div>
  );
}