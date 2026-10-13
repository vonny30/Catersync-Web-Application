// src/utils/completion.js
//
// When a Confirmed booking or order may be marked Completed — one rule for the
// list pages, the detail pages and the completion handlers, so a button that
// looks ready is never refused on click (and a refused one shows why first).
//
//   1. The event must have happened. Completing marks the equipment returned
//      and closes the vehicle runs, which would free them for other bookings
//      on the event day.
//   2. The balance must be settled — except on an installment plan, where the
//      remaining installments stay receivable after completion (spec R11,
//      the same rule the database applies to the Operations Manager app).

const fmtDate = (dt) => new Date(dt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const isPlan = (paymentPlan) => paymentPlan === 'Installment';

/** True while the event is still ahead. */
export const eventNotYetHappened = (eventDatetime) => !!eventDatetime && new Date(eventDatetime) > new Date();

/**
 * Why Complete is locked, or null when it may be pressed.
 * @param owed         the balance still due (0 when settled)
 * @param paymentPlan  the booking's payment_plan; on 'Installment' the balance is ignored
 */
export function completeLockReason({ eventDatetime, owed, paymentPlan }) {
  if (eventNotYetHappened(eventDatetime)) return `Locked — the event is on ${fmtDate(eventDatetime)}`;
  if (!isPlan(paymentPlan) && Number(owed) > 0) return `Locked — ₱${Number(owed).toLocaleString()} balance due`;
  return null;
}

/** True when the balance stops Complete (never on an installment plan). */
export const balanceBlocksCompletion = ({ owed, paymentPlan }) => !isPlan(paymentPlan) && Number(owed) > 0;

/** The message shown when Complete is pressed before the event. */
export const completeBeforeEventMessage = (noun, eventDatetime) =>
  `Can't mark this ${noun} as completed before its event on ${fmtDate(eventDatetime)}.`;

/**
 * The "Mark as Completed?" confirm text. A plan booking with money still owed
 * says that it stays receivable; everything else reads as it always has.
 */
export function completeConfirmMessage(noun, { owed, paymentPlan }) {
  if (isPlan(paymentPlan) && Number(owed) > 0) {
    return `Are you sure you want to mark this ${noun} as completed?\n\n₱${Number(owed).toLocaleString()} in installments will stay receivable.`;
  }
  return `Are you sure you want to mark this ${noun} as completed?\n\n✅ All payments are settled.`;
}
