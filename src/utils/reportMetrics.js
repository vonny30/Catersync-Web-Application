// src/utils/reportMetrics.js
//
// The money definitions, in one place.
//
// Three pages used to answer "how much money came in?" three different ways and
// present all three as the same figure:
//
//   Dashboard  every verified payment dated this month, any booking
//   Payments   every verified payment ever, active bookings, no date filter
//   Reports    verified payments on bookings whose EVENT fell in the range
//
// Those are not three attempts at one number — they are three different
// questions, and only the first is a cash figure at all. The fix is not to make
// them agree by accident but to name each one for the question it answers and
// compute it here, so a fourth interpretation can't appear on a fourth screen.
//
// The anchor date is what separates them:
//
//   pay_datetime    when the money arrived        -> getPaymentsReceived
//   event_datetime  when the work is delivered    -> getEventPeriodTotals
//
// A payment only counts once a manager has verified it: Pending Verification and
// Proof Rejected rows are claims, not funds. That rule lives in utils/payments
// and is imported rather than restated.
import { isUnverifiedPayment } from './payments';

// A booking in one of these statuses is dead: no future work, no receivable.
// Money already taken against it is handled separately — see below.
export const CANCELLED_BOOKING_STATUSES = ['Rejected', 'Cancelled'];

export const isCancelledBooking = (status) => CANCELLED_BOOKING_STATUSES.includes(status);

// Payments carry their booking either nested (Payments.jsx selects
// `booking:booking_id (booking_status)`) or via a lookup the caller builds from
// a separate query (Reports fetches bookings and payments as two lists). Accept
// both rather than forcing every caller into one query shape.
const bookingStatusOf = (payment, bookingStatusById) => (
  bookingStatusById
    ? bookingStatusById[payment.booking_id]
    : payment.booking?.booking_status
);

// Duplicated from pages/Reports/helpers.js on purpose, for now: this module is
// imported by Dashboard and Payments, and a util reaching up into a page's
// helpers would be backwards. Collapse the two into this one when Reports'
// helpers are next touched.
export function isWithinRange(dateValue, start, end) {
  if (!dateValue) return false;
  const d = new Date(dateValue);
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

/**
 * Cash received in a period, anchored on pay_datetime.
 *
 * Returns the split rather than a single total, because a forfeited downpayment
 * is real money that belongs in neither of the obvious buckets. When a booking
 * is cancelled inside the 3-day window the downpayment is kept; when it is
 * cancelled earlier the refund is recorded as its own negative payment row and
 * nets the pair to zero. Rolling that into "Total Collections" would overstate
 * live business; dropping it would hide money that is genuinely in the bank. So
 * it gets its own line and the caller decides how to show it.
 *
 * `paymentsReceived + retainedFromCancellations === totalCashIn`, always.
 *
 * @param payments  payment rows, each with amount_paid, pay_datetime, pay_status
 * @param options.start / options.end   period bounds; omit both for all time
 * @param options.bookingStatusById     optional { [booking_id]: booking_status }
 */
export function getPaymentsReceived(payments, { start, end, bookingStatusById } = {}) {
  const counted = (payments || []).filter(p => (
    !isUnverifiedPayment(p) &&
    (!start && !end ? true : isWithinRange(p.pay_datetime, start, end))
  ));

  const activeRows = [];
  const cancelledRows = [];
  counted.forEach(p => {
    (isCancelledBooking(bookingStatusOf(p, bookingStatusById)) ? cancelledRows : activeRows).push(p);
  });

  // Refunds are negative amount_paid rows, so a plain sum is already net.
  const sum = rows => rows.reduce((total, p) => total + (p.amount_paid || 0), 0);
  const refundsIssued = counted
    .filter(p => (p.amount_paid || 0) < 0)
    .reduce((total, p) => total + Math.abs(p.amount_paid), 0);

  const paymentsReceived = sum(activeRows);
  const retainedFromCancellations = sum(cancelledRows);

  // The refunds actually deducted from `paymentsReceived` — which is NOT
  // `refundsIssued`.
  //
  // `refundsIssued` counts every refund in the period, including refunds on
  // Rejected/Cancelled bookings. Those rows are in `cancelledRows`, so they
  // reduce `retainedFromCancellations` and never touch `paymentsReceived`. And
  // a refund is most often issued precisely BECAUSE a booking was cancelled,
  // so the two figures diverge in exactly the common case. Quoting
  // `refundsIssued` beside `paymentsReceived` claims a deduction that was
  // never made.
  //
  // This lived inline in Reports/index.jsx with that warning attached. It is
  // here now because Payments.jsx needed the same number and copying the
  // reduce would have made it two figures that can drift apart.
  const refundsNettedAgainstReceived = activeRows
    .filter(p => (p.amount_paid || 0) < 0)
    .reduce((total, p) => total + Math.abs(p.amount_paid), 0);

  return {
    paymentsReceived,
    retainedFromCancellations,
    totalCashIn: paymentsReceived + retainedFromCancellations,
    refundsIssued,
    refundsNettedAgainstReceived,
    activeRows,
    cancelledRows,
    countedRows: counted,
  };
}

/**
 * The event-anchored trio, for bookings whose EVENT falls in the period.
 *
 * This is not a cash figure and must not be labelled as one. It answers "of the
 * events happening in this period, how much are they worth and how much has been
 * paid against them?" — which is why the three tie together:
 *
 *   contractValue - paidAgainstEvents = outstandingBalance
 *
 * Payments are counted whenever they were made, including before the period
 * started, because a deposit taken in August against a December wedding is money
 * paid against a December event.
 */
export function getEventPeriodTotals(bookings, payments, { start, end } = {}) {
  const inPeriod = (bookings || []).filter(b => (
    !isCancelledBooking(b.booking_status) &&
    (!start && !end ? true : isWithinRange(b.event_datetime, start, end))
  ));
  const ids = new Set(inPeriod.map(b => b.booking_id));

  const paidByBooking = {};
  (payments || []).forEach(p => {
    if (!ids.has(p.booking_id) || isUnverifiedPayment(p)) return;
    paidByBooking[p.booking_id] = (paidByBooking[p.booking_id] || 0) + (p.amount_paid || 0);
  });

  let contractValue = 0, paidAgainstEvents = 0, outstandingBalance = 0;
  inPeriod.forEach(b => {
    const total = b.total_amount || 0;
    const paid = paidByBooking[b.booking_id] || 0;
    contractValue += total;
    paidAgainstEvents += paid;
    outstandingBalance += Math.max(0, total - paid);
  });

  return { contractValue, paidAgainstEvents, outstandingBalance, bookings: inPeriod, paidByBooking };
}
