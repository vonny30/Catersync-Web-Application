// src/utils/reportMetrics.js
//
// The booking-status lists the money definitions are built on, and one date
// helper. Nothing here adds money up any more.
//
// This file used to hold the money definitions themselves, because three pages
// answered "how much money came in?" three different ways and presented all
// three as the same figure. Those definitions now live in the database, where
// every page reads the same row: f_report_period for the period figures,
// v_booking_money for each booking. getPaymentsReceived (cash, by payment date)
// and getEventPeriodTotals (contracted work, by service date) were both removed
// on 21 Sep 2026 once their last callers went — the Dashboard, Receivables and
// Reports all read f_report_period, so no screen sums a ledger in the browser.
//
// If a money figure is ever needed that f_report_period does not provide, add
// it to the function, not back here.

// A booking in one of these statuses is dead: no future work, no receivable.
export const CANCELLED_BOOKING_STATUSES = ['Rejected', 'Cancelled'];

export const isCancelledBooking = (status) => CANCELLED_BOOKING_STATUSES.includes(status);

// Panel, 29 May 2026 (Förster): "Only confirmed & completed bookings should
// count as part of revenue — collectables/payables must not yet be included."
//
// The same rule is counts_toward_revenue in v_booking_money; this list is the
// client's copy of it, for code that needs the statuses by name.
export const REVENUE_BOOKING_STATUSES = ['Confirmed', 'Completed'];

export const countsTowardRevenue = (status) => REVENUE_BOOKING_STATUSES.includes(status);

// Duplicated from pages/Reports/helpers.js on purpose, for now: a util reaching
// up into a page's helpers would be backwards. Collapse the two into this one
// when Reports' helpers are next touched.
export function isWithinRange(dateValue, start, end) {
  if (!dateValue) return false;
  const d = new Date(dateValue);
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

// The cancellation policy's cut-off, in days before the event. Same number
// useCancellationHandlers and useRejectionHandlers apply when they decide what
// may be refunded.
export const REFUND_CUTOFF_DAYS = 3;

/**
 * The money a cancelled or rejected booking has EARNED the business: its
 * deposit, and only when that deposit was forfeited — the booking closed less
 * than REFUND_CUTOFF_DAYS before the event. Closed earlier than that, the
 * deposit is refundable: it is owed back, not earned, even while no refund has
 * been recorded yet (BKG-129, cancelled 8 days out, was being counted as
 * revenue).
 *
 * Kept is the deposit, capped at what is actually still held (net_paid):
 * anything paid beyond the deposit is refundable excess whatever the timing.
 *
 * closedAt comes from booking.closed_at. Bookings closed before that column was
 * written (BKG-104, BKG-107) have none; they are treated as forfeited, which is
 * what their own cancellation notes record. With no event date the deadline
 * cannot be measured, and the handlers treat that as refundable — so does this.
 */
export function keptOnClosedBooking({ eventDatetime, closedAt, netPaid, deposit }) {
  const net = Math.max(0, Number(netPaid) || 0);
  if (net <= 0 || !eventDatetime) return 0;
  if (closedAt) {
    const daysBefore = Math.ceil((new Date(eventDatetime) - new Date(closedAt)) / 86400000);
    if (daysBefore >= REFUND_CUTOFF_DAYS) return 0;
  }
  const dep = Number(deposit) || 0;
  return dep > 0 ? Math.min(net, dep) : net;
}

/**
 * COLLECTIBLE for a period — one rule for the Payments page and the Customers
 * page, so the two cards cannot disagree. The v_booking_money rows that count
 * toward revenue (Confirmed + Completed) with an event in the period; the
 * figure is their `outstanding`. start/end null = all time.
 */
export function collectibleInPeriod(moneyRows, start, end) {
  const rows = (moneyRows || []).filter(m => m.counts_toward_revenue
    && ((!start && !end) || isWithinRange(m.event_datetime, start, end)));
  const total = rows.reduce((sum, m) => sum + (Number(m.outstanding) || 0), 0);
  const owing = rows
    .filter(m => Number(m.outstanding) > 0)
    .sort((a, b) => Number(b.outstanding) - Number(a.outstanding));
  const byCustomer = {};
  owing.forEach(m => { byCustomer[m.customer_id] = (byCustomer[m.customer_id] || 0) + Number(m.outstanding); });
  return { rows, total, owing, byCustomer };
}
