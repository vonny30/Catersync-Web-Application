// src/pages/Login.jsx
import { useState, useEffect } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

export default function Login() {
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    rememberMe: false,
  });

  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // ✅ Load saved email if rememberMe was previously true
  useEffect(() => {
    const savedEmail = localStorage.getItem('rememberedEmail');
    const rememberMe = localStorage.getItem('rememberMe') === 'true';
    if (savedEmail && rememberMe) {
      setFormData(prev => ({ ...prev, email: savedEmail, rememberMe: true }));
    }

    // ✅ If already logged in, redirect immediately and replace history
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: manager } = await supabase
          .from('manager')
          .select('manager_id')
          .eq('user_id', session.user.id)
          .maybeSingle();
        if (manager) {
          window.history.replaceState(null, '', '/app');
          navigate('/app', { replace: true });
        }
      }
    };
    checkSession();

    // ✅ Prevent back button from showing login page after logout
    window.history.replaceState(null, '', window.location.href);
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

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email,
        password: password,
      });

      if (error) {
        let userMessage = 'Something went wrong. Please try again.';

        switch (error.message) {
          case 'Invalid login credentials':
            userMessage = 'Invalid email or password. Please try again.';
            break;
          case 'Email not confirmed':
            userMessage = 'Please confirm your email address before logging in. Check your inbox.';
            break;
          case 'User not found':
            userMessage = 'No account found with this email address.';
            break;
          case 'Invalid email':
          case 'Invalid password':
            userMessage = 'Invalid email or password. Please try again.';
            break;
          case 'Network request failed':
          case 'Failed to fetch':
            userMessage = 'Network connection issue. Please check your internet and try again.';
            break;
          default:
            console.error('Login error details:', error.message);
            userMessage = 'Something went wrong. Please try again.';
        }

        setErrorMsg(userMessage);
        setIsLoading(false);
        return;
      }

      // Check if user exists in manager table
      const { data: managerData, error: managerError } = await supabase
        .from('manager')
        .select('manager_id')
        .eq('user_id', data.user.id)
        .maybeSingle();

      if (managerError || !managerData) {
        await supabase.auth.signOut();
        setErrorMsg('Invalid email or password. Please try again.');
        setIsLoading(false);
        return;
      }

      // ✅ Store rememberMe preference and email
      localStorage.setItem('rememberMe', String(formData.rememberMe));
      if (formData.rememberMe) {
        localStorage.setItem('rememberedEmail', email);
      } else {
        localStorage.removeItem('rememberedEmail');
      }

      toast.success('Welcome back!');

      // ✅ Replace history completely so back button can't go back to login
      window.history.replaceState(null, '', '/app');
      navigate('/app', { replace: true });

    } catch (error) {
      console.error('Login error:', error.message);
      setErrorMsg('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans">
      <header className="bg-[#008A45] text-white h-[72px] flex items-center px-6 w-full shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white shadow-sm flex-shrink-0">
            <img src="/logo.svg" alt="Catersync" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold tracking-wide">Catersync</h1>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-slate-900 mb-2">Welcome back, Owner!</h2>
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
              <label className="block text-xs font-semibold text-slate-500 mb-1">Email</label>
              <input
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
              <label className="block text-xs font-semibold text-slate-500 mb-1">Password</label>
              <div className="relative">
                <input
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
                  aria-label="Toggle password visibility"
                  disabled={isLoading}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
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