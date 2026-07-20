// pages/SettingsPage.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Building2, 
  Lock, 
  Bell, 
  Save, 
  User, 
  Mail, 
  Phone, 
  MapPin, 
  AlertCircle,
  CheckCircle
} from 'lucide-react';
import { supabase } from '../supabase';

export default function SettingsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('general');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Manager profile state
  const [managerData, setManagerData] = useState({
    first_name: '',
    last_name: '',
    contact_no: '',
    email: '',
  });
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);

  // Password form state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  // Notification preferences (local only)
  const [notifications, setNotifications] = useState({
    newBooking: true,
    orderUpdates: true,
    paymentAlerts: true,
    marketing: false,
  });

  // --- Fetch manager profile ---
  const fetchManagerProfile = async () => {
    setIsLoadingProfile(true);
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        navigate('/login');
        return;
      }

      // Fetch manager record
      const { data: manager, error: managerError } = await supabase
        .from('manager')
        .select('first_name, last_name, contact_no')
        .eq('user_id', user.id)
        .single();

      if (managerError) throw managerError;

      setManagerData({
        first_name: manager.first_name || '',
        last_name: manager.last_name || '',
        contact_no: manager.contact_no || '',
        email: user.email || '',
      });
    } catch (error) {
      console.error('Error fetching manager profile:', error);
      setError('Failed to load profile data. Please refresh.');
    } finally {
      setIsLoadingProfile(false);
    }
  };

  useEffect(() => {
    fetchManagerProfile();
  }, [navigate]);

  // --- Handle profile update ---
  const handleProfileUpdate = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    setSuccess('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Update manager table
      const { error: updateError } = await supabase
        .from('manager')
        .update({
          first_name: managerData.first_name,
          last_name: managerData.last_name,
          contact_no: managerData.contact_no,
        })
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      // Also update user metadata if needed? Not required.

      setSuccess('Profile updated successfully!');
    } catch (error) {
      console.error('Error updating profile:', error);
      setError(error.message || 'Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  // --- Handle password update ---
  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setError('');
    setSuccess('');

    // Validate
    if (passwordForm.newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      setIsSaving(false);
      return;
    }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError('Passwords do not match.');
      setIsSaving(false);
      return;
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password: passwordForm.newPassword,
      });

      if (error) throw error;

      setSuccess('Password updated successfully!');
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      console.error('Error updating password:', error);
      setError(error.message || 'Failed to update password.');
    } finally {
      setIsSaving(false);
    }
  };

  // --- Handle notification save (local only) ---
  const handleNotificationSave = () => {
    // In the future, you could save these to a settings table or localStorage.
    // For now, just show a success message.
    setSuccess('Notification preferences saved!');
    setTimeout(() => setSuccess(''), 3000);
  };

  // --- Tabs ---
  const tabs = [
    { id: 'general', label: 'Business Profile', icon: Building2 },
    { id: 'security', label: 'Security', icon: Lock },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];

  return (
    <div className="max-w-5xl mx-auto animate-in fade-in duration-200">
      
      {/* HEADER */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-1">Manage your business profile, security, and system preferences.</p>
      </div>

      {/* TABS NAVIGATION */}
      <div className="border-b border-slate-200 mb-8">
        <nav className="flex space-x-8">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id);
                  setError('');
                  setSuccess('');
                }}
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

      {/* Error / Success Messages */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3 text-red-700 text-sm">
          <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3 text-green-700 text-sm">
          <CheckCircle size={18} className="mt-0.5 flex-shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* TAB CONTENT */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        
        {/* ================= GENERAL TAB ================= */}
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
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Mail size={16} className="text-slate-400" />
                    </div>
                    <input 
                      type="email" 
                      value={managerData.email}
                      disabled
                      className="w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm bg-slate-100 text-slate-600 cursor-not-allowed"
                    />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Email cannot be changed here. Use the "Forgot Password" flow if needed.</p>
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
                {isSaving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        )}

        {/* ================= SECURITY TAB ================= */}
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

        {/* ================= NOTIFICATIONS TAB ================= */}
        {activeTab === 'notifications' && (
          <div className="p-6 md:p-8">
            <h2 className="text-lg font-bold text-slate-900 mb-2">Email Notifications</h2>
            <p className="text-sm text-slate-500 mb-6">Choose what updates you want to receive via email.</p>
            
            <div className="space-y-4 mb-8 max-w-2xl">
              
              <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">New Bookings</h3>
                  <p className="text-xs text-slate-500 mt-1">Get notified when a new catering package is booked.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={notifications.newBooking} 
                    onChange={(e) => setNotifications({...notifications, newBooking: e.target.checked})}
                    className="sr-only peer" 
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#008A45]"></div>
                </label>
              </div>

              <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Short Order Updates</h3>
                  <p className="text-xs text-slate-500 mt-1">Receive alerts for new or cancelled short orders.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={notifications.orderUpdates} 
                    onChange={(e) => setNotifications({...notifications, orderUpdates: e.target.checked})}
                    className="sr-only peer" 
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#008A45]"></div>
                </label>
              </div>

              <div className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Payment Alerts</h3>
                  <p className="text-xs text-slate-500 mt-1">Get an email when a client completes a payment.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={notifications.paymentAlerts} 
                    onChange={(e) => setNotifications({...notifications, paymentAlerts: e.target.checked})}
                    className="sr-only peer" 
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#008A45]"></div>
                </label>
              </div>

            </div>

            <div className="pt-6 border-t border-slate-100 flex justify-end">
              <button 
                onClick={handleNotificationSave}
                className="bg-[#008A45] hover:bg-[#007038] text-white px-5 py-2.5 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 shadow-sm"
              >
                <Save size={18} />
                Save Preferences
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}