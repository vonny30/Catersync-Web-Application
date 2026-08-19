// src/pages/SettingsPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, Lock, Save, User, Mail, Phone, Pencil, X, Eye, EyeOff
} from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { getPasswordPolicyError } from '../utils/passwordPolicy';
import { verifyPassword } from '../utils/verifyPassword';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import PasswordChecklist from '../components/PasswordChecklist';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState('general');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // --- Change-email flow: hidden by default so it can't be confused with
  // (or accidentally triggered alongside) the profile fields below it. ---
  const [isChangingEmail, setIsChangingEmail] = useState(false);
  const [newEmailInput, setNewEmailInput] = useState('');

  const [managerData, setManagerData] = useState({
    first_name: '',
    last_name: '',
    contact_no: '',
    email: '',
  });
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState({
    current: false,
    next: false,
    confirm: false,
  });

  const [userId, setUserId] = useState(null);

  const handleError = (error, userMessage = 'Something went wrong.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // Shows a clear "logging you out" screen instead of leaving the manager
  // staring at the settings form while the sign-out happens in the
  // background, then hands off to the login page. The minimum delay just
  // keeps the transition from feeling like an abrupt flash if the sign-out
  // itself finishes very quickly.
  const logOutAfterSecurityChange = async () => {
    setIsLoggingOut(true);
    try {
      await Promise.all([
        logout(false, { silent: true }),
        new Promise((resolve) => setTimeout(resolve, 900)),
      ]);
    } catch (error) {
      console.error('Logout after security change failed:', error);
    }
    // Head to the login page regardless — the credential change already
    // went through, so staying logged in here isn't an option either way.
    navigate('/login', { replace: true });
  };

  const fetchManagerProfile = async () => {
    setIsLoadingProfile(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/login'); return; }
      setUserId(user.id);

      const { data: manager, error } = await supabase
        .from('manager')
        .select('first_name, last_name, contact_no, email')
        .eq('user_id', user.id)
        .single();

      if (error) throw error;

      setManagerData({
        first_name: manager.first_name || '',
        last_name: manager.last_name || '',
        contact_no: manager.contact_no || '',
        email: manager.email || user.email || '',
      });
    } catch (error) {
      handleError(error, 'Unable to load profile.');
    } finally {
      setIsLoadingProfile(false);
    }
  };

  useEffect(() => {
    fetchManagerProfile();
  }, [navigate]);

  // --- Profile Update ---
  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('manager')
        .update({
          first_name: managerData.first_name,
          last_name: managerData.last_name,
          contact_no: managerData.contact_no,
        })
        .eq('user_id', user.id);

      if (error) throw error;
      toast.success('Profile updated successfully!');
    } catch (error) {
      handleError(error, 'Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  // --- Email Update ---
  // Hidden behind an explicit "Change Email" click + a plain-language
  // confirmation dialog, so a manager can't trigger this by accident while
  // editing their name/phone, and knows up front that it logs them out.
  const openEmailChange = () => {
    setNewEmailInput(managerData.email || '');
    setIsChangingEmail(true);
  };

  const cancelEmailChange = () => {
    setIsChangingEmail(false);
    setNewEmailInput('');
  };

  const handleEmailUpdate = async () => {
    const newEmail = newEmailInput.trim();
    if (!newEmail) {
      toast.error('Please enter the new email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      toast.error('Please enter a valid email address.');
      return;
    }
    if (newEmail.toLowerCase() === (managerData.email || '').toLowerCase()) {
      toast.error('That\'s already your current email.');
      return;
    }

    const proceed = await showConfirm({
      title: 'Change your login email?',
      message: `Here's what happens next:\n\n1. We'll send a confirmation link to ${newEmail}.\n2. You'll be logged out right after this.\n3. Open that email and click the link to confirm the change.\n4. Log back in using ${newEmail}.\n\nUntil you click the link, keep logging in with your current email.`,
      confirmLabel: 'Send Confirmation Link',
      cancelLabel: 'Cancel',
      confirmVariant: 'warning',
    });
    if (!proceed) return;

    setIsSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error: authError } = await supabase.auth.updateUser({
        email: newEmail,
      });
      if (authError) throw authError;

      const { error: managerError } = await supabase
        .from('manager')
        .update({ email: newEmail })
        .eq('user_id', user.id);

      if (managerError) {
        console.warn('Manager email update failed:', managerError);
      }

      toast.success(
        `Confirmation link sent to ${newEmail}. You've been logged out — check that inbox and click the link, then log back in with your new email.`,
        { duration: 9000 }
      );

      await logOutAfterSecurityChange();

    } catch (error) {
      handleError(error, 'Failed to update email. The new address might be in use.');
    } finally {
      setIsSaving(false);
    }
  };
// --- Password Update (with current password verification) ---
  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    setIsSaving(true);

    const policyError = getPasswordPolicyError(passwordForm.newPassword);
    if (policyError) {
      toast.error(policyError);
      setIsSaving(false);
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Passwords do not match.');
      setIsSaving(false);
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // 1. Verify current password — via the isolated throwaway client
      // (see utils/verifyPassword.js), not the shared app client, so this
      // doesn't fire a real SIGNED_IN event through the single-session-lock
      // logic in AuthContext.jsx.
      const isCorrect = await verifyPassword(user.email, passwordForm.currentPassword);
      if (!isCorrect) {
        toast.error('Current password is incorrect.');
        setIsSaving(false);
        return;
      }

      // 2. Update to new password
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });
      if (error) throw error;

      // --- ADDED LOGIC: Clear instructions, log out, and redirect ---
      toast.success(
        'Password updated successfully! For security, you have been logged out. Please log in with your new password.',
        { duration: 8000 }
      );

      await logOutAfterSecurityChange();

    } catch (error) {
      handleError(error, 'Failed to update password.');
    } finally {
      setIsSaving(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'Business Profile', icon: Building2 },
    { id: 'security', label: 'Security', icon: Lock },
  ];

  if (isLoggingOut) {
    return (
      <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-white animate-in fade-in duration-300">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-[#008A45] mx-auto mb-4"></div>
          <p className="text-slate-900 font-semibold text-lg">Logging you out for security...</p>
          <p className="text-slate-500 text-sm mt-1">You'll be back at the login page in a moment.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto animate-in fade-in duration-200">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your business profile and security.</p>
      </div>

      <div className="border-b border-slate-200 mb-8">
        <nav className="flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                  isActive 
                    ? 'border-[#008A45] text-[#008A45]' 
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }`}
              >
                <Icon size={18} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        
        {activeTab === 'general' && (
          <form onSubmit={handleProfileUpdate} className="p-6 md:p-8">
            <h2 className="text-lg font-bold text-slate-900 mb-6">Manager Profile</h2>
            {isLoadingProfile ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#008A45] border-t-transparent"></div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">First Name</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User size={16} className="text-slate-400" />
                    </div>
                    <input 
                      type="text" 
                      value={managerData.first_name}
                      onChange={(e) => setManagerData({...managerData, first_name: e.target.value})}
                      className="w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none transition-all"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Last Name</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User size={16} className="text-slate-400" />
                    </div>
                    <input 
                      type="text" 
                      value={managerData.last_name}
                      onChange={(e) => setManagerData({...managerData, last_name: e.target.value})}
                      className="w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none transition-all"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Contact Number</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Phone size={16} className="text-slate-400" />
                    </div>
                    <input 
                      type="text" 
                      value={managerData.contact_no}
                      onChange={(e) => setManagerData({...managerData, contact_no: e.target.value})}
                      className="w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none transition-all"
                      placeholder="e.g. 09123456789"
                    />
                  </div>
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-bold text-slate-700">Login Email</label>

                  {!isChangingEmail ? (
                    <div className="flex items-center gap-3 border border-slate-200 rounded-lg px-3 py-2.5 bg-slate-50">
                      <Mail size={16} className="text-slate-400 shrink-0" />
                      <span className="text-sm text-slate-700 flex-1 truncate">{managerData.email}</span>
                      <button
                        type="button"
                        onClick={openEmailChange}
                        className="flex items-center gap-1.5 text-sm font-medium text-[#008A45] hover:text-[#007038] transition-colors whitespace-nowrap"
                      >
                        <Pencil size={14} />
                        Change Email
                      </button>
                    </div>
                  ) : (
                    <div className="border border-[#008A45]/30 bg-[#008A45]/5 rounded-lg p-4 space-y-3">
                      <p className="text-xs text-slate-600">
                        Enter the new email address. We'll send a confirmation link there —
                        you'll be logged out and need to click that link before logging back in.
                      </p>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                            <Mail size={16} className="text-slate-400" />
                          </div>
                          <input
                            type="email"
                            autoFocus
                            value={newEmailInput}
                            onChange={(e) => setNewEmailInput(e.target.value)}
                            placeholder="new.email@example.com"
                            className="w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none transition-all bg-white"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleEmailUpdate}
                          disabled={isSaving}
                          className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
                        >
                          {isSaving ? 'Sending...' : 'Send Confirmation Link'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelEmailChange}
                          disabled={isSaving}
                          aria-label="Cancel changing email"
                          className="px-3 py-2 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-50"
                        >
                          <X size={18} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="pt-6 border-t border-slate-100 flex justify-end">
              <button 
                type="submit" 
                disabled={isSaving || isLoadingProfile}
                className="bg-[#008A45] hover:bg-[#007038] text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 shadow-sm disabled:opacity-70"
              >
                <Save size={18} />
                {isSaving ? 'Saving...' : 'Save Profile Changes'}
              </button>
            </div>
          </form>
        )}

        {activeTab === 'security' && (
          <form onSubmit={handlePasswordUpdate} className="p-6 md:p-8">
            <h2 className="text-lg font-bold text-slate-900 mb-2">Update Password</h2>
            <p className="text-sm text-slate-500 mb-6">Ensure your account is using a long, random password to stay secure.</p>
            <div className="max-w-md space-y-5 mb-8">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Current Password</label>
                <div className="relative">
                  <input
                    type={showPassword.current ? 'text' : 'password'}
                    placeholder="Enter current password"
                    value={passwordForm.currentPassword}
                    onChange={(e) => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                    className="w-full px-3 py-2.5 pr-10 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none transition-all"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword({...showPassword, current: !showPassword.current})}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={showPassword.current ? 'Hide password' : 'Show password'}
                    title={showPassword.current ? 'Hide password' : 'Show password'}
                  >
                    {showPassword.current ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">New Password</label>
                <div className="relative">
                  <input
                    type={showPassword.next ? 'text' : 'password'}
                    placeholder="Enter new password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                    className="w-full px-3 py-2.5 pr-10 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none transition-all"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword({...showPassword, next: !showPassword.next})}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={showPassword.next ? 'Hide password' : 'Show password'}
                    title={showPassword.next ? 'Hide password' : 'Show password'}
                  >
                    {showPassword.next ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {passwordForm.newPassword && <PasswordChecklist password={passwordForm.newPassword} />}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Confirm New Password</label>
                <div className="relative">
                  <input
                    type={showPassword.confirm ? 'text' : 'password'}
                    placeholder="Confirm new password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                    className="w-full px-3 py-2.5 pr-10 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none transition-all"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword({...showPassword, confirm: !showPassword.confirm})}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={showPassword.confirm ? 'Hide password' : 'Show password'}
                    title={showPassword.confirm ? 'Hide password' : 'Show password'}
                  >
                    {showPassword.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {passwordForm.confirmPassword && passwordForm.confirmPassword !== passwordForm.newPassword && (
                  <p className="text-xs text-red-500 mt-1">Passwords don't match yet.</p>
                )}
              </div>
            </div>
            <div className="pt-6 border-t border-slate-100 flex justify-end">
              <button 
                type="submit" 
                disabled={isSaving}
                className="bg-[#008A45] hover:bg-[#007038] text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 shadow-sm disabled:opacity-70"
              >
                <Lock size={18} />
                {isSaving ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}