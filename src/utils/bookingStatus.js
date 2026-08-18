// src/utils/bookingStatus.js
//
// Full booking lifecycle: Pending -> Approved -> Confirmed -> Completed,
// with Rejected/Cancelled as terminal branches. "Confirmed" means the
// event is genuinely locked in — the manager approved it AND at least a
// 50% (or full) verified payment came through, so it's manually marked
// Confirmed. Everywhere equipment/vehicle/day-schedule logic needs to know
// "is this event really going to happen" (not just a pending inquiry, and
// not yet completed/rejected/cancelled), it should treat Approved and
// Confirmed the same way — use this constant instead of checking
// 'Approved' alone, or a newly-Confirmed booking will silently drop out of
// those checks.
export const ACTIVE_BOOKING_STATUSES = ['Approved', 'Confirmed'];

// Business rule: the kitchen can only handle 4 Short Orders on any one
// calendar day. This caps how many Short Orders can be Approved/Confirmed
// (i.e. ACTIVE_BOOKING_STATUSES) for the same event date — enforced as a
// hard block at approval time, not just a soft warning.
export const MAX_SHORT_ORDERS_PER_DAY = 4;

// Editing structural fields (total_amount, pax_count, package, event date,
// etc.) on a booking/order after real payment history exists would silently
// desync the record from the payments already made against it — the fee
// adjustments this system supports happen once, during Approval, on
// purpose. Reuses the same locked-status set as the payment ledger
// (isPaymentLedgerLocked in ../utils/payments) since it's the same
// underlying concern: Confirmed means a verified payment already came
// through, and Completed/Cancelled/Rejected are downstream/terminal states
// where the record is settled history, not something to keep editing.
// Deleting the whole record is intentionally NOT gated by this — that's a
// deliberate, all-or-nothing action (password-confirmed) rather than a
// partial edit that could leave totals inconsistent with payments made.
export function bookingEditLockedMessage(status, { noun = 'booking' } = {}) {
  return `This ${noun} can't be edited anymore — it's ${status}, and changing details now would conflict with the payment history already on record.`;
}
