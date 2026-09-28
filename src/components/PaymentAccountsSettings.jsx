// src/components/PaymentAccountsSettings.jsx
//
// Settings -> Payment Details: the GCash and bank accounts customers pay into.
// The manager keeps them here; the customer mobile app reads the ACTIVE rows
// of public.payment_account and shows them when the customer pays online, so
// changing an account here changes what every customer sees — no app update.
//
// The table is created by sql/payment_accounts.sql. Until that has been run,
// this section says so instead of failing.
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Pencil, Trash2, X, Save, Landmark, Smartphone } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import { useConfirm } from '../contexts/ConfirmContext';
import { getCurrentManagerId } from '../utils/currentManager';
import Select from './Select';
import ImageUploadField from './ImageUploadField';

const METHODS = ['GCash', 'Bank Transfer'];
const MAX_QR_BYTES = 5 * 1024 * 1024;
const QR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const EMPTY_FORM = {
  method: 'GCash', bank_name: '', account_name: '', account_number: '',
  instructions: '', is_active: true, qr_image_url: null,
};
const INPUT = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none';

// PostgREST says "table not found" in two ways depending on version.
const isMissingTable = (error) => error?.code === '42P01' || error?.code === 'PGRST205'
  || /payment_account/.test(error?.message || '');

function validate(form) {
  const errors = {};
  if (!METHODS.includes(form.method)) errors.method = 'Choose GCash or Bank Transfer.';
  if (form.method === 'Bank Transfer' && !form.bank_name.trim()) errors.bank_name = 'Enter the bank name.';
  if (!form.account_name.trim()) errors.account_name = 'Enter the account name.';
  if (!form.account_number.trim()) errors.account_number = form.method === 'GCash' ? 'Enter the GCash number.' : 'Enter the account number.';
  return errors;
}

function AccountFormModal({ account, onClose, onSaved }) {
  const [form, setForm] = useState(account ? {
    method: account.method,
    bank_name: account.bank_name || '',
    account_name: account.account_name || '',
    account_number: account.account_number || '',
    instructions: account.instructions || '',
    is_active: account.is_active,
    qr_image_url: account.qr_image_url || null,
  } : EMPTY_FORM);
  const [qrFile, setQrFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (name, value) => {
    setForm(prev => ({ ...prev, [name]: value }));
    setErrors(prev => ({ ...prev, [name]: undefined }));
  };

  const pickQr = (e) => {
    const file = e.target.files?.[0] || null;
    if (file && !QR_TYPES.includes(file.type)) { setErrors(prev => ({ ...prev, qr: 'Upload a JPEG, PNG, WebP or GIF image.' })); return; }
    if (file && file.size > MAX_QR_BYTES) { setErrors(prev => ({ ...prev, qr: 'The image is larger than 5 MB.' })); return; }
    setQrFile(file);
    setErrors(prev => ({ ...prev, qr: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const found = validate(form);
    if (Object.keys(found).length) { setErrors(found); toast.error(Object.values(found)[0]); return; }
    setSaving(true);
    try {
      let qrUrl = form.qr_image_url;
      if (qrFile) {
        const ext = qrFile.name.split('.').pop();
        const path = `payment-accounts/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('images').upload(path, qrFile);
        if (uploadError) throw new Error('Could not upload the QR image. Please try again.');
        qrUrl = supabase.storage.from('images').getPublicUrl(path).data.publicUrl;
      }
      const payload = {
        method: form.method,
        // A GCash account has no bank; never store a stale one from switching.
        bank_name: form.method === 'Bank Transfer' ? form.bank_name.trim() : null,
        account_name: form.account_name.trim(),
        account_number: form.account_number.trim(),
        instructions: form.instructions.trim() || null,
        is_active: form.is_active,
        qr_image_url: qrUrl,
        updated_at: new Date().toISOString(),
        updated_by: await getCurrentManagerId(),
      };
      const { error } = account
        ? await supabase.from('payment_account').update(payload).eq('account_id', account.account_id)
        : await supabase.from('payment_account').insert([payload]);
      if (error) throw error;
      toast.success(account ? 'Payment account updated.' : 'Payment account added.');
      onSaved();
    } catch (err) {
      console.error('Save payment account failed:', err);
      toast.error(err.message || 'Could not save the payment account.');
    } finally {
      setSaving(false);
    }
  };

  const fieldError = (name) => errors[name] && <p className="text-xs text-red-600 mt-1 font-semibold">{errors[name]}</p>;

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-bold text-slate-900">{account ? 'Edit Payment Account' : 'Add Payment Account'}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto bg-[#fbfcfd] space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Method<span className="text-red-500 ml-1">*</span></label>
            <Select value={form.method} onChange={(e) => set('method', e.target.value)} className={INPUT}>
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>
          {form.method === 'Bank Transfer' && (
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Bank Name<span className="text-red-500 ml-1">*</span></label>
              <input value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)} placeholder="e.g. BDO, BPI, Landbank" className={INPUT} maxLength={80} />
              {fieldError('bank_name')}
            </div>
          )}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Account Name<span className="text-red-500 ml-1">*</span></label>
            <input value={form.account_name} onChange={(e) => set('account_name', e.target.value)} placeholder="Name registered on the account" className={INPUT} maxLength={120} />
            {fieldError('account_name')}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">{form.method === 'GCash' ? 'GCash Number' : 'Account Number'}<span className="text-red-500 ml-1">*</span></label>
            <input value={form.account_number} onChange={(e) => set('account_number', e.target.value)} placeholder={form.method === 'GCash' ? '09XX XXX XXXX' : 'Account number'} className={INPUT} maxLength={60} />
            {fieldError('account_number')}
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Instructions for the customer <span className="font-normal text-slate-400">(optional)</span></label>
            <textarea rows={3} value={form.instructions} onChange={(e) => set('instructions', e.target.value)} placeholder="e.g. Put your booking reference in the message." className={INPUT} maxLength={500} />
          </div>
          <div>
            <ImageUploadField
              label="QR Code"
              note="(optional)"
              file={qrFile}
              existingUrl={form.qr_image_url}
              onChange={pickQr}
              error={errors.qr}
              hint="PNG, JPG up to 5MB. Customers can scan it to pay."
            />
            {(qrFile || form.qr_image_url) && (
              <button type="button" onClick={() => { setQrFile(null); set('qr_image_url', null); }} className="mt-1.5 text-[12.5px] font-semibold text-red-600 hover:underline">
                Remove QR code
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="h-4 w-4 accent-[#008A45]" />
            Show this account to customers
          </label>
        </div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">
          <button type="button" onClick={onClose} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-5 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
          <button type="submit" disabled={saving} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-5 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-60 flex items-center gap-2">
            <Save size={16} /> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

export default function PaymentAccountsSettings() {
  const { showConfirm } = useConfirm();
  const [state, setState] = useState({ loading: true, missing: false, rows: [] });
  const [editing, setEditing] = useState(null); // null | 'new' | account row

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('payment_account')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('method', { ascending: true })
      .order('account_name', { ascending: true });
    if (error) {
      if (isMissingTable(error)) { setState({ loading: false, missing: true, rows: [] }); return; }
      console.error('Load payment accounts failed:', error);
      toast.error('Could not load the payment accounts.');
    }
    setState({ loading: false, missing: false, rows: data || [] });
  }, []);

  useEffect(() => {
    let ignore = false;
    (async () => { if (!ignore) await load(); })();
    return () => { ignore = true; };
  }, [load]);

  const toggleActive = async (row) => {
    const { error } = await supabase.from('payment_account')
      .update({ is_active: !row.is_active, updated_at: new Date().toISOString(), updated_by: await getCurrentManagerId() })
      .eq('account_id', row.account_id);
    if (error) { console.error(error); toast.error('Could not update the account.'); return; }
    toast.success(row.is_active ? 'Hidden from customers.' : 'Shown to customers.');
    load();
  };

  const remove = async (row) => {
    const confirmed = await showConfirm({
      title: 'Remove this payment account?',
      message: `${row.method}${row.bank_name ? ` (${row.bank_name})` : ''} · ${row.account_name} · ${row.account_number} will no longer be shown to customers. To hide it only for a while, switch it off instead.`,
      confirmLabel: 'Remove',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;
    const { error } = await supabase.from('payment_account').delete().eq('account_id', row.account_id);
    if (error) { console.error(error); toast.error('Could not remove the account.'); return; }
    toast.success('Payment account removed.');
    load();
  };

  return (
    <div className="p-6 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Payment Details</h2>
          <p className="text-sm text-slate-500 mt-1">The GCash and bank accounts customers pay into. Active accounts are shown in the customer app.</p>
        </div>
        {!state.missing && (
          <button type="button" onClick={() => setEditing('new')} className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2.5 rounded-lg font-semibold text-sm transition-colors flex items-center gap-2 shadow-sm">
            <Plus size={16} /> Add Account
          </button>
        )}
      </div>

      {state.loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#008A45] border-t-transparent"></div>
        </div>
      ) : state.missing ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Payment details are not set up in the database yet. Run <span className="font-mono">sql/payment_accounts.sql</span> in the Supabase SQL editor, then refresh this page.
        </div>
      ) : state.rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
          No payment accounts yet. Add the GCash number and bank account customers should pay into.
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          {state.rows.map(row => {
            const Icon = row.method === 'GCash' ? Smartphone : Landmark;
            return (
              <div key={row.account_id} className={`rounded-xl border p-4 ${row.is_active ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#EAF3F2] flex items-center justify-center shrink-0">
                      <Icon size={17} className="text-[#007038]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-bold text-slate-900">
                        {row.method}{row.bank_name ? ` · ${row.bank_name}` : ''}
                      </p>
                      <p className="text-[13.5px] text-slate-700 mt-0.5 break-words">{row.account_name}</p>
                      <p className="text-[14px] font-semibold text-slate-900 tabular-nums mt-0.5 break-all">{row.account_number}</p>
                      {row.instructions && <p className="text-[12.5px] text-slate-500 mt-1.5 whitespace-pre-line">{row.instructions}</p>}
                    </div>
                  </div>
                  {row.qr_image_url && (
                    <img src={row.qr_image_url} alt="QR code" className="w-16 h-16 rounded-lg border border-slate-200 object-cover shrink-0" />
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 mt-4 pt-3 border-t border-slate-100">
                  <button type="button" onClick={() => toggleActive(row)} className={`text-[12.5px] font-semibold px-2.5 py-1 rounded-full border ${row.is_active ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-slate-100 border-slate-300 text-slate-600'}`} title={row.is_active ? 'Click to hide from customers' : 'Click to show to customers'}>
                    {row.is_active ? 'Shown to customers' : 'Hidden'}
                  </button>
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => setEditing(row)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-[12.5px] font-semibold">
                      <Pencil size={13} /> Edit
                    </button>
                    <button type="button" onClick={() => remove(row)} className="flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 text-red-400 hover:bg-red-50 hover:text-red-600" title="Remove" aria-label="Remove">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <AccountFormModal
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}
