// src/pages/SettingsPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, Lock, Save, User, Mail, Phone
} from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('general');
  const [isSaving, setIsSaving] = useState(false);

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

  const [userId, setUserId] = useState(null);

  const handleError = (error, userMessage = 'Something went wrong.') => {
    console.error('Error:', error);
    toast.error(userMessage);
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
  const handleEmailUpdate = async () => {
    const newEmail = managerData.email.trim();
    if (!newEmail) {
      toast.error('Email cannot be empty.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      toast.error('Please enter a valid email address.');
      return;
    }

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
        'A confirmation email has been sent to your new address. ' +
        'Please verify it to complete the change.',
        { duration: 6000 }
      );
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

    if (passwordForm.newPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
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

      // 1. Verify current password
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: passwordForm.currentPassword,
      });
      if (signInError) {
        toast.error('Current password is incorrect.');
        setIsSaving(false);
        return;
      }

      // 2. Update to new password
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });
      if (error) throw error;

      toast.success('Password updated successfully!');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
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

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        
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

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Email Address</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Mail size={16} className="text-slate-400" />
                      </div>
                      <input 
                        type="email" 
                        value={managerData.email}
                        onChange={(e) => setManagerData({...managerData, email: e.target.value})}
                        className="w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none transition-all"
                        required
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleEmailUpdate}
                      disabled={isSaving}
                      className="bg-[#008A45] hover:bg-[#007038] text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
                    >
                      {isSaving ? 'Sending...' : 'Update Email'}
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Changing your email will send a confirmation link to the new address. 
                    The change will take effect after verification.
                  </p>
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
                <input 
                  type="password" 
                  placeholder="Enter current password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, currentPassword: e.target.value})}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none transition-all"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">New Password</label>
                <input 
                  type="password" 
                  placeholder="Enter new password (min 6 characters)"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, newPassword: e.target.value})}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none transition-all"
                  required
                  minLength="6"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Confirm New Password</label>
                <input 
                  type="password" 
                  placeholder="Confirm new password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({...passwordForm, confirmPassword: e.target.value})}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45] focus:border-[#008A45] outline-none transition-all"
                  required
                />
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