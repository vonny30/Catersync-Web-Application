// src/hooks/useCompletionHandlers.js
//
// Manual "Mark as Completed" action: Confirmed -> Completed. Only allowed
// once the booking/order is fully paid — completing it with money still
// owed would bury an unpaid balance behind a "done" status, so that path
// is blocked outright rather than offered as an override. (Past-due,
// still-unpaid Confirmed records instead get flagged in the UI — see
// hasUnpaidPastEvent in ../utils/autoComplete — and get auto-completed on
// their own once they're paid; see autoCompletePastEvents in the same
// file.) Shared by the Bookings/ShortOrders list pages and their Details
// pages so the action and its side effects — equipment returned, vehicle
// assignments closed out, payments set Fully Paid — are identical
// everywhere it appears.
import { useState } from 'react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { sumVerifiedPositivePayments } from '../utils/payments';

export function useCompletionHandlers({ booking, payments, fetchData, noun = 'booking' }) {
  const { showConfirm } = useConfirm();
  const [isCompleting, setIsCompleting] = useState(false);

  const totalAmount = booking?.total_amount || 0;
  const totalPaid = sumVerifiedPositivePayments(payments);
  const remainingBalance = Math.max(0, totalAmount - totalPaid);
  const isFullyPaid = remainingBalance <= 0;

  const canMarkCompleted = booking?.booking_status === 'Confirmed';

  const handleMarkCompleted = async () => {
    if (!booking) return;

    if (!isFullyPaid) {
      toast.error(`Can't mark this ${noun} as completed — ₱${remainingBalance.toLocaleString()} is still owed. Full payment is required first.`);
      return;
    }

    const confirmed = await showConfirm({
      title: 'Mark as Completed?',
      message: `Are you sure you want to mark this ${noun} as completed?\n\n✅ All payments are settled.`,
      confirmLabel: 'Complete',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    setIsCompleting(true);
    try {
      const { error } = await supabase
        .from('booking')
        .update({ booking_status: 'Completed', is_read: true })
        .eq('booking_id', booking.booking_id);
      if (error) throw error;

      const { error: equipReturnError } = await supabase
        .from('booking_equipment')
        .update({ returned: true, returned_at: new Date().toISOString() })
        .eq('booking_id', booking.booking_id);
      if (equipReturnError) throw equipReturnError;

      const { error: vehicleReturnError } = await supabase
        .from('vehicle_assign')
        .update({ assignment_status: 'Completed' })
        .eq('booking_id', booking.booking_id);
      if (vehicleReturnError) throw vehicleReturnError;

      if (totalPaid > 0) {
        const { error: updatePaymentsError } = await supabase
          .from('payment')
          .update({ pay_status: 'Fully Paid' })
          .eq('booking_id', booking.booking_id);
        if (updatePaymentsError) throw updatePaymentsError;
      }
      toast.success(`${noun[0].toUpperCase()}${noun.slice(1)} marked completed. All payments set to Fully Paid.`);

      fetchData();
    } catch (error) {
      console.error(error);
      toast.error(`Failed to mark ${noun} as completed.`);
    } finally {
      setIsCompleting(false);
    }
  };

  return { canMarkCompleted, isFullyPaid, remainingBalance, isCompleting, handleMarkCompleted };
}
