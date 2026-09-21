// src/components/OverrideStatusModal.jsx
//
// The sanctioned exception to the payment policy.
//
// Automated controls need a way out, or people route around them — and the
// control here is not that an override is impossible, it is that it is
// authorised, reasoned and logged. So this never writes booking_status
// directly. It calls f_override_booking_status, which is the only path that
// guarantees three things at once: the caller is a manager, the reason is not
// empty, and booking_status_log records the change with source
// "Manager override" rather than "Manual".
//
// It warns when the chosen status contradicts the 50% deposit policy and then
// lets the manager proceed. A warning that blocks is not an override.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ShieldAlert, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import { STATUS_ORDER } from '../utils/bookingStatus';
import { CONFIRM_PAID_FRACTION } from '../utils/confirmBooking';
import { LAPSED_OVERRIDE_WARNING } from '../utils/lapsed';

const ALL_STATUSES = Object.keys(STATUS_ORDER);

const peso = (n) => `₱${(Number(n) || 0).toLocaleString()}`;

/**
 * @param booking      the row being overridden: booking_id, booking_status,
 *                     booking_number, booking_type, total_amount
 * @param verifiedPaid what has actually been verified against it, so the
 *                     policy warning can be stated in figures rather than as
 *                     a vague caution. Read from v_booking_money by the page.
 */
export default function OverrideStatusModal({ booking, isOpen, onClose, onDone, verifiedPaid = 0, isLapsed = false }) {
  const [newStatus, setNewStatus] = useState(booking?.booking_status || 'Pending');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  if (!isOpen || !booking) return null;

  const noun = booking.booking_type === 'Short Order' ? 'order' : 'booking';
  const total = Number(booking.total_amount) || 0;
  const required = total * CONFIRM_PAID_FRACTION;
  const paid = Number(verifiedPaid) || 0;

  // The one conflict worth naming: confirming work the deposit policy would
  // not yet confirm on its own.
  const policyConflict = (newStatus === 'Confirmed' || newStatus === 'Completed')
    && total > 0 && paid < required;

  const unchanged = newStatus === booking.booking_status;
  const reasonMissing = reason.trim().length === 0;

  const submit = async () => {
    setTouched(true);
    if (reasonMissing) {
      // Checked here as well as in the function: the manager should be told
      // before a round trip, and the function still refuses without one.
      toast.error('A reason is required');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('f_override_booking_status', {
        p_booking_id: booking.booking_id,
        p_new_status: newStatus,
        p_reason: reason.trim(),
      });
      if (error) throw error;
      toast.success(`Status set to ${newStatus}. The override has been recorded.`);
      onDone?.();
      onClose();
    } catch (error) {
      console.error('Override failed:', error);
      // The function raises for a non-manager and for an empty reason; show
      // what it said rather than a generic failure.
      toast.error(error?.message || 'The override was refused.');
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-100">
          <div className="flex items-start gap-2.5">
            <ShieldAlert size={18} className="text-blue-600 mt-0.5 shrink-0" />
            <div>
              <h3 className="text-[16px] font-bold text-slate-900">Override Status</h3>
              <p className="text-[12.5px] text-slate-500">
                {booking.booking_number} · currently {booking.booking_status}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">New status</label>
            <div className="grid grid-cols-3 gap-2">
              {ALL_STATUSES.map(status => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setNewStatus(status)}
                  className={`rounded-[10px] border px-3 py-2 text-sm font-semibold transition-colors ${
                    newStatus === status
                      ? 'border-[#008A45] bg-[#EAF3F2] text-[#007038]'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  {status}
                  {status === booking.booking_status && (
                    <span className="block text-[11px] font-medium text-slate-500">current</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* The override is the ONE path the lapsed guard exempts, which is
              how a past event gets recorded retroactively. Said plainly, and
              it does not block — that is the point of an override. */}
          {isLapsed && (newStatus === 'Approved' || newStatus === 'Confirmed') && (
            <p className="text-[13px] text-slate-700 bg-slate-50 border border-slate-300 rounded-[10px] px-3.5 py-2.5">
              {LAPSED_OVERRIDE_WARNING}
            </p>
          )}

          {policyConflict && (
            <p className="text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-[10px] px-3.5 py-2.5">
              Below the 50% deposit policy — {peso(paid)} of {peso(required)}
            </p>
          )}

          <div>
            <label className="block text-[13px] font-semibold text-slate-700 mb-1.5">
              Reason <span className="text-red-600">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              rows={3}
              placeholder="e.g. Customer paid the balance in cash at the office"
              className={`w-full rounded-[10px] border px-3.5 py-2.5 text-sm outline-none transition-colors ${
                touched && reasonMissing
                  ? 'border-red-400 bg-red-50/40 focus:ring-[3px] focus:ring-red-200'
                  : 'border-slate-200 focus:ring-[3px] focus:ring-[#008A45]/12 focus:border-[#008A45]'
              }`}
            />
            <p className="text-[12px] text-slate-500 mt-1">Recorded in the status history.</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || unchanged}
            title={unchanged ? 'Choose a different status' : undefined}
            className="inline-flex items-center gap-2 rounded-[10px] bg-[#008A45] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#007038] disabled:opacity-60"
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Record override
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
