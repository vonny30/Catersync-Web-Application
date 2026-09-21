// src/hooks/useRejectionHandlers.js
import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { ENTRY_TYPES, REFUNDED_STATUS, RECEIPT_METHODS, REFUND_METHOD_MESSAGE } from '../utils/payments';
import { useConfirm } from '../contexts/ConfirmContext';
import { STATUS_ORDER } from '../utils/bookingStatus';
import { prepareRefundEvidence } from '../utils/refundEvidence';

export function useRejectionHandlers({ getBooking, getPaymentSummary, fetchData }) {
  const { showConfirm } = useConfirm();

  const [isRejectionModalOpen, setIsRejectionModalOpen] = useState(false);
  const [rejectionBookingId, setRejectionBookingId] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionRefundAmount, setRejectionRefundAmount] = useState('');
  const [rejectionRefundRemarks, setRejectionRefundRemarks] = useState('');
  const [rejectionRefundFile, setRejectionRefundFile] = useState(null);
  // How the money went back. Required on every refund (pay_method CHECK).
  const [rejectionRefundMethod, setRejectionRefundMethod] = useState('');
  // Cash only: the number on the receipt given to the customer.
  const [rejectionRefundReceiptNo, setRejectionRefundReceiptNo] = useState('');
  const [showRejectionRefund, setShowRejectionRefund] = useState(false);
  const [rejectionMaxRefundable, setRejectionMaxRefundable] = useState(0);

  /**
   * @param reasonPrefill
   *   Filled in when the caller already knows why — today only a lapsed
   *   booking, where the reason is a fact rather than a judgement. It lands in
   *   the field EDITABLE: the manager may have a better sentence for the
   *   customer, and the prefill is a starting point, not a decision.
   */
  const openRejectionModal = async (id, reasonPrefill = '') => {
    const booking = getBooking(id);
    if (!booking) {
      toast.error('Booking not found.');
      return;
    }

    const noun = booking.booking_type === 'Short Order' ? 'order' : 'booking';
    const { positivePayments = 0, downpaymentPaid = 0 } = getPaymentSummary(id) || {};
    const totalAmount = booking.total_amount || 0;
    const percentage = totalAmount > 0 ? (positivePayments / totalAmount) * 100 : 0;

    let warningMessage = `Are you sure you want to reject this ${noun}? This will cancel it and cannot be undone.`;
    if (positivePayments > 0) {
      warningMessage = `This ${noun} has payments totaling ₱${positivePayments.toLocaleString()} (${percentage.toFixed(1)}% of total). Rejecting this ${noun} will keep the payments recorded. You may need to process refunds separately. Do you still want to reject?`;
    }

    const confirmed = await showConfirm({
      title: `Reject ${noun === 'order' ? 'Order' : 'Booking'}?`,
      message: warningMessage,
      confirmLabel: 'Yes, Continue',
      cancelLabel: 'Cancel',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    // Calculate refund eligibility.
    //
    // Same rule as useCancellationHandlers, including the no-date case: the
    // 3-day deadline needs an event date to measure against, and defaulting to
    // "not refundable" forfeited a downpayment under a deadline that was never
    // evaluated. An unmeasurable deadline forfeits nothing.
    const eventDate = booking.event_datetime ? new Date(booking.event_datetime) : null;
    let isRefundable = !booking.event_datetime;
    if (eventDate) {
      const now = new Date();
      const diffTime = eventDate.getTime() - now.getTime();
      const daysUntilEvent = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      isRefundable = daysUntilEvent >= 3;
    }

    const maxRefundable = isRefundable
      ? positivePayments
      : Math.max(0, positivePayments - downpaymentPaid);

    setRejectionBookingId(id);
    setRejectionMaxRefundable(maxRefundable);
    setShowRejectionRefund(maxRefundable > 0);
    setRejectionReason(reasonPrefill);
    setRejectionRefundAmount('');
    setRejectionRefundRemarks('');
    setRejectionRefundFile(null);
    setRejectionRefundMethod('');
    setRejectionRefundReceiptNo('');
    setIsRejectionModalOpen(true);
  };

  const handleRejectConfirm = async () => {
    const id = rejectionBookingId;
    if (!id) return;
    const booking = getBooking(id);
    if (!booking) return;
    const noun = booking.booking_type === 'Short Order' ? 'order' : 'booking';

    // --- ✅ VALIDATE: Rejection reason is required ---
    if (!rejectionReason || rejectionReason.trim() === '') {
      toast.error('Please provide a reason for rejection.');
      return;
    }

    let enteredAmount = 0;
    let proofUrl = null;
    let receiptReference = null;

    if (showRejectionRefund) {
      enteredAmount = parseFloat(rejectionRefundAmount) || 0;
      if (enteredAmount > 0) {
        if (enteredAmount > rejectionMaxRefundable) {
          toast.error(`Refund amount cannot exceed ₱${rejectionMaxRefundable.toLocaleString()}.`);
          return;
        }
        if (!RECEIPT_METHODS.includes(rejectionRefundMethod)) {
          toast.error(REFUND_METHOD_MESSAGE);
          return;
        }
        // Cash -> receipt number required, image optional; GCash / Bank
        // Transfer -> image required. One rule for every refund flow.
        const evidence = await prepareRefundEvidence({ method: rejectionRefundMethod, file: rejectionRefundFile, receiptNo: rejectionRefundReceiptNo });
        if (evidence.error) {
          toast.error(evidence.error);
          return;
        }
        proofUrl = evidence.proofUrl;
        receiptReference = evidence.receiptReference;
      }
    }

    setIsRejectionModalOpen(false);

    try {
      const reasonText = rejectionReason.trim();
      let updatedNotes = booking.notes
        ? `${booking.notes}\n[REJECTION] ${reasonText}`
        : `[REJECTION] ${reasonText}`;

      const { error } = await supabase
        .from('booking')
        .update({
          booking_status: 'Rejected',
          status_order: STATUS_ORDER.Rejected,
          notes: updatedNotes,
          is_read: true,
        })
        .eq('booking_id', id);
      if (error) throw error;

      // Cleanup — RELEASE what is still held, KEEP what already happened.
      //
      // These were unfiltered deletes, which took the returned equipment and
      // the completed dispatches with them. A van that actually made the trip,
      // or a tray that actually came back, is a fact about the past; the
      // booking being cancelled afterwards does not un-happen it. The Vehicles
      // history tab reads these rows unfiltered, so the record simply
      // disappeared from it.
      //
      // Filtering by status is also what makes this safe to keep: conflict
      // checks and `activeAssignmentsFor` both skip Completed assignments, and
      // the stock queries in utils/equipment all filter `returned = false`, so
      // retained rows hold neither a vehicle nor any stock.
      // Both deletes were awaited with the result thrown away. A failure —
      // RLS, a dropped connection — left the rows behind silently, and an
      // unreturned row on a rejected booking is then counted as equipment that
      // is out. That is exactly how BKG-105 came to hold 59 phantom units.
      const { error: equipReleaseError } = await supabase.from('booking_equipment').delete().eq('booking_id', id).eq('returned', false);
      if (equipReleaseError) toast.error('Booking updated, but its equipment could not be released. Release it from the Equipment page.');
      const { error: vehicleReleaseError } = await supabase.from('vehicle_assign').delete().eq('booking_id', id).neq('assignment_status', 'Completed');
      if (vehicleReleaseError) toast.error('Booking updated, but its vehicles could not be released. Release them from the Vehicles page.');

      if (showRejectionRefund && enteredAmount > 0) {
        const { error: refundError } = await supabase
          .from('payment')
          .insert([{
            booking_id: id,
            amount_paid: -enteredAmount,
            pay_method: rejectionRefundMethod,
            pay_status: REFUNDED_STATUS,
            entry_type: ENTRY_TYPES.refund,
            pay_datetime: new Date().toISOString(),
            pay_proof: proofUrl,
            receipt_reference: receiptReference,
            customer_id: booking.customer_id,
            remarks: rejectionRefundRemarks || 'Refund processed during rejection',
          }]);
        // The booking is already Rejected here, with its equipment and
        // vehicles released. Rethrowing reported "Failed to reject" for a
        // rejection that had gone through, hiding the fact that the REFUND was
        // what failed — and inviting a retry that cannot repeat.
        if (refundError) {
          console.error('Refund insert failed after rejection:', refundError);
          if (fetchData) fetchData();
          toast.error(
            `The ${noun} was rejected, but the ₱${enteredAmount.toLocaleString()} refund could not be recorded. Record it from the Receivables page — do not reject again.`,
            { duration: 10000 }
          );
          return;
        }

        const refundNote = `[REFUND] Amount: ₱${enteredAmount.toFixed(2)}. ${rejectionRefundRemarks || ''}`;
        updatedNotes = updatedNotes + `\n${refundNote}`;
        await supabase
          .from('booking')
          .update({ notes: updatedNotes })
          .eq('booking_id', id);
      }

      toast.success(`${noun === 'order' ? 'Order' : 'Booking'} rejected.`);
      if (fetchData) fetchData();
    } catch (error) {
      console.error('Rejection error:', error);
      toast.error(`Failed to reject ${noun}.`);
    }
  };

  return {
    isRejectionModalOpen,
    setIsRejectionModalOpen,
    rejectionReason,
    setRejectionReason,
    rejectionRefundAmount,
    setRejectionRefundAmount,
    rejectionRefundRemarks,
    setRejectionRefundRemarks,
    rejectionRefundFile,
    setRejectionRefundFile,
    rejectionRefundMethod,
    setRejectionRefundMethod,
    rejectionRefundReceiptNo,
    setRejectionRefundReceiptNo,
    showRejectionRefund,
    rejectionMaxRefundable,
    openRejectionModal,
    handleRejectConfirm,
  };
}