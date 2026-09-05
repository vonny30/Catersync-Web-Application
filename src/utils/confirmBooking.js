// src/utils/confirmBooking.js
//
// The "Confirm Event" rule, in one place.
//
// Approved -> Confirmed requires at least 50% of the total paid AND verified.
// It is a deliberate manual step: the manager decides when an event is truly
// locked in, and cancellation only becomes available once a booking reaches
// Confirmed.
//
// This was implemented three times — useConfirmationHandlers.js,
// Bookings.jsx and ShortOrders.jsx — before the verify -> confirm chain needed
// a fourth caller on the Payments page. Three copies of a money rule is how
// this codebase ended up with three drifting versions of the completion
// filter, so the rule moved here instead of being pasted again.
//
// The two list-page copies are NOT yet using this. They are unchanged and
// still correct; folding them in is a separate change with its own review.
import { supabase } from '../supabase';
import { STATUS_ORDER } from './bookingStatus';

// At least half the contract, verified, before an event is locked in.
export const CONFIRM_PAID_FRACTION = 0.5;

/**
 * May this booking be confirmed, given what has actually been verified?
 *
 * `paid` is passed in rather than derived, because the caller that matters most
 * — the verify -> confirm chain — knows a total this module cannot yet see.
 * See the note on `paidOverride` in useConfirmationHandlers.
 */
export function getConfirmEligibility(booking, paid) {
  if (!booking) return { eligible: false, reason: 'missing' };
  if (booking.booking_status !== 'Approved') {
    return { eligible: false, reason: 'not-approved' };
  }
  const totalAmount = booking.total_amount || 0;
  const required = totalAmount * CONFIRM_PAID_FRACTION;
  if (paid < required) {
    return { eligible: false, reason: 'underpaid', paid, required, totalAmount };
  }
  return { eligible: true, paid, required, totalAmount, isFullyPaid: paid >= totalAmount };
}

export function underpaidMessage(paid, required) {
  return `Needs at least 50% paid and verified before this can be confirmed (₱${paid.toLocaleString()} of ₱${required.toLocaleString()} required).`;
}

/**
 * The dialog copy. Kept beside the rule so the warning cannot drift from the
 * behaviour it warns about.
 *
 * The equipment sentence is the reason this dialog must never be skipped to
 * save a click: confirming freezes equipment allocation, and a manager who
 * reached here from verifying a payment has had no other chance to be told.
 */
export function buildConfirmDialog(booking, { paid, totalAmount, isFullyPaid }, { fromVerification = false } = {}) {
  const noun = booking.booking_type === 'Short Order' ? 'order' : 'booking';
  const equipmentWarning = booking.booking_type !== 'Short Order'
    ? ' Equipment assignments will also be locked — no more adding, editing, or removing equipment after this.'
    : '';
  // Said only on the chained path, where the manager did not choose to be here
  // and needs to know why a dialog appeared on its own.
  const lead = fromVerification
    ? `That payment is verified, so this ${noun} can now be confirmed. `
    : '';
  const paidClause = isFullyPaid ? 'been paid in full' : 'a verified downpayment of at least 50%';
  return {
    title: 'Confirm This Event?',
    message: `${lead}This ${noun} has ${paidClause} (₱${paid.toLocaleString()} of ₱${totalAmount.toLocaleString()}). Marking it Confirmed locks the event in — cancellation only becomes available after this point.${equipmentWarning} Continue?`,
    confirmLabel: 'Yes, Confirm Event',
    // The chained path is offered rather than requested, so its dismissal is
    // "not now", not "cancel the thing I asked for".
    cancelLabel: fromVerification ? 'Not Yet' : 'Cancel',
    confirmVariant: 'success',
  };
}

/**
 * The write. `status_order` is set explicitly even though a database trigger
 * now sets it too — see utils/bookingStatus.js for why that belt-and-braces is
 * deliberate rather than redundant.
 */
export async function applyConfirmation(bookingId) {
  const { error } = await supabase
    .from('booking')
    .update({ booking_status: 'Confirmed', status_order: STATUS_ORDER.Confirmed, is_read: true })
    .eq('booking_id', bookingId);
  if (error) throw error;
}
