import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { sumVerifiedPositivePayments } from '../utils/payments';
import { STATUS_ORDER } from '../utils/bookingStatus';

export function useCancellationHandlers({ booking, payments, fetchData }) {
  const { showConfirm } = useConfirm();
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundRemarks, setRefundRemarks] = useState('');
  const [refundFile, setRefundFile] = useState(null);
  const [isCancelling, setIsCancelling] = useState(false);

  const openCancelModal = () => {
    setCancelReason('');
    setRefundAmount('');
    setRefundRemarks('');
    setRefundFile(null);
    setIsCancelModalOpen(true);
  };

  const handleCancelBooking = async () => {
    if (!cancelReason.trim()) {
      toast.error('Please provide a cancellation reason.');
      return;
    }

    const noun = booking.booking_type === 'Short Order' ? 'order' : 'booking';
    setIsCancelling(true);
    try {
      const eventDate = booking.event_datetime ? new Date(booking.event_datetime) : null;
      const now = new Date();
      // The 3-day rule needs an event date to measure against. With no date it
      // cannot be evaluated at all, and the old code defaulted to NOT
      // refundable — forfeiting the customer's downpayment under a deadline
      // nobody had checked, while the note claimed the cancellation happened
      // "within 999 days (< 3 days)" from an unused sentinel. Of the two ways
      // to be wrong, keeping money we cannot justify keeping is the worse one,
      // so an unmeasurable deadline does not forfeit anything.
      let isRefundable = !booking.event_datetime;
      let daysUntilEvent = null;

      const positivePayments = sumVerifiedPositivePayments(payments);
      const downpaymentPayments = payments.filter(p => p.pay_status === 'Downpayment' && p.amount_paid > 0);
      const totalDownpayment = downpaymentPayments.reduce((sum, p) => sum + p.amount_paid, 0);

      if (eventDate) {
        const diffTime = eventDate.getTime() - now.getTime();
        daysUntilEvent = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        isRefundable = daysUntilEvent >= 3;
      }

      let maxRefundable = 0;
      if (isRefundable) {
        maxRefundable = positivePayments;
      } else {
        maxRefundable = Math.max(0, positivePayments - totalDownpayment);
      }

      let refundNote = '';
      let shouldRefund = false;
      let refundAmountValue = 0;
      let proofUrl = 'refund_placeholder.png';

      const enteredAmount = parseFloat(refundAmount) || 0;
      if (enteredAmount > 0) {
        if (maxRefundable <= 0) {
          toast.error(`No refundable amount available for this ${noun}.`);
          setIsCancelling(false);
          return;
        }
        if (enteredAmount > maxRefundable) {
          toast.error(`Refund amount cannot exceed ₱${maxRefundable.toLocaleString()}.`);
          setIsCancelling(false);
          return;
        }
        if (!refundFile) {
          toast.error('Please upload a proof of refund receipt.');
          setIsCancelling(false);
          return;
        }

        // Same checks the rejection refund already performs. This path had
        // none, so any file of any size went up as "proof of refund".
        const MAX_PROOF_BYTES = 5 * 1024 * 1024;
        const ALLOWED_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        if (!ALLOWED_PROOF_TYPES.includes(refundFile.type)) {
          toast.error('Invalid file type. Please upload a JPEG, PNG, WebP, or GIF image.');
          setIsCancelling(false);
          return;
        }
        if (refundFile.size > MAX_PROOF_BYTES) {
          toast.error(`File is too large. Maximum size is 5 MB. Your file is ${(refundFile.size / 1024 / 1024).toFixed(2)} MB.`);
          setIsCancelling(false);
          return;
        }

        // Upload proof
        const fileExt = refundFile.name.split('.').pop();
        const fileName = `refunds/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(fileName, refundFile);
        if (uploadError) {
          toast.error('Failed to upload refund proof. Please try again.');
          setIsCancelling(false);
          return;
        }
        const { data: publicUrlData } = supabase.storage
          .from('images')
          .getPublicUrl(fileName);
        proofUrl = publicUrlData.publicUrl;

        refundAmountValue = enteredAmount;
        shouldRefund = true;

        if (isRefundable) {
          refundNote = `Refund of ₱${refundAmountValue.toFixed(2)} processed. ${refundRemarks || ''}`;
        } else {
          refundNote = `Refund of excess (₱${refundAmountValue.toFixed(2)}) processed. Downpayment of ₱${totalDownpayment.toFixed(2)} forfeited (less than 3 days). ${refundRemarks || ''}`;
        }
      } else {
        if (positivePayments > 0 && !isRefundable && daysUntilEvent !== null) {
          refundNote = `Client cancelled ${daysUntilEvent} day${daysUntilEvent === 1 ? '' : 's'} before the event (less than 3 days). Downpayment of ₱${totalDownpayment.toLocaleString()} is non-refundable per policy.`;
        } else {
          refundNote = 'Client cancelled – no refund processed.';
        }
      }

      let updatedNotes = `[CANCELLATION] ${cancelReason}. ${refundNote}`;
      if (booking.notes) {
        updatedNotes = `${booking.notes}\n\n${updatedNotes}`;
      }

      const { error: updateError } = await supabase
        .from('booking')
        .update({ booking_status: 'Cancelled', status_order: STATUS_ORDER.Cancelled, notes: updatedNotes, is_read: true })
        .eq('booking_id', booking.booking_id);
      if (updateError) throw updateError;

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
      await supabase.from('booking_equipment').delete().eq('booking_id', booking.booking_id).eq('returned', false);
      await supabase.from('vehicle_assign').delete().eq('booking_id', booking.booking_id).neq('assignment_status', 'Completed');

      if (shouldRefund && refundAmountValue > 0) {
        const { error: refundError } = await supabase
          .from('payment')
          .insert([{
            booking_id: booking.booking_id,
            amount_paid: -refundAmountValue,
            pay_method: 'Refund',
            pay_status: 'Refunded',
            pay_datetime: new Date().toISOString(),
            pay_proof: proofUrl,
            customer_id: booking.customer_id,
            remarks: refundRemarks || 'Refund processed',
          }]);
        // The booking is ALREADY cancelled by this point, and its equipment and
        // vehicles are already released. Rethrowing sent the manager a "Failed
        // to cancel" message for a cancellation that had in fact gone through,
        // so they would retry something they could not repeat and never learn
        // that the refund was the part that failed.
        if (refundError) {
          console.error('Refund insert failed after cancellation:', refundError);
          setIsCancelModalOpen(false);
          fetchData();
          toast.error(
            `The ${noun} was cancelled, but the ₱${refundAmountValue.toLocaleString()} refund could not be recorded. Record it from the Payments page — do not cancel again.`,
            { duration: 10000 }
          );
          return;
        }
      }

      setIsCancelModalOpen(false);
      fetchData();
      toast.success(`${noun === 'order' ? 'Order' : 'Booking'} cancelled. ${refundNote}`);
    } catch (error) {
      console.error('Cancellation error:', error);
      toast.error(error.message || `Failed to cancel ${noun}.`);
    } finally {
      setIsCancelling(false);
    }
  };

  return {
    isCancelModalOpen,
    setIsCancelModalOpen,
    cancelReason,
    setCancelReason,
    refundAmount,
    setRefundAmount,
    refundRemarks,
    setRefundRemarks,
    refundFile,
    setRefundFile,
    isCancelling,
    openCancelModal,
    handleCancelBooking,
  };
}