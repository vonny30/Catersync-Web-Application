// src/pages/Customers.jsx
//
// The customer directory. Every figure on this page is READ from the database
// views added on 17 Sep 2026 (v_customer_totals, v_customer_summary,
// v_customer_balance, v_booking_money, v_customer_activity) and only filtered
// and formatted here. Do not sum, count or divide anything in this file: the
// app already has several client-side definitions of "paid" that disagree, and
// this page is not to become another. A figure that is missing belongs in the
// view.
//
// ONE CAVEAT ON WHICH COLUMN TO READ. Every view here still exposes a
// combined unpaid figure (lifetime_outstanding, total_outstanding,
// with_balance, has_outstanding_balance, balance_due) that adds pending and
// approved work to money that can actually be collected. They are kept for
// compatibility and are deprecated for display: bind to receivable_due /
// pipeline_due and their totals instead, so this page agrees with
// Receivables and Reports.
import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Search, LayoutGrid, RefreshCw, UserPlus, X, ChevronLeft, ChevronRight,
  ArrowUp, ArrowDown, ArrowUpDown, Eye, Edit, Ban, ShieldCheck, Trash2,
  CalendarDays, ShoppingBag, Wallet, Undo2, Mail, Phone, MapPin, ExternalLink,
  StickyNote, Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import Select from '../components/Select';
import DateRangeFilter from './Reports/DateRangeFilter';
import { FilterBar, FilterField, PeriodTitle, EmptyResult } from '../components/FilterBar';
import { getRangeBounds, formatDate } from './Reports/helpers';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePasswordConfirm } from '../contexts/PasswordConfirmContext';
import { fetchAllRows } from '../utils/fetchAllRows';
import { getCurrentManagerId } from '../utils/currentManager';
import { createWalkInCustomer } from '../utils/createWalkInCustomer';

const PAGE_SIZE = 10;
const ALL_TIME = 'All Time';

// Same presentation as the Payments table: whole pesos stay whole, centavos
// are kept rather than rounded away.
const peso = (value) => `₱${Number(value || 0).toLocaleString()}`;
const dateOrDash = (value) => (value ? formatDate(value) : '—');
const dateTime = (value) => (value
  ? new Date(value).toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '—');

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const relativeTime = (value) => {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const steps = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.345, 'week'], [12, 'month']];
  let amount = seconds;
  for (const [size, unit] of steps) {
    if (Math.abs(amount) < size) return RELATIVE.format(Math.round(amount), unit);
    amount /= size;
  }
  return RELATIVE.format(Math.round(amount), 'year');
};

// The detail route depends on the booking's type. The Dashboard's upcoming
// list sends every booking to /app/bookings; do not copy that.
const bookingPath = (bookingId, bookingType) =>
  `/app/${bookingType === 'Short Order' ? 'orders' : 'bookings'}/${bookingId}`;

// A search term goes inside a PostgREST or() filter, where commas and
// parentheses are syntax and * is the wildcard. Strip those rather than let a
// typed character break or widen the filter.
const searchPattern = (term) => term.replace(/[\\"*%,()]/g, ' ').replace(/\s+/g, ' ').trim();

// Exactly the rules createWalkInCustomer enforces, so a form that passes here
// cannot fail there. (The Bookings modal validates less, which is how a
// manager passes that form and then fails the save.)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^09\d{9}$/;
function validateCustomerFields(values) {
  const errors = {};
  if (!values.first_name.trim()) errors.first_name = 'First name is required.';
  if (!values.last_name.trim()) errors.last_name = 'Last name is required.';
  if (!EMAIL_RE.test(values.email_address.trim())) errors.email_address = 'Enter a valid email address (e.g., user@domain.com).';
  if (!MOBILE_RE.test(values.contact_no.trim())) errors.contact_no = 'Use an 11-digit mobile number starting with 09 (e.g., 09123456789).';
  return errors;
}

const ACCOUNT_STATUSES = ['Active', 'Inactive', 'Blocked'];
const ACCOUNT_STATUS_PILL = {
  Active: 'bg-emerald-50 text-emerald-700',
  Inactive: 'bg-slate-100 text-slate-600',
  Blocked: 'bg-red-50 text-red-700',
};
const SOURCE_PILL = {
  Mobile: 'bg-blue-50 text-blue-700',
  'Walk-in': 'bg-amber-50 text-amber-700',
};
const BOOKING_STATUS_PILL = {
  Pending: 'bg-amber-50 text-amber-700',
  Approved: 'bg-[#EAF3F2] text-[#00703a]',
  Confirmed: 'bg-emerald-50 text-emerald-700',
  Completed: 'bg-blue-50 text-blue-700',
  Rejected: 'bg-red-50 text-red-700',
  Cancelled: 'bg-slate-100 text-slate-600',
};
const PAYMENT_STATUS_PILL = {
  'Pending Verification': 'bg-amber-50 text-amber-700',
  'Proof Rejected': 'bg-red-50 text-red-700',
};
const STATUS_CARD_BAR = { All: 'bg-slate-400', Active: 'bg-[#008A45]', Inactive: 'bg-slate-400', Blocked: 'bg-red-500' };
const STATUS_CARD_TEXT = { All: 'text-slate-900', Active: 'text-[#007038]', Inactive: 'text-slate-600', Blocked: 'text-red-700' };

const SORT_DEFAULT_DIRECTION = {
  full_name: 'asc',
  total_bookings: 'desc',
  contracted_gross: 'desc',
  receivable_due: 'desc',
  pipeline_due: 'desc',
  next_event_at: 'asc',
};

// receivable_due / pipeline_due, never lifetime_outstanding: the lifetime
// figure adds pending and approved work to money that can actually be
// collected, which made one customer read as owing half a million. The split
// columns come from v_customer_summary and agree row for row with
// v_customer_balance, which is what the drawer reads.
const LIST_COLUMNS = [
  'customer_id', 'first_name', 'last_name', 'full_name', 'email_address', 'contact_no', 'cus_address',
  'account_status', 'status_reason', 'source', 'has_login', 'total_bookings', 'package_bookings',
  'short_orders', 'contracted_gross', 'receivable_due', 'pipeline_due', 'next_event_at', 'is_deletable',
].join(', ');

const inputClass = (hasError) => `w-full border rounded-[10px] px-3 py-2.5 text-sm text-slate-800 outline-none transition-colors ${
  hasError ? 'border-red-400 bg-red-50/40 focus:ring-[3px] focus:ring-red-200' : 'border-slate-200 bg-white focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45]'
}`;
const filterControlClass = (active) => `border rounded-[10px] px-3 py-2.5 text-sm text-slate-800 outline-none transition-colors ${
  active ? 'border-[#008A45] bg-[#EAF3F2] ring-1 ring-[#008A45]/20' : 'border-slate-200 bg-white focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45]'
}`;

function Pill({ className, children, title }) {
  return (
    <span title={title} className={`inline-block px-2.5 py-[3px] rounded-full text-[12px] font-semibold whitespace-nowrap ${className}`}>
      {children}
    </span>
  );
}

function SkeletonRows({ columns }) {
  return Array.from({ length: PAGE_SIZE }, (_, i) => (
    <tr key={i} className="animate-pulse">
      {Array.from({ length: columns }, (_, c) => (
        <td key={c} className="px-4 py-[15px]">
          <div className={`h-3.5 rounded bg-slate-100 ${c === 0 ? 'w-40' : 'w-16'}`} />
          {c === 0 && <div className="h-3 w-28 rounded bg-slate-100 mt-2" />}
        </td>
      ))}
    </tr>
  ));
}

function ModalShell({ title, onClose, children, footer, maxWidth = 'max-w-lg' }) {
  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
      <div className={`bg-white rounded-xl shadow-2xl ${maxWidth} w-full max-h-[90vh] flex flex-col overflow-hidden`}>
        <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">{footer}</div>
      </div>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Add / edit customer
// ---------------------------------------------------------------------------
const EMPTY_CUSTOMER = { first_name: '', last_name: '', email_address: '', contact_no: '', cus_address: '' };

function CustomerFormModal({ mode, customer, onClose, onSaved }) {
  const [values, setValues] = useState(() => (customer
    ? {
      first_name: customer.first_name || '',
      last_name: customer.last_name || '',
      email_address: customer.email_address || '',
      contact_no: customer.contact_no || '',
      cus_address: customer.cus_address === 'N/A' ? '' : (customer.cus_address || ''),
    }
    : EMPTY_CUSTOMER));
  const [errors, setErrors] = useState({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const setField = (field) => (e) => {
    setValues((prev) => ({ ...prev, [field]: e.target.value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSave = async () => {
    const found = validateCustomerFields(values);
    setErrors(found);
    setSaveError('');
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      if (mode === 'add') {
        // The one creation path. It writes source 'Walk-in', creates the
        // login, and reuses an existing profile on a duplicate email.
        await createWalkInCustomer({ ...values });
        onSaved();
        return;
      }

      // Edit writes the five contact fields only — never username, user_id or
      // account_status (status has its own modal, with a reason).
      const { data, error } = await supabase
        .from('customer')
        .update({
          first_name: values.first_name.trim(),
          last_name: values.last_name.trim(),
          email_address: values.email_address.trim(),
          contact_no: values.contact_no.trim(),
          // NOT NULL in the table; the same placeholder createWalkInCustomer uses.
          cus_address: values.cus_address.trim() || 'N/A',
        })
        .eq('customer_id', customer.customer_id)
        .select('customer_id');
      if (error) {
        if (error.code === '23505') {
          setErrors({ email_address: 'That email already belongs to another customer.' });
          return;
        }
        throw error;
      }
      // RLS refuses an update without an error; it just changes nothing.
      if (!data?.length) throw new Error('Nothing was saved — this account may not be allowed to edit customers.');
      toast.success('Customer updated.');
      onSaved();
    } catch (err) {
      console.error('Customer save failed:', err);
      setSaveError(err.message || 'Could not save this customer. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const field = (name, label, props = {}) => (
    <div>
      <label htmlFor={`customer-${name}`} className="block text-[13px] font-semibold text-slate-600 mb-1">{label}</label>
      <input id={`customer-${name}`} value={values[name]} onChange={setField(name)} className={inputClass(!!errors[name])} {...props} />
      {errors[name] && <p className="text-[12.5px] text-red-600 mt-1">{errors[name]}</p>}
    </div>
  );

  return (
    <ModalShell
      title={mode === 'add' ? 'Add Customer' : 'Edit Customer'}
      onClose={onClose}
      footer={(
        <>
          <button onClick={onClose} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-5 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-sm px-5 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-60"
          >
            {saving ? 'Saving…' : mode === 'add' ? 'Add Customer' : 'Save Changes'}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('first_name', 'First name')}
          {field('last_name', 'Last name')}
        </div>
        {field('email_address', 'Email', { type: 'email', placeholder: 'user@domain.com' })}
        {mode === 'edit' && customer?.has_login && (
          <p className="text-[12.5px] text-slate-500 -mt-2">
            This changes the email on the customer record only. The address they sign in to the mobile app with stays the same.
          </p>
        )}
        {field('contact_no', 'Contact number', { inputMode: 'numeric', placeholder: '09123456789', maxLength: 11 })}
        {field('cus_address', 'Address (optional)')}
        {mode === 'add' && (
          <p className="text-[12.5px] text-slate-500">
            Creates a walk-in customer with a mobile app login and the default password, which they can reset by email.
          </p>
        )}
        {saveError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>}
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Change account status
// ---------------------------------------------------------------------------
function StatusModal({ customer, onClose, onSaved }) {
  const [nextStatus, setNextStatus] = useState(customer.account_status === 'Blocked' ? 'Active' : 'Blocked');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const reasonRequired = nextStatus === 'Inactive' || nextStatus === 'Blocked';

  const handleSave = async () => {
    setSaveError('');
    if (reasonRequired && !reason.trim()) {
      setReasonError(`A reason is required to mark this customer ${nextStatus}.`);
      return;
    }
    setSaving(true);
    try {
      const managerId = await getCurrentManagerId();
      // status_changed_at is set by the touch_customer_updated_at trigger.
      const { data, error } = await supabase
        .from('customer')
        .update({
          account_status: nextStatus,
          status_reason: reason.trim() || null,
          status_changed_by: managerId,
        })
        .eq('customer_id', customer.customer_id)
        .select('customer_id');
      if (error) throw error;
      if (!data?.length) throw new Error('Nothing was saved — this account may not be allowed to change customer status.');
      toast.success(`${customer.full_name} is now ${nextStatus}.`);
      onSaved();
    } catch (err) {
      console.error('Status change failed:', err);
      setSaveError(err.message || 'Could not change the account status. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Change Account Status"
      onClose={onClose}
      maxWidth="max-w-md"
      footer={(
        <>
          <button onClick={onClose} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-5 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving || nextStatus === customer.account_status}
            className={`text-white font-semibold text-sm px-5 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-60 ${nextStatus === 'Blocked' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#008A45] hover:bg-[#007038]'}`}
          >
            {saving ? 'Saving…' : `Mark ${nextStatus}`}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          <span className="font-semibold text-slate-900">{customer.full_name}</span> is currently{' '}
          <Pill className={ACCOUNT_STATUS_PILL[customer.account_status] || ACCOUNT_STATUS_PILL.Inactive}>{customer.account_status}</Pill>
        </p>
        <div>
          <label className="block text-[13px] font-semibold text-slate-600 mb-1">New status</label>
          <Select
            value={nextStatus}
            onChange={(e) => { setNextStatus(e.target.value); setReasonError(''); }}
            className={filterControlClass(false)}
          >
            {ACCOUNT_STATUSES.map((s) => (
              <option key={s} value={s} disabled={s === customer.account_status}>{s}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="status-reason" className="block text-[13px] font-semibold text-slate-600 mb-1">
            Reason{reasonRequired ? '' : ' (optional)'}
          </label>
          <textarea
            id="status-reason"
            rows={3}
            value={reason}
            onChange={(e) => { setReason(e.target.value); setReasonError(''); }}
            className={inputClass(!!reasonError)}
            placeholder={reasonRequired ? 'Why is this account being restricted?' : ''}
          />
          {reasonError && <p className="text-[12.5px] text-red-600 mt-1">{reasonError}</p>}
        </div>
        <p className="text-[12.5px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          Blocking keeps the customer and all their history. Use it instead of deleting.
        </p>
        {saveError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>}
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------
const DRAWER_TABS = ['Overview', 'Bookings', 'Activity', 'Notes'];
const EMPTY_DRAWER = { key: null, customer: null, balance: null, bookings: [], activity: [], notes: [], error: null };
const ACTIVITY_ICON = {
  booking: { icon: CalendarDays, tone: 'bg-blue-50 text-blue-600' },
  payment: { icon: Wallet, tone: 'bg-emerald-50 text-emerald-700' },
  refund: { icon: Undo2, tone: 'bg-red-50 text-red-600' },
};

function CustomerDrawer({ drawer, loading, tab, onTabChange, onClose, onOpenBooking, onNoteAdded, actions }) {
  const [noteBody, setNoteBody] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const customer = drawer.customer;
  const balance = drawer.balance;
  const typeByBooking = Object.fromEntries(drawer.bookings.map((b) => [b.booking_id, b.booking_type]));

  const addNote = async () => {
    if (!noteBody.trim() || !customer) return;
    setNoteSaving(true);
    try {
      const managerId = await getCurrentManagerId();
      const { data, error } = await supabase
        .from('customer_note')
        .insert({ customer_id: customer.customer_id, manager_id: managerId, body: noteBody.trim() })
        .select('note_id, body, created_at, manager_id, manager:manager_id(first_name, last_name)')
        .single();
      if (error) throw error;
      setNoteBody('');
      onNoteAdded(data);
      toast.success('Note saved.');
    } catch (err) {
      console.error('Note save failed:', err);
      toast.error(err.message || 'Could not save the note.');
    } finally {
      setNoteSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[9000] flex justify-end" role="dialog" aria-modal="true" aria-label="Customer details">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[680px] bg-[#f7f9fa] shadow-2xl flex flex-col">
        <div className="bg-white border-b border-slate-200 px-6 pt-5 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-bold tracking-[-0.01em] text-slate-900 truncate">{customer?.full_name || 'Loading…'}</h2>
              {customer && (
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <Pill className={ACCOUNT_STATUS_PILL[customer.account_status] || ACCOUNT_STATUS_PILL.Inactive}>{customer.account_status}</Pill>
                  {customer.source !== 'Unknown' && <Pill className={SOURCE_PILL[customer.source]}>{customer.source}</Pill>}
                  <span className="text-[13px] text-slate-500 truncate">{customer.email_address}</span>
                </div>
              )}
            </div>
            <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors shrink-0">
              <X size={18} />
            </button>
          </div>
          {customer && <div className="mt-3">{actions(customer)}</div>}
          <nav className="flex gap-0.5 mt-3 -mb-px overflow-x-auto" aria-label="Customer detail tabs">
            {DRAWER_TABS.map((t) => (
              <button
                key={t}
                onClick={() => onTabChange(t)}
                className={`px-4 py-[11px] text-[14px] border-b-2 transition-colors whitespace-nowrap ${
                  tab === t ? 'border-[#008A45] text-[#007038] font-bold' : 'border-transparent font-semibold text-slate-500 hover:text-slate-700'
                }`}
              >
                {t}
                {t === 'Bookings' && customer ? ` (${customer.total_bookings})` : ''}
              </button>
            ))}
          </nav>
        </div>

        <div className={`flex-1 overflow-y-auto px-6 py-5 transition-opacity ${loading && customer ? 'opacity-60' : ''}`}>
          {drawer.error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
              Could not load this customer: {drawer.error.message}
            </p>
          )}
          {!customer ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-24 rounded-xl bg-slate-100" />
              <div className="h-24 rounded-xl bg-slate-100" />
            </div>
          ) : tab === 'Overview' ? (
            <div className="space-y-4">
              {/* Money, from v_customer_balance. Rejected and Cancelled
                  bookings are excluded there.

                  THE SPLIT MATTERS. balance_due lumps every unpaid booking
                  together, so a customer with one ₱11,000 receivable and half
                  a million in pending enquiries read as owing half a million —
                  a figure no one could collect on. receivable_due is the money
                  actually collectible (Confirmed + Completed, the same
                  population Total Receivables uses on the Receivables page);
                  pipeline_due is work that has not been contracted yet
                  (Pending + Approved). Shown together so the pipeline is not
                  hidden, but never added up into one "balance". */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <div className="rounded-xl border border-slate-200/70 bg-white p-3.5">
                  <p className="text-[12.5px] font-semibold text-slate-600 mb-1">Total Billed</p>
                  <p className="text-[19px] font-semibold tabular-nums text-slate-900">{peso(balance?.total_billed)}</p>
                </div>
                <div className="rounded-xl border border-slate-200/70 bg-white p-3.5">
                  <p className="text-[12.5px] font-semibold text-slate-600 mb-1">Total Collected</p>
                  <p className="text-[19px] font-semibold tabular-nums text-slate-900">{peso(balance?.total_paid)}</p>
                </div>
                <div className={`relative overflow-hidden rounded-xl border p-3.5 ${Number(balance?.receivable_due) > 0 ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200/70 bg-white'}`}>
                  <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${Number(balance?.receivable_due) > 0 ? 'bg-amber-500' : 'bg-[#008A45]'}`} />
                  <p className="text-[12.5px] font-bold text-slate-700 mb-1">Collectible</p>
                  <p className={`text-[21px] font-bold tabular-nums ${Number(balance?.receivable_due) > 0 ? 'text-amber-700' : 'text-slate-900'}`}>{peso(balance?.receivable_due)}</p>
                  <p className="text-[11.5px] text-slate-500 mt-1 leading-snug">Still collectible</p>
                </div>
                {/* Secondary on purpose: real money, but not yet collectible —
                    the customer has not committed to it. */}
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3.5">
                  <p className="text-[12.5px] font-semibold text-slate-500 mb-1">Pipeline</p>
                  <p className="text-[19px] font-medium tabular-nums text-slate-500">{peso(balance?.pipeline_due)}</p>
                  <p className="text-[11.5px] text-slate-500 mt-1 leading-snug">Not yet collectible</p>
                </div>
                {/* Claimed, not received. Kept apart from Total Collected on
                    purpose — it must never read as money in hand. */}
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3.5">
                  <p className="text-[12.5px] font-semibold text-slate-500 mb-1">Awaiting Verification</p>
                  <p className="text-[19px] font-medium tabular-nums text-slate-500">{peso(balance?.awaiting_verification)}</p>
                  <p className="text-[11.5px] text-slate-500 mt-1 leading-snug">Not yet verified</p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200/70 bg-white p-4 space-y-2.5 text-sm text-slate-700">
                <p className="flex items-center gap-2"><Mail size={14} className="text-slate-400 shrink-0" /> {customer.email_address}</p>
                <p className="flex items-center gap-2"><Phone size={14} className="text-slate-400 shrink-0" /> {customer.contact_no || '—'}</p>
                <p className="flex items-center gap-2"><MapPin size={14} className="text-slate-400 shrink-0" /> {customer.cus_address || '—'}</p>
              </div>

              <dl className="rounded-xl border border-slate-200/70 bg-white p-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-slate-500">Account status</dt>
                <dd className="text-slate-800">
                  {customer.account_status}
                  {customer.status_changed_at && <span className="text-slate-500"> · since {dateOrDash(customer.status_changed_at)}</span>}
                </dd>
                {customer.status_reason && (
                  <>
                    <dt className="text-slate-500">Reason</dt>
                    <dd className="text-slate-800 whitespace-pre-wrap">{customer.status_reason}</dd>
                  </>
                )}
                <dt className="text-slate-500">Customer type</dt>
                <dd className="text-slate-800">{customer.source}{customer.has_login ? ' · has a mobile app login' : ' · no login'}</dd>
                <dt className="text-slate-500">Joined</dt>
                <dd className="text-slate-800" title="Backfilled from each customer's first booking on 17 September 2026, so exact only for customers created after that date.">
                  {dateOrDash(customer.created_at)}
                </dd>
                <dt className="text-slate-500">Next event</dt>
                <dd className="text-slate-800">{dateOrDash(customer.next_event_at)}</dd>
                <dt className="text-slate-500">Last booking</dt>
                <dd className="text-slate-800">{dateOrDash(customer.last_booking_at)}</dd>
              </dl>
            </div>
          ) : tab === 'Bookings' ? (
            drawer.bookings.length === 0 ? (
              <p className="text-sm text-slate-500 italic text-center py-10">This customer has no bookings.</p>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200/70 overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="bg-[#fbfcfd] border-b border-slate-100 text-[11.5px] font-bold uppercase tracking-[0.05em] text-slate-600">
                      <th className="px-3 py-2.5 whitespace-nowrap">Reference</th>
                      <th className="px-3 py-2.5 whitespace-nowrap">Event</th>
                      <th className="px-3 py-2.5 whitespace-nowrap text-right">Contract Amount</th>
                      <th className="px-3 py-2.5 whitespace-nowrap text-right">Collected</th>
                      {/* "Receivables" would be wrong here: this table lists
                          pending and approved bookings too, and their balances
                          are not collectible. Outstanding is the booking-level
                          word, and the one v_booking_money uses. */}
                      <th className="px-3 py-2.5 whitespace-nowrap text-right">Outstanding</th>
                      <th className="px-3 py-2.5 whitespace-nowrap">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {drawer.bookings.map((b) => (
                      <tr
                        key={b.booking_id}
                        onClick={() => onOpenBooking(b.booking_id, b.booking_type)}
                        className="hover:bg-[#fbfcfd] cursor-pointer"
                        title={`Open ${b.booking_type === 'Short Order' ? 'short order' : 'booking'} ${b.booking_number}`}
                      >
                        <td className="px-3 py-3 align-top">
                          <span className="text-[#007038] font-semibold inline-flex items-center gap-1 whitespace-nowrap">
                            {b.booking_number} <ExternalLink size={11} />
                          </span>
                          <span className="flex items-center gap-1 text-[12px] text-slate-500 mt-0.5 whitespace-nowrap">
                            {b.booking_type === 'Short Order' ? <ShoppingBag size={11} /> : <CalendarDays size={11} />} {b.booking_type}
                          </span>
                        </td>
                        <td className="px-3 py-3 align-top">
                          <span className="block whitespace-nowrap">{dateOrDash(b.event_datetime)}</span>
                          <span className="block text-[12px] text-slate-500 max-w-[160px] truncate" title={b.venue || ''}>{b.venue || '—'}</span>
                        </td>
                        <td className="px-3 py-3 align-top text-right tabular-nums whitespace-nowrap">{peso(b.total_amount)}</td>
                        <td className="px-3 py-3 align-top text-right tabular-nums whitespace-nowrap">
                          {peso(b.net_paid)}
                          {Number(b.awaiting_verification) > 0 && (
                            <span className="block text-[11px] text-slate-500">+{peso(b.awaiting_verification)} unverified</span>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top text-right tabular-nums whitespace-nowrap">
                          {/* A rejected or cancelled booking is not collectible,
                              and the figures above leave it out; say so rather
                              than print an amount nobody will collect. */}
                          {b.is_closed ? (
                            <span className="text-slate-400" title="Rejected or cancelled — nothing to collect, and not counted above">—</span>
                          ) : Number(b.outstanding) > 0 ? (
                            <span className="font-semibold text-amber-700">{peso(b.outstanding)}</span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <Pill className={BOOKING_STATUS_PILL[b.booking_status] || 'bg-slate-100 text-slate-600'}>{b.booking_status}</Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : tab === 'Activity' ? (
            drawer.activity.length === 0 ? (
              <p className="text-sm text-slate-500 italic text-center py-10">No activity yet.</p>
            ) : (
              <ol className="relative space-y-3">
                {drawer.activity.map((a, i) => {
                  const { icon: Icon, tone } = ACTIVITY_ICON[a.kind] || ACTIVITY_ICON.booking;
                  const type = typeByBooking[a.booking_id];
                  return (
                    <li key={`${a.kind}-${a.booking_id}-${a.occurred_at}-${i}`} className="flex gap-3 rounded-xl border border-slate-200/70 bg-white p-3.5">
                      <span className={`flex items-center justify-center w-8 h-8 rounded-full shrink-0 ${tone}`}><Icon size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <p className="text-sm font-semibold text-slate-900">{a.description}</p>
                          <p className={`text-sm font-semibold tabular-nums ${a.kind === 'refund' ? 'text-red-600' : 'text-slate-900'}`}>
                            {a.kind === 'refund' ? `-${peso(Math.abs(a.amount))}` : peso(a.amount)}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1 text-[12.5px] text-slate-500">
                          {type ? (
                            <button onClick={() => onOpenBooking(a.booking_id, type)} className="text-[#007038] font-semibold hover:underline">{a.reference}</button>
                          ) : (
                            <span>{a.reference}</span>
                          )}
                          <span>·</span>
                          <span title={dateTime(a.occurred_at)}>{dateTime(a.occurred_at)}</span>
                          {a.status && (
                            <Pill className={(a.kind === 'booking' ? BOOKING_STATUS_PILL[a.status] : PAYMENT_STATUS_PILL[a.status]) || 'bg-slate-100 text-slate-600'}>
                              {a.status}
                            </Pill>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )
          ) : (
            <div className="space-y-4">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-600">
                <StickyNote size={14} /> Internal only — customers never see these.
              </p>
              <div className="rounded-xl border border-slate-200/70 bg-white p-3.5">
                <label htmlFor="customer-note" className="sr-only">New note</label>
                <textarea
                  id="customer-note"
                  rows={3}
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Add a note about this customer"
                  className={inputClass(false)}
                />
                <div className="flex justify-end mt-2">
                  <button
                    onClick={addNote}
                    disabled={noteSaving || !noteBody.trim()}
                    className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-sm px-4 py-2 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {noteSaving ? 'Saving…' : 'Add Note'}
                  </button>
                </div>
              </div>
              {drawer.notes.length === 0 ? (
                <p className="text-sm text-slate-500 italic text-center py-6">No notes yet.</p>
              ) : (
                <ul className="space-y-3">
                  {drawer.notes.map((n) => (
                    <li key={n.note_id} className="rounded-xl border border-slate-200/70 bg-white p-3.5">
                      <p className="text-sm text-slate-800 whitespace-pre-wrap">{n.body}</p>
                      <p className="flex items-center gap-1.5 text-[12.5px] text-slate-500 mt-2">
                        {/* manager rows are readable only by their owner, so
                            another manager's name can come back empty. */}
                        <span className="font-semibold text-slate-600">
                          {n.manager ? `${n.manager.first_name} ${n.manager.last_name}` : 'A manager'}
                        </span>
                        <span>·</span>
                        <Clock size={12} />
                        <span title={dateTime(n.created_at)}>{relativeTime(n.created_at)}</span>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Customers() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();
  const tableRef = useRef(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [balanceFilter, setBalanceFilter] = useState('All');
  const [repeatOnly, setRepeatOnly] = useState(false);
  const [datePreset, setDatePreset] = useState(ALL_TIME);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  // A subsidiary ledger opens on who owes the most, not on the alphabet.
  const [sort, setSort] = useState({ field: 'receivable_due', direction: 'desc' });
  const [page, setPage] = useState(1);
  // Bumped by Refresh, realtime and every write; every read is keyed on it.
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = () => setRefreshTick((t) => t + 1);

  const [selectedId, setSelectedId] = useState(null);
  const [drawerTab, setDrawerTab] = useState('Overview');
  const [formModal, setFormModal] = useState(null); // { mode: 'add' | 'edit', customer? }
  const [statusTarget, setStatusTarget] = useState(null);

  // customer_note too, so a note another manager adds appears in an open
  // drawer. All four tables are in the supabase_realtime publication.
  useRealtimeRefresh('customers-page', ['customer', 'booking', 'payment', 'customer_note'], refresh);

  const { start: joinedStart, end: joinedEnd } = getRangeBounds(datePreset, customStart, customEnd);
  const trimmedSearch = searchPattern(search);
  const filters = {
    search: trimmedSearch,
    status: statusFilter,
    source: sourceFilter,
    balance: balanceFilter,
    repeatOnly,
    joinedStart: joinedStart ? joinedStart.toISOString() : null,
    joinedEnd: joinedEnd ? joinedEnd.toISOString() : null,
  };
  const filterKey = JSON.stringify(filters);
  const hasFilters = !!search.trim() || statusFilter !== 'All' || sourceFilter !== 'All'
    || balanceFilter !== 'All' || repeatOnly || datePreset !== ALL_TIME;

  // A filter change goes back to page 1. Reset during render, not in an effect.
  const [pageFilterKey, setPageFilterKey] = useState(filterKey);
  if (pageFilterKey !== filterKey) {
    setPageFilterKey(filterKey);
    setPage(1);
  }

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('All');
    setSourceFilter('All');
    setBalanceFilter('All');
    setRepeatOnly(false);
    setDatePreset(ALL_TIME);
    setCustomStart('');
    setCustomEnd('');
  };
  const scrollToTable = () => tableRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // --- Totals: one row from v_customer_totals -------------------------------
  const [totals, setTotals] = useState({ key: null, row: null });
  const totalsKey = String(refreshTick);
  useEffect(() => {
    let ignore = false;
    (async () => {
      const { data, error } = await supabase.from('v_customer_totals').select('*').single();
      if (ignore) return;
      if (error) {
        console.error('Customer totals failed:', error);
        toast.error('Could not load the customer totals.');
      }
      setTotals({ key: totalsKey, row: data || null });
    })();
    return () => { ignore = true; };
  }, [totalsKey]);
  const t = totals.row;

  // --- The table: one page of v_customer_summary ----------------------------
  const listKey = JSON.stringify({ filters, sort, page, refreshTick });
  const [list, setList] = useState({ key: null, rows: [], count: 0 });
  useEffect(() => {
    const { filters: f, sort: s, page: p } = JSON.parse(listKey);
    let ignore = false;
    (async () => {
      let query = supabase.from('v_customer_summary').select(LIST_COLUMNS, { count: 'exact' });
      if (f.search) {
        const like = `"*${f.search}*"`;
        query = query.or(`full_name.ilike.${like},email_address.ilike.${like},contact_no.ilike.${like}`);
      }
      if (f.status !== 'All') query = query.eq('account_status', f.status);
      if (f.source !== 'All') query = query.eq('source', f.source);
      // has_receivable_due, not has_outstanding_balance: the filter must select
      // the same population the column shows, or the card that sets it lands on
      // a list whose figures do not add up to the card.
      if (f.balance === 'Overdue') {
        const { data: overdueRows } = await supabase
          .from('v_booking_money')
          .select('customer_id')
          .eq('is_overdue', true);
        const ids = [...new Set((overdueRows || []).map(r => r.customer_id).filter(Boolean))];
        // [] would mean "no filter" to .in(); a nil uuid means "nobody".
        query = query.in('customer_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      }
      if (f.balance === 'Has receivables') query = query.eq('has_receivable_due', true);
      if (f.balance === 'Settled') query = query.eq('has_receivable_due', false);
      if (f.repeatOnly) query = query.eq('is_repeat', true);
      if (f.joinedStart) query = query.gte('created_at', f.joinedStart);
      if (f.joinedEnd) query = query.lte('created_at', f.joinedEnd);

      const from = (p - 1) * PAGE_SIZE;
      const { data, count, error } = await query
        .order(s.field, { ascending: s.direction === 'asc', nullsFirst: false })
        .order('customer_id', { ascending: true }) // total order for .range()
        .range(from, from + PAGE_SIZE - 1);
      if (ignore) return;
      if (error) {
        console.error('Customer list failed:', error);
        toast.error('Could not load customers.');
      }
      setList({ key: listKey, rows: data || [], count: count || 0 });
    })();
    return () => { ignore = true; };
  }, [listKey]);
  // The account-status counts under the current filters, status aside.
  const statusCountKey = JSON.stringify({ ...filters, status: 'All', refreshTick });
  const [statusCountState, setStatusCountState] = useState({ key: null, counts: null });
  useEffect(() => {
    const f = JSON.parse(statusCountKey);
    let ignore = false;
    (async () => {
      let query = supabase.from('v_customer_summary').select('customer_id, account_status');
      if (f.search) {
        const like = `"*${f.search}*"`;
        query = query.or(`full_name.ilike.${like},email_address.ilike.${like},contact_no.ilike.${like}`);
      }
      if (f.source !== 'All') query = query.eq('source', f.source);
      if (f.balance === 'Overdue') {
        const { data: overdueRows } = await supabase
          .from('v_booking_money')
          .select('customer_id')
          .eq('is_overdue', true);
        const ids = [...new Set((overdueRows || []).map(r => r.customer_id).filter(Boolean))];
        // [] would mean "no filter" to .in(); a nil uuid means "nobody".
        query = query.in('customer_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
      }
      if (f.balance === 'Has receivables') query = query.eq('has_receivable_due', true);
      if (f.balance === 'Settled') query = query.eq('has_receivable_due', false);
      if (f.repeatOnly) query = query.eq('is_repeat', true);
      if (f.joinedStart) query = query.gte('created_at', f.joinedStart);
      if (f.joinedEnd) query = query.lte('created_at', f.joinedEnd);
      const { data, error } = await query.order('customer_id', { ascending: true });
      if (ignore) return;
      if (error) { console.error('Status counts failed:', error); return; }
      const counts = { All: 0, Active: 0, Inactive: 0, Blocked: 0 };
      (data || []).forEach(r => { counts.All += 1; if (counts[r.account_status] !== undefined) counts[r.account_status] += 1; });
      setStatusCountState({ key: statusCountKey, counts });
    })();
    return () => { ignore = true; };
  }, [statusCountKey]);
  const statusCounts = statusCountState.counts;

  const listLoading = list.key !== listKey;
  const hasListLoaded = list.key !== null;
  const totalPages = Math.max(1, Math.ceil(list.count / PAGE_SIZE));

  // After a delete or a realtime change the current page can fall past the
  // end; step back to the last page that exists.
  if (!listLoading && list.count > 0 && page > totalPages) {
    setPage(totalPages);
  }

  // --- Drawer data ----------------------------------------------------------
  const drawerKey = JSON.stringify([selectedId, refreshTick]);
  const [drawer, setDrawer] = useState(EMPTY_DRAWER);
  useEffect(() => {
    const [id] = JSON.parse(drawerKey);
    if (!id) return undefined;
    let ignore = false;
    (async () => {
      try {
        const [summaryRes, balanceRes, bookings, activity, notes] = await Promise.all([
          supabase.from('v_customer_summary').select('*').eq('customer_id', id).maybeSingle(),
          supabase.from('v_customer_balance').select('*').eq('customer_id', id).maybeSingle(),
          fetchAllRows(() => supabase
            .from('v_booking_money')
            .select('booking_id, booking_number, booking_type, booking_status, event_datetime, venue, total_amount, net_paid, awaiting_verification, outstanding, is_closed')
            .eq('customer_id', id)
            .order('event_datetime', { ascending: false, nullsFirst: false })
            .order('booking_id', { ascending: true }), 'customer bookings'),
          // v_customer_activity has no unique column, so this ordering is as
          // close to total as the view allows. A customer would need over a
          // thousand bookings and payments before paging could matter.
          fetchAllRows(() => supabase
            .from('v_customer_activity')
            .select('*')
            .eq('customer_id', id)
            .order('occurred_at', { ascending: false })
            .order('booking_id', { ascending: true })
            .order('kind', { ascending: true })
            .order('amount', { ascending: true }), 'customer activity'),
          fetchAllRows(() => supabase
            .from('customer_note')
            .select('note_id, body, created_at, manager_id, manager:manager_id(first_name, last_name)')
            .eq('customer_id', id)
            .order('created_at', { ascending: false })
            .order('note_id', { ascending: true }), 'customer notes'),
        ]);
        if (summaryRes.error) throw summaryRes.error;
        if (balanceRes.error) throw balanceRes.error;
        if (ignore) return;
        setDrawer({ key: drawerKey, customer: summaryRes.data, balance: balanceRes.data, bookings, activity, notes, error: null });
      } catch (err) {
        console.error('Customer detail failed:', err);
        if (!ignore) setDrawer((prev) => ({ ...prev, key: drawerKey, error: err }));
      }
    })();
    return () => { ignore = true; };
  }, [drawerKey]);
  const drawerLoading = drawer.key !== drawerKey;
  // A drawer showing a different customer's data would be worse than a blank
  // one, so only keep what was loaded for the customer now selected.
  const drawerForSelected = drawer.key && JSON.parse(drawer.key)[0] === selectedId ? drawer : EMPTY_DRAWER;

  const openDrawer = (id, tab = 'Overview') => {
    setSelectedId(id);
    setDrawerTab(tab);
  };
  const closeDrawer = () => setSelectedId(null);

  useEffect(() => {
    if (!selectedId) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setSelectedId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  // --- Actions --------------------------------------------------------------
  const handleDelete = async (customer) => {
    if (!customer.is_deletable) return;
    const loginLine = customer.has_login
      ? '\n\nTheir mobile app login is not removed by this, and will no longer have a customer record behind it. Block the account instead if they may come back.'
      : '';
    const confirmed = await showConfirm({
      title: `Delete ${customer.full_name}?`,
      message: `Deleting removes the customer record permanently. Block the account instead if you only want to stop them booking.${loginLine}`,
      confirmLabel: 'Delete Customer',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: `Deleting ${customer.full_name} is permanent. Re-enter your password to continue.`,
    });
    if (!passwordOk) return;

    try {
      const { error, count } = await supabase
        .from('customer')
        .delete({ count: 'exact' })
        .eq('customer_id', customer.customer_id);
      if (error) {
        // A booking created since this page loaded: the trigger (Pending or
        // Approved) or the RESTRICT foreign key (any other status) refuses.
        if (error.code === '23503' || /active bookings/i.test(error.message || '')) {
          throw new Error(`${customer.full_name} has a booking now, so they can't be deleted. Block the account instead.`);
        }
        throw error;
      }
      // RLS refuses a delete without an error; it just removes nothing.
      if (count !== 1) throw new Error('Nothing was deleted — this account may not be allowed to delete customers.');
      toast.success(`Deleted ${customer.full_name}.`);
      if (selectedId === customer.customer_id) closeDrawer();
    } catch (err) {
      console.error('Customer delete failed:', err);
      toast.error(err.message || 'Could not delete this customer.');
    } finally {
      refresh();
    }
  };

  const toggleSort = (field) => {
    setSort((prev) => (prev.field === field
      ? { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { field, direction: SORT_DEFAULT_DIRECTION[field] }));
    setPage(1);
  };

  const renderSortHeader = (field, label, align = 'left') => (
    <button
      onClick={() => toggleSort(field)}
      className={`flex items-center gap-1.5 text-[12.5px] font-bold uppercase tracking-[0.05em] transition-colors cursor-pointer whitespace-nowrap ${align === 'right' ? 'ml-auto' : ''} ${
        sort.field === field ? 'text-[#007038]' : 'text-slate-700 hover:text-[#007038]'
      }`}
    >
      {label}
      {sort.field === field ? (
        sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
      ) : (
        <ArrowUpDown size={12} className="text-slate-400" />
      )}
    </button>
  );

  const renderActions = (customer, { compact = false } = {}) => {
    const isBlocked = customer.account_status === 'Blocked';
    const bookingsLabel = `${customer.total_bookings} booking${Number(customer.total_bookings) === 1 ? '' : 's'}`;
    const base = 'flex items-center justify-center gap-1.5 rounded-[9px] border text-[12.5px] font-semibold transition-colors whitespace-nowrap';
    const size = compact ? 'w-8 h-8' : 'px-3 py-[7px]';
    return (
      <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {compact && (
          <button onClick={() => openDrawer(customer.customer_id)} title="View" aria-label="View" className={`${base} ${size} border-slate-200 bg-white text-slate-600 hover:text-[#007038] hover:border-[#c9dfd4]`}>
            <Eye size={14} />
          </button>
        )}
        <button onClick={() => setFormModal({ mode: 'edit', customer })} title="Edit" aria-label="Edit" className={`${base} ${size} border-slate-200 bg-white text-slate-600 hover:text-[#007038] hover:border-[#c9dfd4]`}>
          <Edit size={14} />{!compact && 'Edit'}
        </button>
        <button
          onClick={() => setStatusTarget(customer)}
          title={isBlocked ? 'Unblock' : 'Block'}
          aria-label={isBlocked ? 'Unblock' : 'Block'}
          className={`${base} ${size} ${isBlocked ? 'border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50' : 'border-amber-200 bg-white text-amber-700 hover:bg-amber-50'}`}
        >
          {isBlocked ? <ShieldCheck size={14} /> : <Ban size={14} />}{!compact && (isBlocked ? 'Unblock' : 'Block')}
        </button>
        <button
          onClick={() => handleDelete(customer)}
          disabled={!customer.is_deletable}
          title={customer.is_deletable ? 'Delete' : `Can't delete — this customer has ${bookingsLabel}.`}
          aria-label="Delete"
          className={`${base} ${size} border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:border-slate-100 disabled:text-slate-300 disabled:hover:bg-white disabled:cursor-not-allowed`}
        >
          <Trash2 size={14} />{!compact && 'Delete'}
        </button>
      </div>
    );
  };

  // TWO CARDS. This page is the receivables subsidiary ledger: the sum of the
  // Receivables column is the Total Receivables figure carried on Receivables
  // and Reports, and the card above the table is that same control total. A
  // card that supports neither the tie nor the size of the customer base does
  // not belong here — Repeat Customers is a filter (it is one, below), and
  // New This Month measured seeded data more than it measured the business.
  const summaryCards = [
    {
      key: 'balance',
      label: 'Collectible',
      value: t ? peso(t.total_receivable) : null,
      sub: 'Not yet collected',
      accent: 'bg-amber-500',
      onClick: () => { clearFilters(); setBalanceFilter('Has receivables'); scrollToTable(); },
    },
    {
      key: 'total',
      label: 'Total Customers',
      value: t?.total_customers,
      sub: 'Accounts on record',
      accent: 'bg-[#008A45]',
      onClick: () => { clearFilters(); scrollToTable(); },
    },
  ];

  // Counts follow every OTHER active filter — search, type, repeat,
  // receivables, joined — so a card's number is what clicking it will show.
  // They used to be the unfiltered totals from v_customer_totals.
  const statusCards = [
    { key: 'All', label: 'All', count: statusCounts?.All },
    { key: 'Active', label: 'Active', count: statusCounts?.Active },
    { key: 'Inactive', label: 'Inactive', count: statusCounts?.Inactive },
    { key: 'Blocked', label: 'Blocked', count: statusCounts?.Blocked },
  ];

  return (
    <div className="space-y-[18px] relative">
      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-[25px] font-bold tracking-[-0.02em] text-slate-900">Customers</h1>
          <p className="text-[14.5px] text-slate-600 mt-1.5">Accounts, balances and history.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={refresh}
            className="bg-white border border-slate-200 text-slate-700 px-4 py-2.5 rounded-[10px] font-semibold transition-colors flex items-center gap-2 text-sm whitespace-nowrap hover:border-[#c9dfd4] hover:text-[#007038]"
          >
            <RefreshCw size={16} className={listLoading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={() => setFormModal({ mode: 'add' })}
            className="bg-[#008A45] hover:bg-[#007038] text-white px-[17px] py-2.5 rounded-[10px] font-semibold transition-colors flex items-center gap-2 text-sm whitespace-nowrap"
          >
            <UserPlus size={15} /> Add Customer
          </button>
        </div>
      </div>

      {/* FILTER BAR — the same component and order as every other page. No
          Account status select here: the status cards below are that filter,
          as they are on Bookings, and two controls for one filter could only
          disagree. */}
      <FilterBar canClear={hasFilters} onClear={clearFilters}>
        <FilterField label="Search" active={!!search.trim()} grow>
          <div className="relative">
            <input
              id="customer-search"
              type="text"
              placeholder="Name, email, or contact number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`w-full pl-4 pr-10 ${filterControlClass(!!search.trim())}`}
            />
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          </div>
        </FilterField>
        <FilterField label="Customer type" active={sourceFilter !== 'All'}>
          <Select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className={filterControlClass(sourceFilter !== 'All')}>
            <option value="All">All</option>
            <option value="Mobile">Mobile</option>
            <option value="Walk-in">Walk-in</option>
            <option value="Unknown">Unknown</option>
          </Select>
        </FilterField>
        <FilterField label="Repeat customer" active={repeatOnly}>
          <Select value={repeatOnly ? 'Repeat' : 'All'} onChange={(e) => { setRepeatOnly(e.target.value === 'Repeat'); setPage(1); }} className={filterControlClass(repeatOnly)}>
            <option value="All">All</option>
            <option value="Repeat">Booked more than once</option>
          </Select>
        </FilterField>
        <FilterField label="Collectible" active={balanceFilter !== 'All'}>
          <Select value={balanceFilter} onChange={(e) => setBalanceFilter(e.target.value)} className={filterControlClass(balanceFilter !== 'All')}>
            <option value="All">All</option>
            <option value="Has receivables">Not fully collected</option>
            {/* Served and not fully paid: the event date has passed with a
                balance still on it. Read from v_booking_money.is_overdue — not
                "lapsed", which in this app means a request never accepted. */}
            <option value="Overdue">Overdue</option>
            <option value="Settled">Fully collected</option>
          </Select>
        </FilterField>
        {/* A record filter, not a period: it chooses which customers are
            listed, not which figures sum — so it produces no period title. */}
        <FilterField label="Joined" active={datePreset !== ALL_TIME}>
          <DateRangeFilter
            preset={datePreset}
            customStart={customStart}
            customEnd={customEnd}
            rangeStart={joinedStart}
            rangeEnd={joinedEnd}
            onPresetChange={setDatePreset}
            onCustomStartChange={setCustomStart}
            onCustomEndChange={setCustomEnd}
            onClear={() => { setDatePreset(ALL_TIME); setCustomStart(''); setCustomEnd(''); }}
            showClear={false}
          />
        </FilterField>
      </FilterBar>
      {/* A fixed period. Total Receivables reads PHP 92,800 here and PHP 55,950
          on Receivables for September — same label, different scope. This
          title is what stops that reading as a contradiction. */}
      <PeriodTitle>All time</PeriodTitle>

      {/* SUMMARY CARDS — each opens a filtered view of the table below. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        {summaryCards.map((card) => (
          <button
            key={card.key}
            onClick={card.onClick}
            title={card.title}
            className="relative overflow-hidden flex flex-col justify-start rounded-2xl border border-slate-200/70 bg-white p-5 text-left transition-all cursor-pointer hover:shadow-[0_2px_8px_rgba(15,23,42,0.05)]"
          >
            <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${card.accent}`} />
            <p className="text-[13px] font-semibold text-slate-600 mb-2">{card.label}</p>
            {t ? (
              <h3 className="text-[27px] font-semibold tracking-[-0.03em] leading-[1.05] tabular-nums text-slate-900">{card.value}</h3>
            ) : (
              <div className="h-[28px] w-16 rounded bg-slate-100 animate-pulse" />
            )}
            <p className="text-[13px] text-slate-600 mt-2.5">{t ? card.sub : ' '}</p>
          </button>
        ))}
      </div>

      {/* STATUS CARDS */}
      <div className="bg-white rounded-2xl border border-slate-200/70 p-5">
        <div className="flex items-center gap-1.5 mb-3">
          <LayoutGrid size={13} className="text-slate-500" />
          <span className="text-[13px] font-bold text-slate-600 tracking-[0.04em] whitespace-nowrap">Account Status</span>
        </div>
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,132px),1fr))]">
          {statusCards.map((s) => (
            <button
              key={s.key}
              onClick={() => { setStatusFilter(statusFilter === s.key ? 'All' : s.key); scrollToTable(); }}
              className={`text-left rounded-xl border border-slate-100 bg-[#fbfcfd] p-3.5 relative overflow-hidden transition-all ${
                statusFilter === s.key ? 'ring-2 ring-[#008A45]/20 shadow-sm' : 'hover:shadow-[0_4px_14px_rgba(15,23,42,0.06)] hover:-translate-y-0.5 hover:border-[#008A45]/30'
              }`}
            >
              <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${STATUS_CARD_BAR[s.key]}`} />
              <p className="text-[13px] font-semibold text-slate-600 mb-1.5 whitespace-nowrap">{s.label}</p>
              <p className={`text-[23px] font-semibold tracking-[-0.02em] tabular-nums ${STATUS_CARD_TEXT[s.key]}`}>{statusCounts ? s.count : '—'}</p>
            </button>
          ))}
        </div>
      </div>

      {/* TABLE */}
      <div ref={tableRef} className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden scroll-mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#fbfcfd] border-b border-slate-100 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700">
                <th className="px-4 py-3">{renderSortHeader('full_name', 'Customer')}</th>
                <th className="px-4 py-3 whitespace-nowrap">Contact</th>
                <th className="px-4 py-3">{renderSortHeader('total_bookings', 'Bookings')}</th>
                {/* contracted_gross, never lifetime_gross: the lifetime figure
                    counted Pending requests, so one customer read as worth
                    PHP 603,400 against PHP 46,000 actually contracted — and
                    led the list on it. Contracted Value is what the business
                    committed to perform: Confirmed and Completed only. */}
                <th className="px-4 py-3 text-right">{renderSortHeader('contracted_gross', 'Contracted Value', 'right')}</th>
                {/* Collectible now. Same measure and same word as the card
                    above and as the Receivables page. */}
                <th className="px-4 py-3 text-right">{renderSortHeader('receivable_due', 'Collectible', 'right')}</th>
                {/* Secondary on purpose — real money, but nobody can collect it
                    until the customer confirms. Muted so the eye lands on the
                    column to its left. */}
                <th className="px-4 py-3 text-right font-semibold text-slate-500">{renderSortHeader('pipeline_due', 'Pipeline', 'right')}</th>
                <th className="px-4 py-3">{renderSortHeader('next_event_at', 'Next Event')}</th>
                <th className="px-4 py-3 whitespace-nowrap">Status</th>
                <th className="px-4 py-3 whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody className={`divide-y divide-slate-100 text-sm text-slate-700 transition-opacity ${listLoading && hasListLoaded ? 'opacity-60' : ''}`}>
              {!hasListLoaded ? (
                <SkeletonRows columns={9} />
              ) : list.rows.length === 0 ? (
                <tr><td colSpan="9"><EmptyResult canClear={hasFilters} onClear={clearFilters} /></td></tr>
              ) : (
                list.rows.map((c) => (
                  <tr key={c.customer_id} onClick={() => openDrawer(c.customer_id)} className="hover:bg-[#fbfcfd] transition-colors cursor-pointer">
                    <td className="px-4 py-[15px]">
                      <div className="flex items-center gap-2">
                        <p className="text-[15px] font-semibold text-slate-900">{c.full_name}</p>
                        {c.source !== 'Unknown' && <Pill className={SOURCE_PILL[c.source]}>{c.source}</Pill>}
                      </div>
                      <p className="text-[13px] text-slate-500 mt-0.5">{c.email_address}</p>
                    </td>
                    <td className="px-4 py-[15px] text-sm text-slate-700 tabular-nums whitespace-nowrap">{c.contact_no || '—'}</td>
                    <td className="px-4 py-[15px]">
                      <p className="text-[15px] font-semibold text-slate-900 tabular-nums">{c.total_bookings}</p>
                      <p className="text-[12.5px] text-slate-500 whitespace-nowrap">{c.package_bookings} package · {c.short_orders} short order</p>
                    </td>
                    <td className="px-4 py-[15px] text-right text-[15px] font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                      {Number(c.contracted_gross) > 0
                        ? peso(c.contracted_gross)
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-[15px] text-right tabular-nums whitespace-nowrap">
                      {Number(c.receivable_due) > 0
                        ? <span className="text-[15px] font-semibold text-amber-700">{peso(c.receivable_due)}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-[15px] text-right tabular-nums whitespace-nowrap">
                      {Number(c.pipeline_due) > 0
                        ? <span className="text-[13.5px] text-slate-500">{peso(c.pipeline_due)}</span>
                        : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="px-4 py-[15px] text-sm text-slate-700 tabular-nums whitespace-nowrap">{dateOrDash(c.next_event_at)}</td>
                    <td className="px-4 py-[15px]">
                      <Pill className={ACCOUNT_STATUS_PILL[c.account_status] || ACCOUNT_STATUS_PILL.Inactive} title={c.status_reason || undefined}>{c.account_status}</Pill>
                    </td>
                    <td className="px-4 py-[15px]">{renderActions(c, { compact: true })}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex justify-between items-center bg-white text-sm text-slate-600">
          <span className="tabular-nums">Showing {list.rows.length} of {list.count} customers</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              aria-label="Previous page"
              className={`flex items-center justify-center w-[30px] h-[30px] rounded-[9px] border border-slate-100 bg-white transition-colors ${page === 1 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
            >
              <ChevronLeft size={16} />
            </button>
            <span className="px-3 py-1 text-[13px] font-semibold tabular-nums text-slate-600">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="Next page"
              className={`flex items-center justify-center w-[30px] h-[30px] rounded-[9px] border border-slate-100 bg-white transition-colors ${page >= totalPages ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}`}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {selectedId && (
        <CustomerDrawer
          key={selectedId}
          drawer={drawerForSelected}
          loading={drawerLoading}
          tab={drawerTab}
          onTabChange={setDrawerTab}
          onClose={closeDrawer}
          onOpenBooking={(id, type) => navigate(bookingPath(id, type))}
          onNoteAdded={(note) => setDrawer((prev) => ({ ...prev, notes: [note, ...prev.notes] }))}
          actions={(customer) => <div className="flex">{renderActions(customer)}</div>}
        />
      )}

      {formModal && (
        <CustomerFormModal
          mode={formModal.mode}
          customer={formModal.customer}
          onClose={() => setFormModal(null)}
          onSaved={() => { setFormModal(null); refresh(); }}
        />
      )}

      {statusTarget && (
        <StatusModal
          customer={statusTarget}
          onClose={() => setStatusTarget(null)}
          onSaved={() => { setStatusTarget(null); refresh(); }}
        />
      )}
    </div>
  );
}
