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

// ---------------------------------------------------------------------------
// THE VOCABULARY. Every stored pay_status and entry_type the web app writes or
// compares comes from here — never typed as a string at the call site. The
// database CHECK constraint allows exactly:
//   Pending Verification · Proof Rejected · Deposit Collected ·
//   Partially Settled · Fully Settled · Refunded · Reversed
// and refuses anything else, including the retired 'Downpayment' and
// 'Fully Paid'.
//
// Deposit Collected -> Partially Settled -> Fully Settled is a timeline: each
// receipt stores the stage it reached WHEN IT WAS RECORDED. It is history, so
// nothing relabels it later (completing a booking does not turn a deposit into
// "Fully Settled" — whether the account is settled is a question for
// v_booking_money, not for an old receipt's label).
// ---------------------------------------------------------------------------
export const RECEIPT_STAGES = {
  deposit: 'Deposit Collected',
  partial: 'Partially Settled',
  settled: 'Fully Settled',
};
export const RECEIPT_STAGE_ORDER = [RECEIPT_STAGES.deposit, RECEIPT_STAGES.partial, RECEIPT_STAGES.settled];
export const PENDING_VERIFICATION = 'Pending Verification';
export const PROOF_REJECTED = 'Proof Rejected';
export const REFUNDED_STATUS = 'Refunded';
export const REVERSED_STATUS = 'Reversed';
export const ENTRY_TYPES = { receipt: 'Receipt', refund: 'Refund', reversal: 'Reversal' };

export const isReceiptStage = (status) => RECEIPT_STAGE_ORDER.includes(status);

// Pill colours for a stored status, one map for every page.
export const PAY_STATUS_PILL = {
  [RECEIPT_STAGES.deposit]: 'bg-amber-50 text-amber-700 border-amber-200',
  [RECEIPT_STAGES.partial]: 'bg-blue-50 text-blue-700 border-blue-200',
  [RECEIPT_STAGES.settled]: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  [PENDING_VERIFICATION]: 'bg-orange-50 text-orange-700 border-orange-200',
  [PROOF_REJECTED]: 'bg-red-50 text-red-700 border-red-200',
  [REFUNDED_STATUS]: 'bg-red-50 text-red-700 border-red-200',
  [REVERSED_STATUS]: 'bg-slate-100 text-slate-600 border-slate-200',
};
export const payStatusPillClass = (status) => PAY_STATUS_PILL[status] || 'bg-slate-100 text-slate-600 border-slate-200';

export const isReversalEntry = (payment) => payment?.entry_type === ENTRY_TYPES.reversal;
// A refund is money going back out. A reversal is also negative, but it is a
// correction, not money moving — never list or sum the two together.
export const isRefundEntry = (payment) => (payment?.amount_paid || 0) < 0 && !isReversalEntry(payment);

/**
 * How one ledger row reads in a table: its stored stage, or — when it has been
 * reversed, or is itself the reversal — that fact instead. `is_reversed` comes
 * from v_payment_ledger.
 */
export function ledgerEntryBadge(payment) {
  if (isReversalEntry(payment)) {
    return { label: 'Reversal', className: payStatusPillClass(REVERSED_STATUS), struck: false, note: payment.reversal_reason || '' };
  }
  if (payment?.is_reversed) {
    return { label: REVERSED_STATUS, className: payStatusPillClass(REVERSED_STATUS), struck: true, note: '' };
  }
  return { label: payment?.pay_status || '—', className: payStatusPillClass(payment?.pay_status), struck: false, note: '' };
}

// Does this entry move the books?
//
// The answer is v_payment_ledger.counts_in_ledger — verified, not a reversal,
// and not itself reversed. It is READ from the view, never re-derived here: a
// page that needs money figures reads its rows from v_payment_ledger.
//
// The fallback is for rows read straight from the `payment` table, which do not
// carry the column. Only the Reports page still does that (its own brief moves
// it); for those rows this keeps the rule they have always had, which cannot
// see reversals. It is deliberately not extended.
export function movesBooks(payment) {
  if (typeof payment?.counts_in_ledger === 'boolean') return payment.counts_in_ledger;
  return !isUnverifiedPayment(payment);
}

// Sum of entries that move the books and are positive (receipts; excludes
// refunds, unverified claims, reversals and reversed entries).
export function sumVerifiedPositivePayments(payments) {
  return (payments || [])
    .filter(p => (p.amount_paid || 0) > 0 && movesBooks(p))
    .reduce((sum, p) => sum + Number(p.amount_paid), 0);
}

/**
 * The stage a new receipt reaches, from the money already in.
 *
 *   covers what is left  -> Fully Settled
 *   first receipt         -> Deposit Collected
 *   otherwise             -> Partially Settled
 *
 * `priorPaid` is the receipts already counted on the booking (not this one).
 * Chosen by the system; the manager never picks an accounting stage by hand.
 */
export function stageForReceipt({ priorPaid, amount, total }) {
  const prior = Number(priorPaid) || 0;
  const value = Number(amount) || 0;
  const owed = Number(total) || 0;
  if (owed > 0 && prior + value >= owed - 0.005) return RECEIPT_STAGES.settled;
  if (prior <= 0) return RECEIPT_STAGES.deposit;
  return RECEIPT_STAGES.partial;
}

/**
 * Re-derive the stage of every counted receipt on one booking, in the order
 * they were received, against a (new) total. Used only where the TOTAL itself
 * changes — approval can add fees — so "was this the one that settled it" has a
 * different answer than when the receipts were recorded.
 *
 * @returns [{ payment_id, pay_status }] for the receipts whose stage differs.
 */
export function restageReceipts(entries, total) {
  const receipts = (entries || [])
    .filter(p => (p.amount_paid || 0) > 0 && movesBooks(p) && isReceiptStage(p.pay_status))
    .sort((a, b) => new Date(a.pay_datetime || 0) - new Date(b.pay_datetime || 0)
      || String(a.payment_id).localeCompare(String(b.payment_id)));
  let prior = 0;
  const changes = [];
  for (const r of receipts) {
    const stage = stageForReceipt({ priorPaid: prior, amount: r.amount_paid, total });
    if (stage !== r.pay_status) changes.push({ payment_id: r.payment_id, pay_status: stage });
    prior += Number(r.amount_paid) || 0;
  }
  return changes;
}

export const RECEIPT_METHODS = ['Cash', 'GCash', 'Bank Transfer'];
// Cash handed over the counter has a paper receipt; GCash and bank transfers
// have a digital trail. The form asks for the one that exists.
export const methodNeedsReceiptNumber = (method) => method === 'Cash';
export const CASH_RECEIPT_MESSAGE = 'Enter the number on the receipt you issued.';
export const PROOF_IMAGE_MESSAGE = 'Please upload a proof of payment image.';
export const REFUND_METHOD_MESSAGE = 'Choose how the refund was paid back.';

/**
 * Every rule a new receipt must pass, in one place, for both receipt forms
 * (the Receivables page and the booking detail pages).
 *
 * @returns { ok: true, stage } or { ok: false, field: 'amount'|'receipt'|'file'|'form', message }
 */
export function validateReceipt({ amount, method, receiptReference, hasImage, priorPaid, total }) {
  const value = Number(amount) || 0;
  const owed = Number(total) || 0;
  const prior = Number(priorPaid) || 0;
  if (value <= 0) return { ok: false, field: 'amount', message: 'Amount must be greater than zero.' };
  if (!RECEIPT_METHODS.includes(method)) return { ok: false, field: 'form', message: 'Please select a payment method.' };
  const remaining = Math.max(0, owed - prior);
  if (owed > 0 && remaining <= 0) {
    return { ok: false, field: 'amount', message: 'This booking is already fully settled. No further receipts are allowed.' };
  }
  if (owed > 0 && value > remaining + 0.005) {
    return { ok: false, field: 'amount', message: `Amount exceeds the remaining balance of ₱${remaining.toLocaleString()}.` };
  }
  // The deposit that secures a booking: at least half, on the first receipt.
  if (prior <= 0 && owed > 0 && value < owed * 0.5 - 0.005) {
    return { ok: false, field: 'amount', message: `The first receipt must be at least 50% of the total (₱${(owed * 0.5).toLocaleString()}).` };
  }
  if (methodNeedsReceiptNumber(method)) {
    if (!String(receiptReference || '').trim()) return { ok: false, field: 'receipt', message: CASH_RECEIPT_MESSAGE };
  } else if (!hasImage) {
    return { ok: false, field: 'file', message: PROOF_IMAGE_MESSAGE };
  }
  return { ok: true, stage: stageForReceipt({ priorPaid: prior, amount: value, total: owed }) };
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
  return (payments || []).filter(p => p.pay_status === PENDING_VERIFICATION);
}

// The deposit: counted receipts stored as Deposit Collected. This is the money
// the cancellation policy forfeits within 3 days of the event.
export function sumDepositsCollected(payments) {
  return (payments || [])
    .filter(p => p.pay_status === RECEIPT_STAGES.deposit && (p.amount_paid || 0) > 0 && movesBooks(p))
    .reduce((sum, p) => sum + Number(p.amount_paid), 0);
}

// A booking in any of these statuses is treated as settled/closed for
// editing purposes — Confirmed and Completed hold real revenue history, and
// Cancelled/Rejected already went through their own refund workflow (which
// records a new negative payment row rather than mutating the original).
// Payments themselves are never editable or deletable regardless of booking
// status (a recorded payment already went through manual entry or mobile
// proof verification); this flag instead gates whether the BOOKING record
// and its equipment assignments can still be edited.
// ---------------------------------------------------------------------------
// EDITING WOULD LOSE MONEY
// ---------------------------------------------------------------------------
//
// Approval can add money a later edit cannot put back. It folds extraQuantity,
// extraDeliveryFee and additionalFee into `total_amount`, and `Approved` is not
// in PAYMENT_LOCKED_STATUSES, so the record stays editable. Both edit forms
// recompute the total from package/menu plus delivery fee — which cannot see
// those additions — so opening the modal and saving wrote the lower number
// back and the adjustment was gone.
//
// There is no column recording the adjustment, and no schema change to add
// one, so it is detected from the money itself: recompute the total the way the
// edit form would, and compare. A stored total HIGHER than the recomputation
// means value is present that recomputation cannot reproduce.
//
// This deliberately catches more than approval fees. A menu price that has
// dropped since the booking was taken produces the same shape — recomputing
// would lower the total — and locking is the right answer there too. The
// message therefore states what was actually detected (saving would reduce the
// total) rather than asserting a cause.
//
// Tolerance is a peso: totals are rounded to two decimals, so anything smaller
// is float noise rather than money.
export const ADJUSTMENT_TOLERANCE = 1;

/**
 * How much value would be lost by saving a recomputed total.
 * @returns the shortfall in pesos, or 0 when saving is safe.
 */
export function totalLossOnRecompute(storedTotal, recomputedTotal) {
  const stored = Number(storedTotal) || 0;
  const recomputed = Number(recomputedTotal) || 0;
  const diff = stored - recomputed;
  return diff > ADJUSTMENT_TOLERANCE ? diff : 0;
}

const peso = (n) => `₱${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------
// CARRYING AN ADJUSTMENT THROUGH AN EDIT
//
// The lock above refuses the edit outright. The alternative, used by the
// Bookings list, lets the edit happen and carries the adjustment with it: an
// approval fee is a fixed amount on top of the package, so it stays that amount
// whatever the pax count or package becomes.
//
//   carried  = stored total − base, measured ONCE when the form opens, from the
//              booking as saved. Never recomputed while the form changes: the
//              total field is derived from it, so recomputing it from the form
//              would chase its own tail.
//   new total = new base + carried
//
// Carried is never negative. A stored total BELOW the base is not a discount —
// approval clamps every adjustment to >= 0 — it is a package price that rose
// after the booking was taken. Carrying that difference would invent money, so
// it carries zero and the total rises to the new base as it always has.
//
// These take plain base amounts, not packages or menus, so a short order can
// call them with its menu-based base exactly as a package booking does.
// ---------------------------------------------------------------------------

/** The adjustment to carry: the same arithmetic as totalLossOnRecompute. */
export function carriedAdjustment(storedTotal, baseAtOpen) {
  return totalLossOnRecompute(storedTotal, baseAtOpen);
}

/** The total an edited booking should carry: its new base plus the adjustment. */
export function totalWithCarried(newBase, carried) {
  return Math.round(((Number(newBase) || 0) + (Number(carried) || 0)) * 100) / 100;
}

/**
 * How far a total about to be saved falls below new base + carried.
 * @returns the shortfall in pesos, or 0 when the save keeps the adjustment.
 */
export function carriedTotalShortfall(totalToSave, requiredTotal) {
  const diff = (Number(requiredTotal) || 0) - (Number(totalToSave) || 0);
  return diff > ADJUSTMENT_TOLERANCE ? diff : 0;
}

export function carriedTotalShortfallMessage(totalToSave, requiredTotal, carried, { noun = 'booking' } = {}) {
  return `This ${noun} wasn't saved — its total would be ${peso(totalToSave)}, but the package and guests come to ${peso(requiredTotal - carried)} plus ${peso(carried)} in fees added at approval, which is ${peso(requiredTotal)}. Close the form and open it again, then retry.`;
}

export function totalLossLockedMessage(storedTotal, recomputedTotal, { noun = 'booking' } = {}) {
  return `This ${noun} can't be edited — its total (${peso(storedTotal)}) is higher than the package and menu it is built from (${peso(recomputedTotal)}), usually because a fee was added at approval. Saving would recalculate it down to ${peso(recomputedTotal)} and lose the difference. Record a refund or a new payment instead.`;
}

export const PAYMENT_LOCKED_STATUSES = ['Confirmed', 'Completed', 'Cancelled', 'Rejected'];

export function isPaymentLedgerLocked(bookingStatus) {
  return PAYMENT_LOCKED_STATUSES.includes(bookingStatus);
}

// The money sentence in every delete-confirmation dialog.
//
// This existed four times — two list pages, two detail pages — and every copy
// read "N payment records totalling ₱X", which is arithmetic the numbers do
// not support. The count is every payment row on the booking; the total is
// only the VERIFIED, POSITIVE ones. A booking with two verified payments of
// ₱2,500 and one still awaiting verification announced "3 payment records
// totalling ₱5,000", and a manager who added up the rows in front of them got
// ₱7,500. The same gap opens on a refunded booking, where a negative row is
// counted but never summed.
//
// Both figures are worth stating — the rows are what gets destroyed, the
// verified total is what leaves the reports — so the fix is to stop claiming
// they are the same figure. "including" makes the total a subset of the rows
// rather than their sum, which is exactly what it is.
//
// Returns '' when there is nothing to warn about, so callers can append it
// unconditionally.
export function formatPaymentDeletionWarning(rowCount, verifiedTotal, { tail = '' } = {}) {
  if (!rowCount) return '';

  const plural = rowCount !== 1;
  const records = `This will also delete ${rowCount} payment record${plural ? 's' : ''}`;
  const money = verifiedTotal > 0
    ? `, including ₱${verifiedTotal.toLocaleString()} in verified payments. That money will disappear from every report.`
    // Nothing verified means nothing to remove from the reports, and saying
    // "₱0" invites the reading that the records are worthless. They are still
    // the customer's submitted proof, and they are still being destroyed.
    : `. No verified money is attached, so no reported figure changes — but the record${plural ? 's themselves are' : ' itself is'} gone.`;

  return `\n\n${records}${money}${tail ? ` ${tail}` : ''}`;
}
