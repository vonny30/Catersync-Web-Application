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
