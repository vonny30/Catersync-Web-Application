// src/pages/ForgotPassword.jsx
import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, AlertCircle, ArrowLeft, MailCheck, Info, KeyRound } from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

// Supabase throttles reset emails per address. Matching that here means the
// button says how long to wait instead of letting someone press it three times
// and collect three "something went wrong" errors for a rule nobody told them
// about.
const RESEND_COOLDOWN_SECONDS = 60;

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  // Supabase's recovery email template can send either a link or an 8-digit
  // code, and this project's is configured for a code. The page accepts the
  // code here rather than assuming a link that never arrives — and the link
  // path still works, because ResetPassword takes either.
  const [code, setCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
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
      setCode('');
      setCooldown(RESEND_COOLDOWN_SECONDS);
      toast.success('Code sent.');
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
        setErrorMsg('Could not send the code. Try again, and if it keeps failing contact your administrator.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    const token = code.replace(/\s/g, '');
    if (!token) {
      setErrorMsg('Enter the code from the email.');
      return;
    }
    setErrorMsg('');
    setIsVerifying(true);
    try {
      // Exchanges the code for a recovery session. ResetPassword then finds
      // that session and lets the new password be set.
      const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token, type: 'recovery' });
      if (error) throw error;
      navigate('/reset-password');
    } catch (error) {
      console.error('Code verification error:', error);
      const raw = (error?.message || '').toLowerCase();
      // Supabase returns one message -- "Token has expired or is invalid" --
      // for both a mistyped code and a stale one, so it cannot tell them
      // apart and neither can we. Saying "expired" to someone who simply
      // fat-fingered a digit sends them to request a new code they do not
      // need. One message that covers both is the honest version.
      if (raw.includes('expired') || raw.includes('invalid') || raw.includes('token')) {
        setErrorMsg('That code is wrong or has expired. Check the email and re-enter it, or send a new code.');
      } else if (raw.includes('rate')) {
        setErrorMsg('Too many attempts. Wait a minute, then try again.');
      } else {
        setErrorMsg('Could not verify the code. Try again, or send a new one.');
      }
    } finally {
      setIsVerifying(false);
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
      <div className="relative overflow-hidden flex-[1_1_46%] min-w-0 hidden lg:flex flex-col justify-between px-[clamp(2rem,3.5vw,4.5rem)] py-[clamp(2.5rem,4vh,3.5rem)] bg-[linear-gradient(155deg,#00753b_0%,#008A45_45%,#00A854_100%)]">
        <div className="absolute -top-[120px] -right-[140px] w-[420px] h-[420px] rounded-full bg-white/[0.06]" />
        <div className="absolute -bottom-[180px] -left-[120px] w-[460px] h-[460px] rounded-full bg-white/[0.05]" />

        <div className="relative w-full max-w-[560px] mx-auto flex items-center gap-3.5">
          <div className="w-[52px] h-[52px] rounded-full overflow-hidden bg-white/10 ring-2 ring-white/50 shrink-0">
            <img src="/logo.svg" alt="CaterSync" className="w-full h-full object-cover" />
          </div>
          <span className="text-[clamp(22px,1.6vw,26px)] font-bold tracking-[0.02em] text-white">CaterSync</span>
        </div>

        <div className="relative w-full max-w-[560px] mx-auto py-8">
          <h2 className="text-[clamp(30px,2.7vw,46px)] leading-[1.18] font-bold tracking-[-0.025em] text-white [text-wrap:pretty]">
            Locked out? This takes about a minute.
          </h2>
          <p className="mt-5 text-[clamp(16px,1.15vw,19px)] leading-[1.55] text-white/85 [text-wrap:pretty]">
            We email you a code. You enter it, set a new password, and sign in again. Your bookings and records are untouched.
          </p>
        </div>

        <p className="relative w-full max-w-[560px] mx-auto text-[13.5px] text-white/60">
          &copy; {new Date().getFullYear()} PG&apos;s Catering. All rights reserved.
        </p>
      </div>

      <div className="flex-[1_1_54%] min-w-0 flex items-center justify-center px-[clamp(1.25rem,3.5vw,4.5rem)] py-[clamp(2.5rem,4vh,3.5rem)] bg-slate-50">
        <div className="w-full max-w-[440px]">
          <div className="flex lg:hidden items-center gap-3 mb-8">
            <div className="w-11 h-11 rounded-full overflow-hidden ring-2 ring-[#008A45]/20 shrink-0">
              <img src="/logo.svg" alt="CaterSync" className="w-full h-full object-cover" />
            </div>
            <span className="text-xl font-bold text-slate-900">CaterSync</span>
          </div>

          {!submitted ? (
            <>
              <h1 className="text-[clamp(28px,2.1vw,36px)] font-bold tracking-[-0.025em] text-slate-900">Reset your password</h1>
              {/* Say what pressing the button will do, before it is pressed. */}
              <p className="mt-2.5 mb-8 text-[clamp(15.5px,1.1vw,17px)] leading-[1.5] text-slate-600 [text-wrap:pretty]">
                Enter the email you sign in with and we&apos;ll send you an 8-digit code to set a new password.
              </p>

              {errorMsg && (
                <div className="flex items-start gap-2.5 mb-[22px] px-[15px] py-3.5 border border-[#f3c9c9] rounded-[11px] bg-[#fef4f4]">
                  <AlertCircle size={16} className="shrink-0 mt-px text-red-700" />
                  <span className="text-[14.5px] leading-[1.45] text-red-700 [text-wrap:pretty]">{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-[18px]">
                <div>
                  <label htmlFor="reset-email" className="block text-[14px] font-semibold text-slate-700 mb-2">
                    Email
                  </label>
                  <div className="relative">
                    <Mail size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      id="reset-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full border border-slate-200 rounded-[11px] pl-[46px] pr-4 py-[15px] text-[16px] text-slate-900 focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45] outline-none bg-white"
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
                  className={`w-full mt-1 py-3.5 rounded-xl bg-[#008A45] hover:bg-[#007038] text-white text-[16px] font-semibold transition-colors ${
                    isLoading ? 'opacity-70 cursor-not-allowed' : ''
                  }`}
                >
                  {isLoading ? 'Sending…' : 'Send code'}
                </button>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-[#EAF3F2] mb-5">
                <MailCheck size={22} className="text-[#007038]" />
              </div>
              <h1 className="text-[clamp(28px,2.1vw,36px)] font-bold tracking-[-0.025em] text-slate-900">Enter the code</h1>
              <p className="mt-2.5 text-[clamp(15.5px,1.1vw,17px)] leading-[1.5] text-slate-600 [text-wrap:pretty]">
                If an account exists for <strong className="font-semibold text-slate-900">{email}</strong>, we&apos;ve emailed it an 8-digit code.
              </p>

              {errorMsg && (
                <div className="flex items-start gap-2.5 mt-6 px-4 py-3.5 border border-[#f3c9c9] rounded-xl bg-[#fef4f4]">
                  <AlertCircle size={17} className="shrink-0 mt-px text-red-700" />
                  <span className="text-[14.5px] leading-[1.45] text-red-700 [text-wrap:pretty]">{errorMsg}</span>
                </div>
              )}

              {/* The code is the whole point of this screen, so it is the first
                  thing under the heading rather than buried below instructions. */}
              <form onSubmit={handleVerifyCode} className="mt-6">
                <label htmlFor="reset-code" className="block text-[14px] font-semibold text-slate-700 mb-2">
                  8-digit code
                </label>
                <div className="relative">
                  <KeyRound size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="reset-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={10}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl pl-[46px] pr-4 py-[15px] text-[18px] font-semibold tracking-[0.25em] tabular-nums text-slate-900 focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45] outline-none bg-white"
                    placeholder="00000000"
                    disabled={isVerifying}
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={isVerifying || !code.trim()}
                  className={`w-full mt-4 py-4 rounded-xl bg-[#008A45] hover:bg-[#007038] text-white text-[16px] font-semibold transition-colors ${
                    isVerifying || !code.trim() ? 'opacity-70 cursor-not-allowed' : ''
                  }`}
                >
                  {isVerifying ? 'Checking…' : 'Continue'}
                </button>
              </form>

              <ol className="mt-7 space-y-3.5">
                {[
                  'Open the email from CaterSync and copy the 8-digit code.',
                  'Paste it above, then set your new password.',
                  'No email after a minute? Check your spam or junk folder.',
                ].map((step, i) => (
                  <li key={step} className="flex items-start gap-3">
                    <span className="flex items-center justify-center w-[22px] h-[22px] shrink-0 rounded-full bg-[#EAF3F2] text-[#00703a] text-[12.5px] font-bold tabular-nums">
                      {i + 1}
                    </span>
                    <span className="text-[15px] leading-[1.5] text-slate-700 [text-wrap:pretty]">{step}</span>
                  </li>
                ))}
              </ol>

              <div className="flex items-start gap-2.5 mt-6 px-4 py-3.5 rounded-xl bg-white border border-slate-200">
                <Info size={16} className="shrink-0 mt-px text-slate-400" />
                <p className="text-[13.5px] leading-[1.5] text-slate-600 [text-wrap:pretty]">
                  The code expires after a short while, and sending a new one cancels the old. If your email shows a link instead of a code, clicking it works too.
                </p>
              </div>

              <button
                type="button"
                onClick={() => sendResetEmail(email.trim())}
                disabled={isLoading || cooldown > 0}
                className={`w-full mt-6 py-3 rounded-xl border border-slate-300 bg-white text-[15px] font-semibold text-slate-700 transition-colors ${
                  isLoading || cooldown > 0 ? 'opacity-60 cursor-not-allowed' : 'hover:bg-[#f4f9f6] hover:border-[#c9dfd4] hover:text-[#007038]'
                }`}
              >
                {isLoading ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Send a new code'}
              </button>

              <button
                type="button"
                onClick={() => { setSubmitted(false); setErrorMsg(''); setCode(''); }}
                className="w-full mt-2.5 py-2 text-[13.5px] font-semibold text-slate-600 hover:text-slate-900 transition-colors"
              >
                Use a different email address
              </button>
            </>
          )}

          <div className="mt-[26px] pt-[22px] border-t border-slate-100">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-[#007038] hover:text-[#00532a]"
            >
              <ArrowLeft size={15} /> Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
