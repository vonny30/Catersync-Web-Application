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
