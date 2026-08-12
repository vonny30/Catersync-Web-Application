// src/pages/ResetPassword.jsx
import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isValidToken, setIsValidToken] = useState(false);

  useEffect(() => {
    // Check for recovery token in URL hash (Supabase default)
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const accessToken = hashParams.get('access_token');
    const type = hashParams.get('type');

    if (accessToken && type === 'recovery') {
      setIsValidToken(true);
    } else {
      // Also check query params as fallback
      const queryParams = new URLSearchParams(window.location.search);
      const token = queryParams.get('token');
      if (token) {
        setIsValidToken(true);
      } else {
        toast.error('Invalid or missing reset link. Please request a new one.');
        navigate('/forgot-password');
      }
    }
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      // Supabase will use the recovery session automatically
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;

      toast.success('Password updated successfully! Please log in with your new password.');
      await supabase.auth.signOut();
      navigate('/login');
    } catch (error) {
      console.error('Reset error:', error);
      toast.error('Something went wrong. Please try again.');
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
        <div className="bg-[#F8F9FA] border-2 border-slate-200 rounded-lg shadow-lg w-full max-w-md p-10">
          <h2 className="text-2xl font-bold text-slate-900 text-center mb-6">Set New Password</h2>

          {isValidToken ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">New Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-md p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                  required
                  minLength="6"
                  placeholder="Enter new password (min 6 characters)"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-md p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                  required
                  placeholder="Confirm your new password"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm py-2.5 rounded transition-colors shadow-sm disabled:opacity-70"
              >
                {isLoading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          ) : (
            <div className="text-center text-sm text-slate-600">
              <p>Invalid or expired reset link.</p>
              <Link to="/forgot-password" className="text-[#008A45] hover:underline font-medium mt-2 inline-block">
                Request a new link
              </Link>
            </div>
          )}
        </div>
      </main>

      <footer className="bg-[#C1DEDC] py-5 text-center flex items-center justify-center gap-4 text-xs font-semibold text-slate-800">
        <span>@2023 all rights reserved</span>
        <span>PG's Catering</span>
      </footer>
    </div>
  );
}