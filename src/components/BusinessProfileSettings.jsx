// src/components/BusinessProfileSettings.jsx
//
// Settings -> Business Details: PG's Catering's name and public contact
// details (public.business_profile). What is saved here is what customers see
// on the Privacy Notice and Terms pages and wherever the web app names the
// business, so it is validated the same way the database checks it.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import { loadBusinessProfile, setBusinessProfile, formatPhone } from '../utils/businessProfile';

const INPUT = 'w-full border rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45]';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

// "+63 917 123 4567", "0917-123-4567", "639171234567" -> "09171234567"
export function normalizePhone(value) {
  const digits = (value || '').replace(/[^\d+]/g, '');
  if (/^\+?639\d{9}$/.test(digits)) return `0${digits.replace(/^\+?63/, '')}`;
  return digits;
}

const collapse = (value) => (value || '').replace(/\s+/g, ' ').trim();

/** Checks the Business Details form; returns { field: message } for each problem (empty when valid). */
export function validateBusiness(form) {
  const errors = {};
  const name = collapse(form.business_name);
  if (name.length < 2) errors.business_name = 'Enter the business name.';
  else if (name.length > 100) errors.business_name = 'Keep the business name under 100 characters.';

  const email = form.email.trim();
  if (!email) errors.email = 'Enter the email customers should write to.';
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address (e.g., name@domain.com).';

  const phone = normalizePhone(form.phone);
  if (!phone) errors.phone = 'Enter the mobile number customers should call.';
  else if (!/^09\d{9}$/.test(phone)) errors.phone = 'Use an 11-digit mobile number starting with 09 (e.g., 09171234567).';

  const address = collapse(form.address);
  if (!address) errors.address = 'Enter the business address.';
  else if (address.length < 10) errors.address = 'Enter the full address — street or barangay, city and province.';
  else if (address.length > 250) errors.address = 'Keep the address under 250 characters.';
  return errors;
}

const toForm = (p) => ({
  business_name: p?.business_name || '',
  email: p?.email || '',
  phone: p?.phone || '',
  address: p?.address || '',
});

export default function BusinessProfileSettings() {
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(null);
  const [form, setForm] = useState(toForm(null));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ignore = false;
    loadBusinessProfile({ force: true }).then((profile) => {
      if (ignore) return;
      setSaved(profile);
      setForm(toForm(profile));
      setLoading(false);
    });
    return () => { ignore = true; };
  }, []);

  const isComplete = !!(saved?.email && saved?.phone && saved?.address);
  const isDirty = useMemo(() => {
    const a = toForm(saved);
    return Object.keys(a).some((k) => (a[k] || '') !== (form[k] || ''));
  }, [saved, form]);

  const set = (name) => (e) => {
    const value = e.target.value;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const found = validateBusiness(form);
    setErrors(found);
    if (Object.keys(found).length) {
      toast.error(Object.values(found)[0]);
      return;
    }
    const payload = {
      business_name: collapse(form.business_name),
      email: form.email.trim().toLowerCase(),
      phone: normalizePhone(form.phone),
      address: collapse(form.address),
    };
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('business_profile')
        .update(payload)
        .eq('id', 1)
        .select('business_name, email, phone, address, updated_at')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('not-saved');
      setSaved(data);
      setForm(toForm(data));
      setBusinessProfile(data);
      toast.success('Business details saved.');
    } catch (err) {
      console.error('Save business profile failed:', err);
      const msg = err?.code === '23514'
        ? 'One of the details is not in the right format. Check the email, mobile number and address.'
        : err?.message === 'not-saved' || err?.code === '42501'
          ? 'Only a manager can change the business details.'
          : 'Could not save the business details. Please try again.';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const field = (name, label, props = {}) => (
    <div>
      <label htmlFor={`bp-${name}`} className="block text-sm font-semibold text-slate-700 mb-1.5">{label}</label>
      <input
        id={`bp-${name}`}
        value={form[name]}
        onChange={set(name)}
        className={`${INPUT} ${errors[name] ? 'border-red-400' : 'border-slate-300'}`}
        aria-invalid={!!errors[name]}
        disabled={saving}
        {...props}
      />
      {errors[name] && <p className="text-[12.5px] text-red-600 mt-1">{errors[name]}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} className="p-6 md:p-8" noValidate>
      <div className="mb-6">
        <h2 className="text-lg font-bold text-slate-900">Business Details</h2>
        <p className="text-sm text-slate-500 mt-1">
          The name and contact details customers see — on the Privacy Notice and Terms pages, and in the customer app.
          Keep them current.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#008A45] border-t-transparent"></div>
        </div>
      ) : (
        <>
          {!isComplete && (
            <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              The contact details are not filled in yet, so customers have no way to reach the business about their
              data or bookings. Add the email, mobile number and address below.
            </div>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            {field('business_name', 'Business name', { maxLength: 100, autoComplete: 'organization' })}
            {field('email', 'Email', { type: 'email', inputMode: 'email', placeholder: 'e.g. pgscatering@gmail.com', autoComplete: 'email', maxLength: 254 })}
            {field('phone', 'Mobile number', { inputMode: 'tel', placeholder: 'e.g. 09171234567', autoComplete: 'tel', maxLength: 16 })}
            <div className="md:col-span-2">
              <label htmlFor="bp-address" className="block text-sm font-semibold text-slate-700 mb-1.5">Address</label>
              <textarea
                id="bp-address"
                rows={2}
                value={form.address}
                onChange={set('address')}
                maxLength={250}
                placeholder="Street / barangay, Bayawan City, Negros Oriental"
                className={`${INPUT} resize-none ${errors.address ? 'border-red-400' : 'border-slate-300'}`}
                aria-invalid={!!errors.address}
                disabled={saving}
              />
              {errors.address && <p className="text-[12.5px] text-red-600 mt-1">{errors.address}</p>}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 mt-8 pt-6 border-t border-slate-200">
            <div className="text-[13px] text-slate-500">
              {saved?.updated_at && isComplete && (
                <>Shown to customers as {saved.email} · {formatPhone(saved.phone)}. </>
              )}
              <Link to="/privacy" target="_blank" className="inline-flex items-center gap-1 font-semibold text-[#007038] hover:text-[#00532a]">
                View Privacy Notice <ExternalLink size={12} />
              </Link>
            </div>
            <button
              type="submit"
              disabled={saving || !isDirty}
              className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-5 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <Save size={16} /> {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
