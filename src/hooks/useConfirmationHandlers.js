// src/hooks/useConfirmationHandlers.js
//
// Manual "Confirm Event" action: Approved -> Confirmed. Requires at least
// 50% (or full) of the total to be paid AND verified first — this is a
// deliberate manual step, not automatic, so the manager decides when an
// event is truly locked in. Cancellation only becomes available once a
// booking reaches Confirmed.
//
// The rule, the dialog copy and the write now live in utils/confirmBooking.js
// so the Payments page's verify -> confirm chain can reach the same behaviour
// without a fourth copy of it.
import { useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import { statusWriteErrorMessage } from '../utils/lapsed';
import { useConfirm } from '../contexts/ConfirmContext';
import { sumVerifiedPositivePayments } from '../utils/payments';
import {
  getConfirmEligibility,
  underpaidMessage,
  buildConfirmDialog,
  applyConfirmation,
} from '../utils/confirmBooking';

export function useConfirmationHandlers({ booking, payments, fetchData }) {
  const { showConfirm } = useConfirm();
  const [isConfirming, setIsConfirming] = useState(false);

  const canConfirmBooking = booking?.booking_status === 'Approved';

  /**
   * @param options.paidOverride
   *   The verified total to test against, when the caller knows one this hook
   *   cannot yet see.
   *
   *   This exists for the verify -> confirm chain and nothing else. In the
   *   moment just after a payment is verified, the `payments` prop still holds
   *   the PRE-verification rows — fetchData() has been called but has not
   *   returned — so `sumVerifiedPositivePayments` would not count the payment
   *   the manager just verified, and this would refuse with "Needs at least 50%
   *   paid and verified" about that very payment. The verifier already computed
   *   the new total, so it passes it in rather than making this guess.
   *
   * @param options.silentIfIneligible
   *   On the chained path the prompt is offered, not requested: a booking that
   *   cannot be confirmed yet should simply not raise a dialog. On the button
   *   path the manager asked, so they get told why.
   *
   * @param options.fromVerification  changes the dialog copy only.
   */
  const promptToConfirm = async ({
    paidOverride,
    silentIfIneligible = false,
    fromVerification = false,
  } = {}) => {
    if (!booking) return false;

    // Test the booking's CURRENT state, not the one this page was holding
    // before the receipt was written. A database trigger
    // (trg_confirm_on_payment) promotes Approved -> Confirmed the moment a
    // verified receipt reaches half the contracted amount, so by the time this
    // runs the row may already be Confirmed — and offering to confirm an
    // already-confirmed booking is exactly the stale dialog this avoids. If
    // the read fails, fall back to the prop: a stale offer beats no offer.
    const { data: fresh, error: freshError } = await supabase
      .from('v_booking_money')
      .select('booking_id, booking_number, booking_type, booking_status, total_amount, verified_paid')
      .eq('booking_id', booking.booking_id)
      .maybeSingle();
    if (freshError) console.error('Could not re-read the booking before confirming:', freshError);
    const current = fresh || booking;

    // paidOverride still wins: on the verify -> confirm chain the caller knows
    // a total this hook cannot see. Otherwise prefer the freshly read
    // verified_paid over the `payments` prop, which is one fetch behind.
    const paid = paidOverride != null
      ? paidOverride
      : (fresh ? Number(fresh.verified_paid) || 0 : sumVerifiedPositivePayments(payments));
    const eligibility = getConfirmEligibility(current, paid);

    if (!eligibility.eligible) {
      if (silentIfIneligible) return false;
      if (eligibility.reason === 'underpaid') {
        toast.error(underpaidMessage(eligibility.paid, eligibility.required));
      } else if (eligibility.reason === 'not-approved' && current.booking_status !== booking.booking_status) {
        // The manager pressed the button against a status this page no longer
        // holds — the trigger got there first. Not a failure; say what it is
        // and refresh so the button disappears.
        toast(`Already ${current.booking_status}.`);
        fetchData();
      }
      return false;
    }

    const confirmed = await showConfirm(
      buildConfirmDialog(current, eligibility, { fromVerification })
    );
    if (!confirmed) return false;

    setIsConfirming(true);
    try {
      await applyConfirmation(current.booking_id);
      toast.success('Booking confirmed.');
      fetchData();
      return true;
    } catch (error) {
      console.error(error);
      // Includes the lapsed guard: a booking whose event passed while this
      // page was open cannot be confirmed, and the database says so in a
      // sentence written for the manager.
      toast.error(statusWriteErrorMessage(error, 'Failed to confirm booking.'), { duration: 8000 });
      return false;
    } finally {
      setIsConfirming(false);
    }
  };

  // The Confirm Event button. Unchanged behaviour: the manager asked, so an
  // ineligible booking explains itself rather than doing nothing.
  const handleConfirmBooking = () => promptToConfirm();

  return { canConfirmBooking, isConfirming, handleConfirmBooking, promptToConfirm };
}
