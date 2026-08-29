// src/pages/ForgotPassword.jsx
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Mail, AlertCircle, ArrowLeft, MailCheck, Info } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

// Supabase throttles reset emails per address. Matching that here means the
// button says how long to wait instead of letting someone press it three times
// and collect three "something went wrong" errors for a rule nobody told them
// about.
const RESEND_COOLDOWN_SECONDS = 60;

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef(null);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    cooldownRef.current = setTimeout(() => setCooldown(c => c - 1), 1000);
    return () => clearTimeout(cooldownRef.current);
  }, [cooldown]);

  const sendResetEmail = async (address) => {
    setErrorMsg('');
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(address, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setSubmitted(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      toast.success('Reset link sent.');
    } catch (error) {
      console.error('Reset error:', error);
      // Name the two failures a person can actually act on. "Something went
      // wrong" for a rate limit tells them to retry, which is the one thing
      // that cannot work.
      const raw = (error?.message || '').toLowerCase();
      if (raw.includes('rate') || raw.includes('security purposes') || error?.status === 429) {
        setErrorMsg('Too many reset requests for this address. Wait a minute, then try again.');
      } else if (raw.includes('network') || raw.includes('fetch')) {
        setErrorMsg('Could not reach the server. Check your connection and try again.');
      } else {
        setErrorMsg('Could not send the reset link. Try again, and if it keeps failing contact your administrator.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) {
      setErrorMsg('Enter the email address you sign in with.');
      return;
    }
    sendResetEmail(address);
  };

  return (
    <div className="min-h-screen flex font-sans">
      {/* Same brand panel as the sign-in page, so this does not read as a
          different product the moment something goes wrong. */}
      <div className="relative overflow-hidden flex-[1_1_46%] min-w-0 hidden lg:flex flex-col justify-between px-12 py-11 bg-[linear-gradient(155deg,#00753b_0%,#008A45_45%,#00A854_100%)]">
        <div className="absolute -top-[120px] -right-[140px] w-[420px] h-[420px] rounded-full bg-white/[0.06]" />
        <div className="absolute -bottom-[180px] -left-[120px] w-[460px] h-[460px] rounded-full bg-white/[0.05]" />

        <div className="relative flex items-center gap-3">
          <div className="w-[46px] h-[46px] rounded-full overflow-hidden bg-white/10 ring-2 ring-white/50 shrink-0">
            <img src="/logo.svg" alt="CaterSync" className="w-full h-full object-cover" />
          </div>
          <span className="text-[22px] font-bold tracking-[0.02em] text-white">CaterSync</span>
        </div>

        <div className="relative max-w-[420px]">
          <h2 className="text-[34px] leading-[1.2] font-bold tracking-[-0.025em] text-white [text-wrap:pretty]">
            Locked out? This takes about a minute.
          </h2>
          <p className="mt-4 text-[15.5px] leading-[1.55] text-white/80 [text-wrap:pretty]">
            We email you a link. You open it, set a new password, and sign in again. Your bookings and records are untouched.
          </p>
        </div>

        <p className="relative text-[13px] text-white/60">
          &copy; {new Date().getFullYear()} PG&apos;s Catering. All rights reserved.
        </p>
      </div>

      <div className="flex-[1_1_54%] min-w-0 flex items-center justify-center px-8 py-11 bg-slate-50">
        <div className="w-full max-w-[392px]">
          <div className="flex lg:hidden items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-full overflow-hidden ring-2 ring-[#008A45]/20 shrink-0">
              <img src="/logo.svg" alt="CaterSync" className="w-full h-full object-cover" />
            </div>
            <span className="text-xl font-bold text-slate-900">CaterSync</span>
          </div>

          {!submitted ? (
            <>
              <h1 className="text-[28px] font-bold tracking-[-0.025em] text-slate-900">Reset your password</h1>
              {/* Say what pressing the button will do, before it is pressed. */}
              <p className="mt-2 mb-[30px] text-[15px] leading-[1.5] text-slate-600 [text-wrap:pretty]">
                Enter the email you sign in with and we&apos;ll send you a link to set a new password.
              </p>

              {errorMsg && (
                <div className="flex items-start gap-2.5 mb-[22px] px-[15px] py-3.5 border border-[#f3c9c9] rounded-[11px] bg-[#fef4f4]">
                  <AlertCircle size={16} className="shrink-0 mt-px text-red-700" />
                  <span className="text-[13.5px] leading-[1.45] text-red-700 [text-wrap:pretty]">{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
                <div>
                  <label htmlFor="reset-email" className="block text-[13px] font-semibold text-slate-700 mb-[7px]">
                    Email
                  </label>
                  <div className="relative">
                    <Mail size={17} className="absolute left-[15px] top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      id="reset-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full border border-slate-200 rounded-[11px] pl-[42px] pr-[15px] py-[13px] text-[15px] focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45] outline-none bg-white"
                      required
                      placeholder="Enter your email"
                      disabled={isLoading}
                      autoFocus
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className={`w-full mt-1 py-3.5 rounded-[11px] bg-[#008A45] hover:bg-[#007038] text-white text-[15px] font-semibold transition-colors ${
                    isLoading ? 'opacity-70 cursor-not-allowed' : ''
                  }`}
                >
                  {isLoading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[#EAF3F2] mb-5">
                <MailCheck size={22} className="text-[#007038]" />
              </div>
              <h1 className="text-[28px] font-bold tracking-[-0.025em] text-slate-900">Check your email</h1>
              <p className="mt-2 text-[15px] leading-[1.5] text-slate-600 [text-wrap:pretty]">
                If an account exists for <strong className="font-semibold text-slate-900">{email}</strong>, a reset link is on its way.
              </p>

              {/* The old screen said "check your inbox" and stopped there. These
                  are the three things people actually get stuck on: which
                  folder, how long the link lasts, and what to do when nothing
                  arrives. */}
              <ol className="mt-[26px] space-y-3.5">
                {[
                  'Open the email from CaterSync and click the reset link.',
                  'Set your new password, then sign in with it.',
                  'No email after a minute? Check your spam or junk folder.',
                ].map((step, i) => (
                  <li key={step} className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-[22px] h-[22px] shrink-0 rounded-full bg-[#EAF3F2] text-[#00703a] text-[12.5px] font-bold tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-[14px] leading-[1.5] text-slate-700 [text-wrap:pretty]">{step}</span>
                  </li>
                ))}
              </ol>

              <div className="flex items-start gap-[9px] mt-[22px] px-[15px] py-3.5 rounded-[11px] bg-white border border-slate-200">
                <Info size={15} className="shrink-0 mt-px text-slate-400" />
                <p className="text-[13px] leading-[1.5] text-slate-600 [text-wrap:pretty]">
                  The link expires after a short while. If it has, request a new one — old links stop working once a newer one is sent.
                </p>
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2.5 mt-[18px] px-[15px] py-3.5 border border-[#f3c9c9] rounded-[11px] bg-[#fef4f4]">
                  <AlertCircle size={16} className="shrink-0 mt-px text-red-700" />
                  <span className="text-[13.5px] leading-[1.45] text-red-700 [text-wrap:pretty]">{errorMsg}</span>
                </div>
              )}

              <button
                type="button"
                onClick={() => sendResetEmail(email.trim())}
                disabled={isLoading || cooldown > 0}
                className={`w-full mt-[22px] py-3 rounded-[11px] border border-slate-300 bg-white text-[14.5px] font-semibold text-slate-700 transition-colors ${
                  isLoading || cooldown > 0 ? 'opacity-60 cursor-not-allowed' : 'hover:bg-[#f4f9f6] hover:border-[#c9dfd4] hover:text-[#007038]'
                }`}
              >
                {isLoading ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend the link'}
              </button>

              <button
                type="button"
                onClick={() => { setSubmitted(false); setErrorMsg(''); }}
                className="w-full mt-2.5 py-2 text-[13.5px] font-semibold text-slate-600 hover:text-slate-900 transition-colors"
              >
                Use a different email address
              </button>
            </>
          )}

          <div className="mt-[26px] pt-[22px] border-t border-slate-100">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-[#007038] hover:text-[#00532a]"
            >
              <ArrowLeft size={15} /> Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
