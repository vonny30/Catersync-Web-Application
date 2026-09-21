// src/pages/Receivables.jsx
//
// Money collected, and money still to collect. Replaces the Payments page.
//
// The vocabulary is the point of this page (see utils/payments.js):
//   Cash Receipts      verified money in hand, by payment date
//   Total Receivables  what customers owe on agreed bookings, by service date
//   Receipt            one verified entry that moves the books
//   Claim              a payment the customer says they made, not yet verified
//   Refund             money going back to the customer
//   Reversal           a correction: the receipt was wrong, money never moved
//
// Every figure is read from the database's own definitions:
//   v_payment_ledger.counts_in_ledger — whether an entry moves the books
//   v_booking_money.counts_toward_revenue / outstanding — what is owed on
//     committed work (Confirmed and Completed). An Approved booking is
//     accepted but not committed: its balance is pipeline, not a collectible.
// This page filters and adds those up; it does not decide them.
//
// Receipts are never edited or deleted. A wrong one is reversed: a new
// negative row that points at it, with a reason, and both stay on record.
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Search, X, RefreshCw, Filter, RotateCcw, ExternalLink, Undo2, AlertCircle, Check, ChevronRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import Select from '../components/Select';
import ReceiptFields from '../components/ReceiptFields';
import DateRangeFilter from './Reports/DateRangeFilter';
import { getRangeBounds, isWithinRange, DEFAULT_DATE_PRESET, formatDate, periodLabel, forPeriod } from './Reports/helpers';
import { statusWriteErrorMessage } from '../utils/lapsed';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePasswordConfirm } from '../contexts/PasswordConfirmContext';
import { fetchAllRows } from '../utils/fetchAllRows';
import { getCurrentManagerId } from '../utils/currentManager';
import { getConfirmEligibility, buildConfirmDialog, applyConfirmation } from '../utils/confirmBooking';
import {
  RECEIPT_STAGE_ORDER, RECEIPT_METHODS, ENTRY_TYPES, PENDING_VERIFICATION, PROOF_REJECTED, REVERSED_STATUS,
  stageForReceipt, validateReceipt, methodNeedsReceiptNumber, payStatusPillClass,
  isReversalEntry, isRefundEntry, ledgerEntryBadge,
} from '../utils/payments';

const peso = (n) => `₱${Number(n || 0).toLocaleString()}`;
const MIN_REVERSAL_REASON = 10;

const customerName = (entry) => {
  const c = entry?.booking?.customer;
  return c ? `${c.first_name} ${c.last_name}` : 'Unknown customer';
};
const bookingRef = (b) => b?.booking_number
  || (b?.booking_id ? `${b.booking_type === 'Short Order' ? 'SO' : 'BKG'}-${b.booking_id.slice(0, 8)}` : '—');
const bookingPath = (bookingId, bookingType) =>
  `/app/${bookingType === 'Short Order' ? 'orders' : 'bookings'}/${bookingId}`;
// A receipt's short name, for "Reverses …". The number on the paper receipt
// when there is one (cash); otherwise a stable reference from its id.
const receiptLabel = (entry) => (entry?.receipt_reference
  ? `receipt no. ${entry.receipt_reference}`
  : `RCP-${String(entry?.payment_id || '').slice(0, 8).toUpperCase()}`);

const getProofUrl = (proof) => {
  if (!proof || proof === 'placeholder.png' || proof === 'refund_placeholder.png') return null;
  if (proof.startsWith('http://') || proof.startsWith('https://')) return proof;
  const key = proof.startsWith('payments/') ? proof : (!proof.includes('/') ? `payments/${proof}` : null);
  if (!key) return null;
  return supabase.storage.from('images').getPublicUrl(key).data.publicUrl;
};

// ---------------------------------------------------------------------------
// Modals (module scope, so their state and sums are not part of the page body)
// ---------------------------------------------------------------------------
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
        <div className="px-6 py-5 overflow-y-auto bg-[#fbfcfd]">{children}</div>
        <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">{footer}</div>
      </div>
    </div>,
    document.body
  );
}

const cancelButton = (onClick) => (
  <button type="button" onClick={onClick} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-5 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
);

function ReverseModal({ entry, onClose, onDone }) {
  const { requestPasswordConfirm } = usePasswordConfirm();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const amount = Number(entry.amount_paid) || 0;
  const ref = bookingRef(entry.booking);

  const submit = async () => {
    if (reason.trim().length < MIN_REVERSAL_REASON) {
      setError(`Give a reason of at least ${MIN_REVERSAL_REASON} characters. It stays on the record beside the reversal.`);
      return;
    }
    const ok = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: `Reversing ${peso(amount)} on ${ref} takes it out of every total. Re-enter your password to continue.`,
    });
    if (!ok) return;
    setSaving(true);
    try {
      // One new row. Nothing is updated or deleted: the original stays on
      // record, and v_payment_ledger stops counting both.
      const { error: insertError } = await supabase.from('payment').insert([{
        booking_id: entry.booking_id,
        customer_id: entry.customer_id || null,
        amount_paid: -amount,
        pay_method: entry.pay_method,
        pay_status: REVERSED_STATUS,
        entry_type: ENTRY_TYPES.reversal,
        reverses_payment_id: entry.payment_id,
        reversal_reason: reason.trim(),
        pay_datetime: new Date().toISOString(),
        pay_proof: null,
      }]);
      if (insertError?.code === '23505') {
        toast.error('This receipt has already been reversed. The page has been refreshed.');
        onDone();
        return;
      }
      if (insertError) throw insertError;
      toast.success(`Reversed ${peso(amount)} on ${ref}. The original stays on record.`);
      onDone();
    } catch (err) {
      console.error('Reversal failed:', err);
      toast.error(err.message || 'Could not reverse this receipt.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Reverse Receipt"
      onClose={onClose}
      footer={(
        <>
          {cancelButton(onClose)}
          <button onClick={submit} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white font-semibold text-sm px-5 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-60">
            {saving ? 'Reversing…' : 'Reverse Receipt'}
          </button>
        </>
      )}
    >
      <div className="space-y-4 text-sm text-slate-700">
        <p className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
          This creates a reversing entry of <span className="font-bold text-red-700">−{peso(amount)}</span> against{' '}
          <span className="font-semibold">{ref}</span>. The original stays on record.
        </p>
        <p className="text-[12.5px] text-slate-600">
          Reverse a receipt that was <span className="font-semibold">wrong</span> — money that never came in, or was posted against the wrong booking.
          If the money was real and is going back to the customer, that is a <span className="font-semibold">refund</span>, not a reversal.
          A misposted receipt is reversed here, then recorded again against the right booking.
        </p>
        <div>
          <label htmlFor="reversal-reason" className="block text-xs font-bold text-slate-700 mb-1">Reason<span className="text-red-500 ml-1">*</span></label>
          <textarea
            id="reversal-reason"
            rows={3}
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError(''); }}
            placeholder="e.g. Posted against BKG-116 by mistake; belongs to BKG-117."
            className={`w-full border rounded-lg p-2.5 text-sm outline-none ${error ? 'border-red-400 bg-red-50/40' : 'border-slate-300 focus:border-[#008A45]'}`}
          />
          <p className={`text-xs mt-1 ${error ? 'text-red-600 font-semibold' : 'text-slate-500'}`}>
            {error || `At least ${MIN_REVERSAL_REASON} characters (${reason.trim().length} so far).`}
          </p>
        </div>
      </div>
    </ModalShell>
  );
}

function RecordReceiptModal({ receivables, onClose, onRecorded }) {
  const [search, setSearch] = useState('');
  const [bookingId, setBookingId] = useState('');
  const [form, setForm] = useState({ amount: '', pay_method: 'Cash', receipt_reference: '' });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const booking = receivables.find(b => b.booking_id === bookingId) || null;
  const term = search.trim().toLowerCase();
  const matches = receivables
    .filter(b => !term
      || bookingRef(b).toLowerCase().includes(term)
      || `${b.customer?.first_name || ''} ${b.customer?.last_name || ''}`.toLowerCase().includes(term))
    .slice(0, 50);

  const setField = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
    setErrors(prev => ({ ...prev, [name === 'amount' ? 'amount' : 'receipt']: '' }));
  };
  const setMethod = (method) => {
    setForm(prev => ({ ...prev, pay_method: method, receipt_reference: methodNeedsReceiptNumber(method) ? prev.receipt_reference : '' }));
    setErrors({});
  };
  const onFileChange = (e) => {
    const picked = e.target.files?.[0] || null;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (picked && !allowed.includes(picked.type)) { setErrors(prev => ({ ...prev, file: 'Upload a JPEG, PNG, WebP or GIF image.' })); return; }
    if (picked && picked.size > 5 * 1024 * 1024) { setErrors(prev => ({ ...prev, file: 'The image is larger than 5 MB.' })); return; }
    setFile(picked);
    setErrors(prev => ({ ...prev, file: '' }));
  };

  const submit = async () => {
    if (!booking) { toast.error('Choose the booking this receipt is for.'); return; }
    // A claim on this booking may be the very money being entered by hand;
    // verifying it afterwards would count the same transfer twice.
    if (Number(booking.awaiting_count) > 0) {
      toast.error(`${bookingRef(booking)} has a payment claim awaiting verification. Verify or reject it first — recording a receipt now could count the same money twice.`, { duration: 8000 });
      return;
    }
    const check = validateReceipt({
      amount: form.amount,
      method: form.pay_method,
      receiptReference: form.receipt_reference,
      hasImage: !!file,
      priorPaid: booking.verified_paid,
      total: booking.total_amount,
    });
    if (!check.ok) {
      setErrors({ [check.field]: check.message });
      toast.error(check.message);
      return;
    }
    setSaving(true);
    try {
      // null, not a placeholder: payment_evidence_check needs real evidence.
      let proof = null;
      if (file) {
        const ext = file.name.split('.').pop();
        const path = `payments/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('images').upload(path, file);
        if (uploadError) throw new Error('Could not upload the proof image. Please try again.');
        proof = supabase.storage.from('images').getPublicUrl(path).data.publicUrl;
      }
      const amount = Number(form.amount);
      const { error } = await supabase.from('payment').insert([{
        booking_id: booking.booking_id,
        customer_id: booking.customer_id || null,
        amount_paid: amount,
        pay_method: form.pay_method,
        pay_status: check.stage,
        entry_type: ENTRY_TYPES.receipt,
        receipt_reference: methodNeedsReceiptNumber(form.pay_method) ? form.receipt_reference.trim() : null,
        pay_datetime: new Date().toISOString(),
        pay_proof: proof,
      }]);
      if (error) throw error;
      toast.success(`Receipt recorded as ${check.stage}.`);
      onRecorded(booking, Number(booking.verified_paid || 0) + amount);
    } catch (err) {
      console.error('Record receipt failed:', err);
      toast.error(err.message || 'Could not record the receipt.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Record Receipt"
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={(
        <>
          {cancelButton(onClose)}
          <button onClick={submit} disabled={saving || !booking} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-5 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50">
            {saving ? 'Saving…' : 'Record Receipt'}
          </button>
        </>
      )}
    >
      <div className="space-y-5">
        <div>
          <label htmlFor="receipt-booking-search" className="block text-xs font-bold text-slate-700 mb-1">Booking</label>
          {booking ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-[#008A45]/40 bg-[#EAF3F2] px-3.5 py-3 text-sm">
              <div>
                <p className="font-semibold text-slate-900">{bookingRef(booking)} · {booking.customer ? `${booking.customer.first_name} ${booking.customer.last_name}` : 'Unknown customer'}</p>
                <p className="text-[12.5px] text-slate-600 mt-0.5 tabular-nums">
                  {booking.booking_type} · {booking.booking_status} · contract amount {peso(booking.total_amount)} · collected {peso(booking.verified_paid)} · balance due {peso(booking.outstanding)}
                </p>
              </div>
              <button type="button" onClick={() => setBookingId('')} className="text-[12.5px] font-semibold text-slate-600 hover:text-slate-900 shrink-0">Change</button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  id="receipt-booking-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by reference or customer"
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:border-[#008A45]"
                />
              </div>
              <div className="mt-2 max-h-56 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 bg-white">
                {matches.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500">No agreed booking with a balance matches.</p>
                ) : matches.map(b => (
                  <button key={b.booking_id} type="button" onClick={() => setBookingId(b.booking_id)} className="w-full text-left px-3 py-2.5 hover:bg-slate-50 text-sm">
                    <span className="font-semibold text-slate-900">{bookingRef(b)}</span>
                    <span className="text-slate-600"> · {b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown customer'}</span>
                    <span className="block text-[12px] text-slate-500 tabular-nums">{b.booking_status} · balance due {peso(b.outstanding)} of {peso(b.total_amount)}</span>
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-slate-500 mt-1">Approved, confirmed and completed</p>
            </>
          )}
        </div>
        {booking && (
          <ReceiptFields
            amount={form.amount}
            onAmountChange={setField}
            method={form.pay_method}
            onMethodChange={setMethod}
            receiptReference={form.receipt_reference}
            onReceiptReferenceChange={setField}
            file={file}
            onFileChange={onFileChange}
            errors={errors}
            priorPaid={Number(booking.verified_paid) || 0}
            total={Number(booking.total_amount) || 0}
          />
        )}
      </div>
    </ModalShell>
  );
}

function VerifyClaimModal({ claim, bookingMoney, onClose, onVerified }) {
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();
  const [method, setMethod] = useState(RECEIPT_METHODS.includes(claim.pay_method) ? claim.pay_method : 'GCash');
  const [saving, setSaving] = useState(false);
  const priorPaid = Number(bookingMoney?.verified_paid) || 0;
  const total = Number(bookingMoney?.total_amount ?? claim.booking?.total_amount) || 0;
  const amount = Number(claim.amount_paid) || 0;
  const stage = stageForReceipt({ priorPaid, amount, total });
  const remaining = Math.max(0, total - priorPaid);

  const submit = async () => {
    if (total > 0 && amount > remaining + 0.005) {
      const proceed = await showConfirm({
        title: 'Verifying This Overpays the Booking',
        message: `This claim (${peso(amount)}) is ${peso(amount - remaining)} more than the ${peso(remaining)} balance due on this booking. Verify anyway?`,
        confirmLabel: 'Yes, Verify Anyway',
        confirmVariant: 'warning',
      });
      if (!proceed) return;
    }
    const ok = await requestPasswordConfirm({
      title: 'Confirm your password',
      message: 'Verifying a claim records it as a receipt — money in hand. Re-enter your password to continue.',
    });
    if (!ok) return;
    setSaving(true);
    try {
      const managerId = await getCurrentManagerId();
      const { data, error } = await supabase
        .from('payment')
        .update({ pay_status: stage, pay_method: method, verified_at: new Date().toISOString(), verified_by: managerId })
        .eq('payment_id', claim.payment_id)
        .eq('pay_status', PENDING_VERIFICATION)
        .select('payment_id');
      if (error) throw error;
      if (!data?.length) throw new Error('This claim was already dealt with. The page has been refreshed.');
      toast.success(`Verified as ${method}, recorded as ${stage}.`);
      onVerified(claim.booking, priorPaid + amount);
    } catch (err) {
      console.error('Verify failed:', err);
      toast.error(err.message || 'Could not verify this claim.');
      onVerified(null);
    } finally {
      setSaving(false);
    }
  };

  const proofUrl = getProofUrl(claim.pay_proof);
  return (
    <ModalShell
      title="Verify Payment Claim"
      onClose={onClose}
      footer={(
        <>
          {cancelButton(onClose)}
          <button onClick={submit} disabled={saving} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-5 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-60">
            {saving ? 'Verifying…' : 'Verify'}
          </button>
        </>
      )}
    >
      <div className="space-y-4 text-sm text-slate-700">
        <p>
          <span className="font-semibold">{customerName(claim)}</span> says they paid <span className="font-bold">{peso(amount)}</span> on{' '}
          <span className="font-semibold">{bookingRef(claim.booking)}</span>.
        </p>
        {proofUrl && <img src={proofUrl} alt="Submitted proof" className="max-h-64 rounded-lg border border-slate-200 mx-auto" />}
        <div>
          <span className="block text-xs font-bold text-slate-700 mb-1.5">Payment Method</span>
          <div className="grid grid-cols-3 gap-2">
            {RECEIPT_METHODS.map(m => (
              <button key={m} type="button" onClick={() => setMethod(m)} className={`px-2.5 py-2 rounded-lg border text-[13px] font-semibold ${method === m ? 'bg-[#CBDEDD]/60 border-[#008A45] text-slate-900' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}>{m}</button>
            ))}
          </div>
        </div>
        <p className="flex items-center gap-1.5">
          It will be recorded as
          <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold ${payStatusPillClass(stage)}`}>{stage}</span>
        </p>
      </div>
    </ModalShell>
  );
}

function RejectClaimModal({ claim, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (!reason.trim()) { toast.error('Please provide a reason so the customer knows what to fix.'); return; }
    setSaving(true);
    try {
      const { error } = await supabase
        .from('payment')
        .update({ pay_status: PROOF_REJECTED, remarks: reason.trim() })
        .eq('payment_id', claim.payment_id)
        .eq('pay_status', PENDING_VERIFICATION);
      if (error) throw error;
      toast.success('Claim rejected. The customer will need to resubmit.');
      onDone();
    } catch (err) {
      console.error('Reject failed:', err);
      toast.error(err.message || 'Could not reject this claim.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <ModalShell
      title="Reject Payment Claim"
      onClose={onClose}
      footer={(
        <>
          {cancelButton(onClose)}
          <button onClick={submit} disabled={saving} className="bg-red-600 hover:bg-red-700 text-white font-semibold text-sm px-5 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-60">
            {saving ? 'Rejecting…' : 'Reject Claim'}
          </button>
        </>
      )}
    >
      <div className="space-y-3 text-sm text-slate-700">
        <p>{customerName(claim)} · {peso(claim.amount_paid)} on {bookingRef(claim.booking)}</p>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What the customer needs to fix" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" />
      </div>
    </ModalShell>
  );
}

// Where Total Receivables comes from: every agreed booking with an event in the
// period and money still owed, one row each. The Balance Due column adds up
// to the card. Rows come from v_booking_money exactly as the card does.
function ReceivablesBreakdown({ bookings, period, total, onClose, onOpenBooking }) {
  return (
    <ModalShell
      title="Total Receivables"
      onClose={onClose}
      maxWidth="max-w-4xl"
      footer={<button type="button" onClick={onClose} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-5 py-2.5 rounded-lg border border-slate-300 transition-colors">Close</button>}
    >
      <p className="text-[13px] text-slate-600 mb-3">
        Confirmed and completed catering {forPeriod(period)}
      </p>
      {bookings.length === 0 ? (
        <p className="text-sm text-slate-500 italic text-center py-6">No balances due for services in this period.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="bg-[#fbfcfd] border-b border-slate-100 text-[12px] font-bold uppercase tracking-[0.05em] text-slate-600">
                <th className="px-3 py-2.5">Booking</th>
                <th className="px-3 py-2.5">Event</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5 text-right">Contract Amount</th>
                <th className="px-3 py-2.5 text-right">Collected</th>
                <th className="px-3 py-2.5 text-right">Balance Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {bookings.map(b => (
                <tr key={b.booking_id} onClick={() => onOpenBooking(b)} className="hover:bg-[#fbfcfd] cursor-pointer" title="Open the booking">
                  <td className="px-3 py-2.5">
                    <span className="font-semibold text-[#007038] inline-flex items-center gap-1">{bookingRef(b)} <ExternalLink size={11} /></span>
                    <span className="block text-[12px] text-slate-500">{b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown customer'}</span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{b.event_datetime ? formatDate(b.event_datetime) : '—'}</td>
                  <td className="px-3 py-2.5">{b.booking_status}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{peso(b.total_amount)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{peso(b.net_paid)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-amber-700">{peso(b.outstanding)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 bg-[#fbfcfd] font-bold text-slate-900">
                <td className="px-3 py-2.5" colSpan={5}>{bookings.length} booking{bookings.length === 1 ? '' : 's'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{peso(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// The ledger table
// ---------------------------------------------------------------------------
function LedgerTable({ rows, mode, onOpenBooking, onProof, onReverse, onVerify, onReject }) {
  const isClaims = mode === 'claims';
  const isRefunds = mode === 'Refunds';
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-[#fbfcfd] border-b border-slate-100 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-700">
            <th className="px-4 py-3 whitespace-nowrap">Customer</th>
            <th className="px-4 py-3 whitespace-nowrap">Reference</th>
            <th className="px-4 py-3 whitespace-nowrap">Method</th>
            <th className="px-4 py-3 whitespace-nowrap text-right">Amount</th>
            <th className="px-4 py-3 whitespace-nowrap">{isClaims ? 'Status' : isRefunds ? 'Entry' : 'Stage'}</th>
            <th className="px-4 py-3 whitespace-nowrap">Date</th>
            <th className="px-4 py-3 whitespace-nowrap">Receipt / Proof</th>
            <th className="px-4 py-3 whitespace-nowrap text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
          {rows.map(({ entry, reversal }) => {
            const badge = ledgerEntryBadge(entry);
            const reversible = !isClaims && !isRefunds && entry.entry_type === ENTRY_TYPES.receipt && entry.counts_in_ledger === true;
            const proofUrl = getProofUrl(entry.pay_proof);
            const cells = (e, b, isReversalRow) => (
              <>
                <td className={`px-4 py-[13px] ${isReversalRow ? 'pl-9' : ''}`}>
                  {isReversalRow ? (
                    <span className="flex items-center gap-1.5 text-[13px] text-slate-600">
                      <Undo2 size={13} className="text-slate-400" /> Reverses {receiptLabel(entry)}
                    </span>
                  ) : (
                    <span className="text-[15px] font-semibold text-slate-900">{customerName(e)}</span>
                  )}
                </td>
                <td className="px-4 py-[13px]">
                  {!isReversalRow && (
                    <button onClick={() => onOpenBooking(e)} className="text-[#007038] font-semibold inline-flex items-center gap-1 hover:text-[#008A45]" title="Open the booking">
                      {bookingRef(e.booking)} <ExternalLink size={11} />
                    </button>
                  )}
                  {!isReversalRow && <span className="block text-[12px] text-slate-500">{e.booking?.booking_type || ''}</span>}
                </td>
                <td className="px-4 py-[13px] text-slate-600">{isReversalRow ? '' : (e.pay_method || '—')}</td>
                <td className={`px-4 py-[13px] text-right tabular-nums whitespace-nowrap font-semibold ${b.struck ? 'line-through text-slate-400' : e.amount_paid < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                  {e.amount_paid < 0 ? '−' : ''}{peso(Math.abs(e.amount_paid))}
                </td>
                <td className="px-4 py-[13px]">
                  <span title={b.note || undefined} className={`inline-block px-2.5 py-[3px] rounded-full border text-[12px] font-semibold whitespace-nowrap ${b.className} ${b.note ? 'cursor-help' : ''}`}>
                    {b.label}
                  </span>
                </td>
                <td className="px-4 py-[13px] text-slate-600 tabular-nums whitespace-nowrap">{e.pay_datetime ? new Date(e.pay_datetime).toLocaleDateString() : '—'}</td>
                <td className="px-4 py-[13px] text-slate-600">
                  {isReversalRow ? '' : e.receipt_reference ? (
                    <span className="text-[13px]">No. {e.receipt_reference}</span>
                  ) : null}
                  {!isReversalRow && proofUrl && (
                    <button onClick={() => onProof(proofUrl)} className="block text-[12.5px] font-semibold text-[#007038] hover:underline">View proof</button>
                  )}
                  {!isReversalRow && !e.receipt_reference && !proofUrl && <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-[13px] text-right">
                  {isReversalRow ? null : isClaims ? (
                    <span className="inline-flex gap-1.5">
                      <button onClick={() => onVerify(e)} className="flex items-center gap-1 px-3 py-[6px] rounded-[9px] bg-[#008A45] hover:bg-[#007038] text-white text-[12.5px] font-semibold"><Check size={13} /> Verify</button>
                      <button onClick={() => onReject(e)} className="flex items-center justify-center w-8 h-8 rounded-[9px] border border-red-200 text-red-700 hover:bg-red-50" title="Reject claim" aria-label="Reject claim"><X size={14} /></button>
                    </span>
                  ) : reversible ? (
                    <button onClick={() => onReverse(e)} className="inline-flex items-center gap-1 px-3 py-[6px] rounded-[9px] border border-slate-200 text-slate-600 hover:text-red-700 hover:border-red-200 text-[12.5px] font-semibold" title="Correct a receipt that was wrong">
                      <Undo2 size={13} /> Reverse
                    </button>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
              </>
            );
            return [
              <tr key={entry.payment_id} className="hover:bg-[#fbfcfd] transition-colors">{cells(entry, badge, false)}</tr>,
              reversal ? (
                <tr key={reversal.payment_id} className="bg-slate-50/70" title={reversal.reversal_reason || undefined}>
                  {cells(reversal, ledgerEntryBadge(reversal), true)}
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function Receivables() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();

  const [entries, setEntries] = useState([]);
  const [money, setMoney] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = () => setRefreshTick(t => t + 1);

  const [tab, setTab] = useState('Receipts'); // 'Receipts' | 'Refunds'
  const [showClaims, setShowClaims] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [methodFilter, setMethodFilter] = useState('All');
  const [stageFilter, setStageFilter] = useState('All');
  // A page that sends the manager here can name the period it was showing —
  // the Dashboard's Cash Receipts card does, so the receipts listed here are
  // the ones behind the figure that was clicked. Initial state only: once the
  // page is open the control belongs to the manager.
  const location = useLocation();
  const [datePreset, setDatePreset] = useState(location.state?.datePreset || DEFAULT_DATE_PRESET);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [recordOpen, setRecordOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState(null);
  const [verifyTarget, setVerifyTarget] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [proofUrl, setProofUrl] = useState(null);
  const [showReceivablesBreakdown, setShowReceivablesBreakdown] = useState(false);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        // Every entry, with the flags that decide whether it counts.
        const [ledgerRows, moneyRows] = await Promise.all([
          fetchAllRows(() => supabase
            .from('v_payment_ledger')
            .select(`
              payment_id, booking_id, customer_id, entry_type, pay_status, pay_method, amount_paid, pay_datetime,
              pay_proof, receipt_reference, reverses_payment_id, reversal_reason, is_unverified, is_reversed, counts_in_ledger,
              booking:booking_id (booking_id, booking_number, booking_type, booking_status, total_amount, event_datetime,
                customer:customer_id (first_name, last_name))
            `)
            .order('pay_datetime', { ascending: false })
            .order('payment_id', { ascending: true }), 'payment ledger'),
          // What is owed, per booking. Two flags, two jobs: counts_toward_revenue
          // (Confirmed + Completed) scopes Total Receivables; is_receivable
          // (which adds Approved) still decides which bookings a receipt can be
          // recorded against, because an Approved booking can and does take
          // deposits.
          fetchAllRows(() => supabase
            .from('v_booking_money')
            .select(`
              booking_id, booking_number, booking_type, booking_status, customer_id, event_datetime, total_amount,
              verified_paid, net_paid, outstanding, awaiting_count, is_receivable, counts_toward_revenue,
              customer:customer_id (first_name, last_name)
            `)
            .order('event_datetime', { ascending: true, nullsFirst: false })
            .order('booking_id', { ascending: true }), 'booking money'),
        ]);
        if (ignore) return;
        setEntries(ledgerRows);
        setMoney(moneyRows);
      } catch (error) {
        console.error('Receivables load failed:', error);
        if (!ignore) toast.error('Unable to load receivables. Please refresh the page.');
      } finally {
        if (!ignore) setLoaded(true);
      }
    })();
    return () => { ignore = true; };
  }, [refreshTick]);

  // Claims arrive from the customer mobile app, so the page refreshes itself.
  useRealtimeRefresh('receivables-page', ['payment', 'booking'], refresh);

  const { start, end } = getRangeBounds(datePreset, customStart, customEnd);
  // The period, named. Card subtexts on this page follow the same rule as
  // Reports: no digits, no "events", the period named, and only two basis
  // labels — by payment date and by service date.
  const period = periodLabel(datePreset, start, end);
  const inPeriod = (value) => (!start && !end) || isWithinRange(value, start, end);

  // --- The two figures ------------------------------------------------------
  // Cash Receipts: entries that move the books and are positive, by payment date.
  const cashReceipts = entries
    .filter(e => e.counts_in_ledger === true && Number(e.amount_paid) > 0 && inPeriod(e.pay_datetime))
    .reduce((sum, e) => sum + Number(e.amount_paid), 0);
  // Total Receivables: what is owed on agreed bookings, by service date.
  // A receivable is money owed under a contract the business is committed to
  // perform: Confirmed, or Completed and already delivered. An Approved
  // booking has been accepted but not confirmed, so its unpaid balance is
  // pipeline. Its DEPOSITS are untouched by this — they are cash, and Cash
  // Receipts counts them on the day they arrived whatever the booking status.
  const receivablesInPeriod = money.filter(b => b.counts_toward_revenue && inPeriod(b.event_datetime));
  const totalReceivables = receivablesInPeriod.reduce((sum, b) => sum + Number(b.outstanding || 0), 0);
  // The rows behind the card: only those still owing anything, largest first.
  const owingInPeriod = receivablesInPeriod
    .filter(b => Number(b.outstanding) > 0)
    .sort((a, b) => Number(b.outstanding) - Number(a.outstanding));

  // --- Claims (not money) -----------------------------------------------------
  const claims = entries.filter(e => e.pay_status === PENDING_VERIFICATION && Number(e.amount_paid) > 0);
  const claimsTotal = claims.reduce((sum, e) => sum + Number(e.amount_paid), 0);

  // --- Table rows ---------------------------------------------------------------
  const term = search.trim().toLowerCase();
  const passesCommon = (e) => {
    if (typeFilter !== 'All' && e.booking?.booking_type !== typeFilter) return false;
    if (methodFilter !== 'All' && e.pay_method !== methodFilter) return false;
    if (term && !`${customerName(e)} ${bookingRef(e.booking)}`.toLowerCase().includes(term)) return false;
    return true;
  };
  const reversalOf = Object.fromEntries(entries.filter(isReversalEntry).map(r => [r.reverses_payment_id, r]));

  let rows;
  if (showClaims) {
    rows = claims.filter(passesCommon).map(entry => ({ entry }));
  } else if (tab === 'Refunds') {
    rows = entries.filter(e => isRefundEntry(e) && inPeriod(e.pay_datetime) && passesCommon(e)).map(entry => ({ entry }));
  } else {
    // Verified receipts only — a claim is not a receipt. A reversal is shown
    // directly beneath the receipt it cancels, never as a row of its own.
    rows = entries
      .filter(e => e.entry_type === ENTRY_TYPES.receipt && e.is_unverified === false
        && inPeriod(e.pay_datetime) && passesCommon(e)
        && (stageFilter === 'All' || e.pay_status === stageFilter))
      .map(entry => ({ entry, reversal: reversalOf[entry.payment_id] || null }));
  }

  // What the listed receipts add up to, counting only the ones that move the
  // books — with no other filter set this is exactly the Cash Receipts card.
  const listedCounted = !showClaims && tab === 'Receipts'
    ? rows.filter(r => r.entry.counts_in_ledger === true)
    : [];
  const listedCountedTotal = listedCounted.reduce((sum, r) => sum + Number(r.entry.amount_paid), 0);
  const listedReversed = !showClaims && tab === 'Receipts' ? rows.filter(r => r.entry.is_reversed).length : 0;

  // Clicking Cash Receipts shows exactly its receipts: the Receipts tab, the
  // same period, every other filter cleared.
  const showCashReceipts = () => {
    setShowClaims(false);
    setTab('Receipts');
    setSearch(''); setTypeFilter('All'); setMethodFilter('All'); setStageFilter('All');
    document.getElementById('receivables-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const hasFilters = !!term || typeFilter !== 'All' || methodFilter !== 'All' || stageFilter !== 'All' || datePreset !== DEFAULT_DATE_PRESET;
  const clearFilters = () => {
    setSearch(''); setTypeFilter('All'); setMethodFilter('All'); setStageFilter('All');
    setDatePreset(DEFAULT_DATE_PRESET); setCustomStart(''); setCustomEnd('');
  };

  const receivableBookings = money.filter(b => b.is_receivable && Number(b.outstanding) > 0);
  const moneyFor = (bookingId) => money.find(b => b.booking_id === bookingId) || null;

  const offerConfirmation = async (booking, paidAfter) => {
    if (!booking?.booking_id) return;
    // Re-read the booking rather than trusting the status held before the
    // write. A database trigger (trg_confirm_on_payment) promotes
    // Approved to Confirmed the moment a verified receipt reaches half the
    // contracted amount, so the row this page was holding may already be
    // Confirmed — in which case there is nothing to offer.
    const { data: fresh, error: freshError } = await supabase
      .from('v_booking_money')
      .select('booking_id, booking_number, booking_type, booking_status, total_amount, verified_paid, is_lapsed')
      .eq('booking_id', booking.booking_id)
      .maybeSingle();
    if (freshError) console.error('Could not re-read the booking after the receipt:', freshError);
    const b = fresh || moneyFor(booking.booking_id) || booking;
    if (!b) return;
    const eligibility = getConfirmEligibility(b, paidAfter);
    if (!eligibility.eligible) return;
    const ok = await showConfirm(buildConfirmDialog(b, eligibility, { fromVerification: true }));
    if (!ok) return;
    try {
      await applyConfirmation(b.booking_id);
      toast.success('Booking confirmed.');
    } catch (error) {
      console.error(error);
      toast.error(statusWriteErrorMessage(error, 'Failed to confirm booking.'), { duration: 8000 });
    } finally {
      refresh();
    }
  };

  const filterControl = (active) => `border rounded-[10px] px-3 py-2.5 text-sm text-slate-800 outline-none transition-colors ${
    active ? 'border-[#008A45] bg-[#EAF3F2] ring-1 ring-[#008A45]/20' : 'border-slate-200 bg-white focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45]'
  }`;

  return (
    <div className="space-y-[18px] relative">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-[25px] font-bold tracking-[-0.02em] text-slate-900">Receivables</h1>
          <p className="text-[14.5px] text-slate-600 mt-1.5">Money received, and still collectible.</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={refresh} className="bg-white border border-slate-200 text-slate-700 px-4 py-2.5 rounded-[10px] font-semibold transition-colors flex items-center gap-2 text-sm whitespace-nowrap hover:border-[#c9dfd4] hover:text-[#007038]">
            <RefreshCw size={16} className={!loaded ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => setRecordOpen(true)} className="bg-[#008A45] hover:bg-[#007038] text-white px-[17px] py-2.5 rounded-[10px] font-semibold transition-colors flex items-center gap-2 text-sm whitespace-nowrap">
            + Record Receipt
          </button>
        </div>
      </div>

      {/* THE TWO CARDS. Each states the question it answers. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Both open what they add up. */}
        {/* The (i) sits outside the card's button: a button inside a button is
            invalid, and its click would go to the card. Same text as the
            Reports card, because it is the same figure and the same question. */}
        <div className="relative">
        <button onClick={showCashReceipts} className="w-full h-full relative overflow-hidden flex flex-col justify-start text-left rounded-2xl border border-slate-200/70 bg-white p-5 transition-all cursor-pointer hover:border-[#c9dfd4] hover:shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
          <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#008A45]" />
          <p className="text-[13px] font-semibold text-slate-600 mb-2 pr-6">Cash Receipts<span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Cash basis</span></p>
          <h3 className="text-[27px] font-semibold tracking-[-0.03em] leading-[1.05] tabular-nums text-slate-900">{loaded ? peso(cashReceipts) : '—'}</h3>
          <p className="text-[13px] text-slate-600 mt-2.5">Money received</p>
          <span className="flex items-center gap-0.5 text-[12.5px] font-semibold text-[#007038] mt-2">Show these receipts <ChevronRight size={13} /></span>
        </button>
        </div>
        <button onClick={() => setShowReceivablesBreakdown(true)} className="relative overflow-hidden flex flex-col justify-start text-left rounded-2xl border border-slate-200/70 bg-white p-5 transition-all cursor-pointer hover:border-[#c9dfd4] hover:shadow-[0_2px_8px_rgba(15,23,42,0.05)]">
          <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-500" />
          <p className="text-[13px] font-semibold text-slate-600 mb-2">Total Receivables<span className="ml-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Accrual basis</span></p>
          <h3 className="text-[27px] font-semibold tracking-[-0.03em] leading-[1.05] tabular-nums text-slate-900">{loaded ? peso(totalReceivables) : '—'}</h3>
          {/* Two words, the same two used on Reports and on Customers. The
              basis label beside the card's name carries what the old sentence
              spelled out. */}
          <p className="text-[13px] text-slate-600 mt-2.5">Still collectible</p>
          <span className="flex items-center gap-0.5 text-[12.5px] font-semibold text-[#007038] mt-2">Show balances due <ChevronRight size={13} /></span>
        </button>
      </div>

      {/* CLAIMS — not money, so not a card. */}
      {claims.length > 0 && (
        <button
          onClick={() => setShowClaims(v => !v)}
          className={`w-full flex items-start gap-2.5 text-left rounded-xl border px-4 py-3 text-[13.5px] transition-colors ${showClaims ? 'border-orange-300 bg-orange-100/70' : 'border-orange-200 bg-orange-50 hover:bg-orange-100/60'}`}
        >
          <AlertCircle size={17} className="text-orange-600 shrink-0 mt-0.5" />
          <span className="text-orange-900">
            <span className="font-semibold">
              {claims.length} payment claim{claims.length === 1 ? ' is' : 's are'} awaiting your verification — {peso(claimsTotal)}.
            </span>{' '}
            Until you verify {claims.length === 1 ? 'it, it is not a receipt and is' : 'them, they are not receipts and are'} not counted anywhere.
            <span className="ml-1.5 inline-flex items-center font-semibold text-orange-700">{showClaims ? 'Back to receipts' : 'Review'} <ChevronRight size={14} /></span>
          </span>
        </button>
      )}

      {/* TABS */}
      {!showClaims && (
        <div className="flex items-center gap-2 border-b border-slate-200/80">
          {['Receipts', 'Refunds'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-[11px] text-[14.5px] border-b-2 -mb-px transition-colors ${tab === t ? 'border-[#008A45] text-[#007038] font-bold' : 'border-transparent font-semibold text-slate-500 hover:text-slate-700'}`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* FILTERS */}
      <div className={`bg-white rounded-2xl border p-5 transition-colors ${hasFilters ? 'border-[#008A45]/30' : 'border-slate-200/70'}`}>
        <div className="flex items-center gap-2 mb-3">
          <Filter size={13} className="text-slate-500" />
          <span className="text-[13px] font-bold text-slate-600 tracking-[0.04em]">Filters</span>
          <div className="ml-auto flex items-center gap-3">
            {hasFilters && (
              <button onClick={clearFilters} className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-600 hover:text-red-600 transition-colors">
                <RotateCcw size={13} /> Clear filters
              </button>
            )}
            <span className="text-[13.5px] text-slate-600 tabular-nums whitespace-nowrap">{loaded ? `${rows.length} result${rows.length === 1 ? '' : 's'}` : ''}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <label htmlFor="receivables-search" className={`block text-[13px] font-semibold mb-1 ${term ? 'text-[#007038]' : 'text-slate-600'}`}>Search</label>
            <div className="relative">
              <input id="receivables-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Customer name or reference" className={`w-full pl-4 pr-10 ${filterControl(!!term)}`} />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            </div>
          </div>
          <div>
            <label className={`block text-[13px] font-semibold mb-1 ${typeFilter !== 'All' ? 'text-[#007038]' : 'text-slate-600'}`}>Type</label>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className={filterControl(typeFilter !== 'All')}>
              <option value="All">All</option>
              <option value="Package">Packages</option>
              <option value="Short Order">Short Orders</option>
            </Select>
          </div>
          <div>
            <label className={`block text-[13px] font-semibold mb-1 ${methodFilter !== 'All' ? 'text-[#007038]' : 'text-slate-600'}`}>Method</label>
            <Select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className={filterControl(methodFilter !== 'All')}>
              <option value="All">All</option>
              {RECEIPT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>
          {/* The settlement stage is a FILTER, not a row of cards: no counts, no
              amounts. The results line already says how many rows matched. */}
          {!showClaims && tab === 'Receipts' && (
            <div>
              <label className={`block text-[13px] font-semibold mb-1 ${stageFilter !== 'All' ? 'text-[#007038]' : 'text-slate-600'}`}>Stage</label>
              <Select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className={filterControl(stageFilter !== 'All')}>
                <option value="All">All</option>
                {RECEIPT_STAGE_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          )}
          {!showClaims && (
            <div>
              <label className={`block text-[13px] font-semibold mb-1 ${datePreset !== DEFAULT_DATE_PRESET ? 'text-[#007038]' : 'text-slate-600'}`}>Period</label>
              <DateRangeFilter
                preset={datePreset}
                customStart={customStart}
                customEnd={customEnd}
                rangeStart={start}
                rangeEnd={end}
                onPresetChange={setDatePreset}
                onCustomStartChange={setCustomStart}
                onCustomEndChange={setCustomEnd}
                onClear={() => { setDatePreset(DEFAULT_DATE_PRESET); setCustomStart(''); setCustomEnd(''); }}
              />
            </div>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div id="receivables-table" className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden scroll-mt-4">
        <div className="px-5 py-4 border-b border-slate-100">
          <span className="font-bold text-base tracking-[-0.01em] text-slate-900">
            {showClaims ? 'Payment claims awaiting verification' : tab === 'Refunds' ? 'Refunds' : 'Receipts'}
          </span>
          <p className="text-[13px] text-slate-600 mt-0.5">
            {showClaims
              ? 'Submitted from the mobile app'
              : tab === 'Refunds'
                ? 'Money returned to customers'
                : 'Verified receipts only'}
          </p>
        </div>
        {!loaded ? (
          <p className="p-6 text-center text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-6 text-center text-slate-500 italic">{showClaims ? 'No claims awaiting verification.' : 'Nothing matches these filters.'}</p>
        ) : (
          <LedgerTable
            rows={rows}
            mode={showClaims ? 'claims' : tab}
            onOpenBooking={(e) => navigate(bookingPath(e.booking_id, e.booking?.booking_type))}
            onProof={setProofUrl}
            onReverse={setReverseTarget}
            onVerify={setVerifyTarget}
            onReject={setRejectTarget}
          />
        )}
        {loaded && !showClaims && tab === 'Receipts' && rows.length > 0 && (
          <div className="px-5 py-3.5 border-t border-slate-100 bg-[#fbfcfd] flex flex-wrap justify-between gap-2 text-[13px] text-slate-600">
            <span>
              {listedCounted.length} receipt{listedCounted.length === 1 ? '' : 's'}
              {listedReversed > 0 && ` · ${listedReversed} reversed (excluded)`}
            </span>
            <span className="font-semibold text-slate-900 tabular-nums">
              {peso(listedCountedTotal)}
              {!term && typeFilter === 'All' && methodFilter === 'All' && stageFilter === 'All'
                ? <span className="font-normal text-slate-500"> — agrees with Cash Receipts</span>
                : <span className="font-normal text-slate-500"> — for the receipts shown</span>}
            </span>
          </div>
        )}
      </div>

      {recordOpen && (
        <RecordReceiptModal
          receivables={receivableBookings}
          onClose={() => setRecordOpen(false)}
          onRecorded={(booking, paidAfter) => { setRecordOpen(false); refresh(); offerConfirmation(booking, paidAfter); }}
        />
      )}
      {showReceivablesBreakdown && (
        <ReceivablesBreakdown
          bookings={owingInPeriod}
          period={period}
          total={totalReceivables}
          onClose={() => setShowReceivablesBreakdown(false)}
          onOpenBooking={(b) => navigate(bookingPath(b.booking_id, b.booking_type))}
        />
      )}
      {reverseTarget && (
        <ReverseModal entry={reverseTarget} onClose={() => setReverseTarget(null)} onDone={() => { setReverseTarget(null); refresh(); }} />
      )}
      {verifyTarget && (
        <VerifyClaimModal
          claim={verifyTarget}
          bookingMoney={moneyFor(verifyTarget.booking_id)}
          onClose={() => setVerifyTarget(null)}
          onVerified={(booking, paidAfter) => { setVerifyTarget(null); refresh(); if (booking) offerConfirmation(booking, paidAfter); }}
        />
      )}
      {rejectTarget && (
        <RejectClaimModal claim={rejectTarget} onClose={() => setRejectTarget(null)} onDone={() => { setRejectTarget(null); refresh(); }} />
      )}
      {proofUrl && createPortal(
        <div className="fixed inset-0 z-[99999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setProofUrl(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">Proof</h3>
              <button onClick={() => setProofUrl(null)} aria-label="Close" className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1"><X size={18} /></button>
            </div>
            <div className="p-4 flex items-center justify-center max-h-[75vh] overflow-auto">
              <img src={proofUrl} alt="Payment proof" className="max-w-full max-h-full object-contain rounded-lg" />
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
