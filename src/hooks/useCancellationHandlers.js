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
      let isRefundable = false;
      let daysUntilEvent = 999;

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
        if (positivePayments > 0 && !isRefundable) {
          refundNote = `Client cancelled within ${daysUntilEvent} days (< 3 days). Downpayment of ₱${totalDownpayment.toLocaleString()} is non-refundable per policy.`;
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

      // Cleanup
      await supabase.from('booking_equipment').delete().eq('booking_id', booking.booking_id);
      await supabase.from('vehicle_assign').delete().eq('booking_id', booking.booking_id);

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
        if (refundError) throw refundError;
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