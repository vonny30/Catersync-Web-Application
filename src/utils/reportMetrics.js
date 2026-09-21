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
//   pay_datetime    when the money arrived        -> f_report_period, in the
//                                                    database: cash_receipts
//   event_datetime  when the work is delivered    -> getEventPeriodTotals
//
// The pay_datetime side no longer lives here. getPaymentsReceived was removed
// on 21 Sep 2026 once its last caller went: the Dashboard, Receivables and
// Reports all read f_report_period, so no screen sums a ledger in the browser
// any more.
//
// A payment only counts once a manager has verified it: Pending Verification and
// Proof Rejected rows are claims, not funds. That rule lives in utils/payments
// and is imported rather than restated.
import { movesBooks } from './payments';

// A booking in one of these statuses is dead: no future work, no receivable.
// Money already taken against it is handled separately — see below.
export const CANCELLED_BOOKING_STATUSES = ['Rejected', 'Cancelled'];

export const isCancelledBooking = (status) => CANCELLED_BOOKING_STATUSES.includes(status);

// Panel, 29 May 2026 (Förster): "Only confirmed & completed bookings should
// count as part of revenue — collectables/payables must not yet be included."
//
// A verified payment against a booking the manager has not confirmed yet is
// real cash, but the event is not locked in. It is reported on its own line
// rather than in the headline or nowhere.
export const REVENUE_BOOKING_STATUSES = ['Confirmed', 'Completed'];

export const countsTowardRevenue = (status) => REVENUE_BOOKING_STATUSES.includes(status);


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
    if (!ids.has(p.booking_id) || !movesBooks(p)) return;
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
