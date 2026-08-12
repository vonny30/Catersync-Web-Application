// src/pages/ForgotPassword.jsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email) {
      toast.error('Please enter your email address.');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSubmitted(true);
      toast.success('Password reset link sent to your email!');
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
          <h2 className="text-2xl font-bold text-slate-900 text-center mb-6">Reset Password</h2>

          {submitted ? (
            <div className="text-center">
              <p className="text-sm text-slate-600 mb-4">
                We've sent a password reset link to <strong>{email}</strong>.
                Please check your inbox and click the link to set a new password.
              </p>
              <Link to="/login" className="text-[#008A45] hover:underline font-medium">
                Back to Login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-slate-300 rounded-md p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                  required
                  placeholder="Enter your email"
                />
              </div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm py-2.5 rounded transition-colors shadow-sm disabled:opacity-70"
              >
                {isLoading ? 'Sending...' : 'Send Reset Link'}
              </button>
              <p className="text-center text-sm text-slate-500">
                Remember your password?{' '}
                <Link to="/login" className="text-[#008A45] hover:underline font-medium">
                  Login
                </Link>
              </p>
            </form>
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