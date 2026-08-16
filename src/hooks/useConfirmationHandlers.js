// src/hooks/useConfirmationHandlers.js
//
// Manual "Confirm Event" action: Approved -> Confirmed. Requires at least
// 50% (or full) of the total to be paid AND verified first — this is a
// deliberate manual step, not automatic, so the manager decides when an
// event is truly locked in. Cancellation only becomes available once a
// booking reaches Confirmed.
import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { sumVerifiedPositivePayments } from '../utils/payments';

export function useConfirmationHandlers({ booking, payments, fetchData }) {
  const { showConfirm } = useConfirm();
  const [isConfirming, setIsConfirming] = useState(false);

  const canConfirmBooking = booking?.booking_status === 'Approved';

  const handleConfirmBooking = async () => {
    if (!booking) return;
    const totalAmount = booking.total_amount || 0;
    const paid = sumVerifiedPositivePayments(payments);
    const required = totalAmount * 0.5;

    if (paid < required) {
      toast.error(`Needs at least 50% paid and verified before this can be confirmed (₱${paid.toLocaleString()} of ₱${required.toLocaleString()} required).`);
      return;
    }

    const isFullyPaid = paid >= totalAmount;
    const confirmed = await showConfirm({
      title: 'Confirm This Event?',
      message: `This booking has ${isFullyPaid ? 'been paid in full' : 'a verified downpayment of at least 50%'} (₱${paid.toLocaleString()} of ₱${totalAmount.toLocaleString()}). Marking it Confirmed locks the event in — cancellation only becomes available after this point. Continue?`,
      confirmLabel: 'Yes, Confirm Event',
      cancelLabel: 'Cancel',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    setIsConfirming(true);
    try {
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Confirmed' })
        .eq('booking_id', booking.booking_id);
      if (error) throw error;
      toast.success('Event confirmed!');
      fetchData();
    } catch (error) {
      console.error(error);
      toast.error('Failed to confirm booking.');
    } finally {
      setIsConfirming(false);
    }
  };

  return { canConfirmBooking, isConfirming, handleConfirmBooking };
}
