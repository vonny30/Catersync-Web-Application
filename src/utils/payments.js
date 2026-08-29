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

// Payments the customer has submitted that a manager has not ruled on yet.
//
// Recording a manual payment while one of these is outstanding is how the same
// money gets counted twice: the manager enters the transfer they can see in the
// bank, then later verifies the customer's proof of that same transfer, and the
// booking now shows both. Verification has to come first — it is the step that
// decides whether that money exists at all.
//
// 'Proof Rejected' is deliberately NOT included: it has already been ruled on,
// and it is never going to become money.
export function getPaymentsAwaitingVerification(payments) {
  return (payments || []).filter(p => p.pay_status === 'Pending Verification');
}

// Sum of confirmed Downpayment-status payments.
export function sumVerifiedDownpayments(payments) {
  return (payments || [])
    .filter(p => p.pay_status === 'Downpayment' && p.amount_paid > 0)
    .reduce((sum, p) => sum + p.amount_paid, 0);
}

// A booking in any of these statuses is treated as settled/closed for
// editing purposes — Confirmed and Completed hold real revenue history, and
// Cancelled/Rejected already went through their own refund workflow (which
// records a new negative payment row rather than mutating the original).
// Payments themselves are never editable or deletable regardless of booking
// status (a recorded payment already went through manual entry or mobile
// proof verification); this flag instead gates whether the BOOKING record
// and its equipment assignments can still be edited.
export const PAYMENT_LOCKED_STATUSES = ['Confirmed', 'Completed', 'Cancelled', 'Rejected'];

export function isPaymentLedgerLocked(bookingStatus) {
  return PAYMENT_LOCKED_STATUSES.includes(bookingStatus);
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
