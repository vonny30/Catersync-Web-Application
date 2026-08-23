// src/utils/payments.js
//
// A payment row can exist in a "not yet confirmed" state — submitted by
// the customer and awaiting manager review (Pending Verification), or
// reviewed and turned down (Proof Rejected). Until a manager verifies it,
// that money isn't counted as actually collected: the booking's paid
// total / remaining balance / downpayment status should all behave as if
// it hasn't happened yet.
export const UNVERIFIED_PAY_STATUSES = ['Pending Verification', 'Proof Rejected'];

export function isUnverifiedPayment(payment) {
  return UNVERIFIED_PAY_STATUSES.includes(payment?.pay_status);
}

// Sum of confirmed, positive payments only (excludes refunds and
// not-yet-verified/rejected rows).
export function sumVerifiedPositivePayments(payments) {
  return (payments || [])
    .filter(p => p.amount_paid > 0 && !isUnverifiedPayment(p))
    .reduce((sum, p) => sum + p.amount_paid, 0);
}

// Sum of confirmed Downpayment-status payments.
export function sumVerifiedDownpayments(payments) {
  return (payments || [])
    .filter(p => p.pay_status === 'Downpayment' && p.amount_paid > 0)
    .reduce((sum, p) => sum + p.amount_paid, 0);
}

// A booking in any of these statuses has a payment ledger that other parts
// of the system treat as settled/closed — Confirmed and Completed hold real
// revenue history, and Cancelled/Rejected already went through their own
// refund workflow (which records a new negative payment row rather than
// mutating the original). Editing or deleting a payment row after that point
// would corrupt totals, reports, and refund records that already reflect it.
export const PAYMENT_LOCKED_STATUSES = ['Confirmed', 'Completed', 'Cancelled', 'Rejected'];

export function isPaymentLedgerLocked(bookingStatus) {
  return PAYMENT_LOCKED_STATUSES.includes(bookingStatus);
}

// Explains *why* in a way that fits both a toast and an inline tooltip.
export function paymentLockedMessage(bookingStatus, { noun = 'booking' } = {}) {
  const subject = `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
  if (bookingStatus === 'Cancelled' || bookingStatus === 'Rejected') {
    return `Payments can't be edited or deleted once ${subject} is ${bookingStatus} — any refund is recorded as its own entry instead.`;
  }
  return `Payments can't be edited or deleted once ${subject} is ${bookingStatus}.`;
}

// The three words a manager actually uses for a payment, derived rather than
// stored.
//
// `pay_status` only ever holds 'Downpayment' or 'Fully Paid' (plus the two
// unverified states), and the schema is read-only, so it cannot gain a third
// value. But "Downpayment" is only true of the FIRST payment against a
// booking — calling the third one a downpayment is simply wrong, and that is
// the distinction the panel asked for. The middle case is a partial payment:
// money in, balance still outstanding, but not the initial deposit.
//
// Display only. Nothing here is ever written back, and the Payments page's
// status tabs still filter on the stored value.
//
// `priorVerifiedPayments` is every OTHER verified payment on the same booking
// — the caller decides what "other" means (usually: exclude this payment_id).
export function describePaymentKind(payment, priorVerifiedPayments, bookingTotal) {
  if (!payment) return '';
  if (isUnverifiedPayment(payment)) return payment.pay_status;
  // A refund is money going out; it is not a kind of payment at all.
  if ((payment.amount_paid || 0) < 0) return 'Refund';

  const priorPaid = sumVerifiedPositivePayments(priorVerifiedPayments);
  const total = bookingTotal || 0;
  const clearsBalance = total > 0 && (priorPaid + (payment.amount_paid || 0)) >= total;

  if (clearsBalance) return 'Fully Paid';
  // Nothing verified before this one, so this is the deposit that secured it.
  if (priorPaid <= 0) return 'Downpayment';
  return 'Partial payment';
}
