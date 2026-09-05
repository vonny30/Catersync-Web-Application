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
    const paid = paidOverride != null ? paidOverride : sumVerifiedPositivePayments(payments);
    const eligibility = getConfirmEligibility(booking, paid);

    if (!eligibility.eligible) {
      if (silentIfIneligible) return false;
      if (eligibility.reason === 'underpaid') {
        toast.error(underpaidMessage(eligibility.paid, eligibility.required));
      }
      return false;
    }

    const confirmed = await showConfirm(
      buildConfirmDialog(booking, eligibility, { fromVerification })
    );
    if (!confirmed) return false;

    setIsConfirming(true);
    try {
      await applyConfirmation(booking.booking_id);
      toast.success('Booking confirmed.');
      fetchData();
      return true;
    } catch (error) {
      console.error(error);
      toast.error('Failed to confirm booking.');
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
