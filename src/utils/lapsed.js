// src/utils/lapsed.js
//
// A booking request whose event date passed while it was still waiting for a
// decision has LAPSED. There is nothing left to accept: the service cannot be
// performed on a date that has gone, so agreeing to it would create a contract
// that was impossible to perform from the moment it was made.
//
// WHAT IS LAPSED IS NOT DECIDED HERE. `is_lapsed` comes from v_booking_money —
// Pending or Approved, with the event already past. The database also refuses
// the write (trg_block_lapsed_acceptance), so this file is about telling the
// manager before they click, never about being the rule.
//
// LAPSED IS NOT OVERDUE, AND MUST NOT LOOK LIKE IT.
//   Overdue  = money at risk on work that happened. Rose/red. Act on it.
//   Lapsed   = a dead request that was never accepted. Neutral grey. Close it.
// A manager who sees one treatment for both learns to skim past both, and the
// ₱550,000 request going stale is exactly what this is here to prevent. The
// greys below are deliberately the quietest chip on the page.

export const LAPSED_CHIP_CLASS =
  'inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-300 text-[11px] font-bold whitespace-nowrap';

/** `Lapsed · 18 Sep` — the date is the event's, which is the fact that killed it. */
export function lapsedChipLabel(eventDatetime) {
  if (!eventDatetime) return 'Lapsed';
  const d = new Date(eventDatetime);
  if (Number.isNaN(d.getTime())) return 'Lapsed';
  return `Lapsed · ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}

/** On the disabled Approve / Confirm control. */
export const LAPSED_ACCEPT_TOOLTIP = 'Event date has passed';

/**
 * Pre-filled into the rejection reason, and editable there. Declining stays
 * available on purpose: a customer's request is answered by a person, not
 * discarded silently.
 */
export const LAPSED_DECLINE_REASON = 'Event date passed before it was accepted.';

/** Said in the override dialog, which is the one path that may still accept it. */
export const LAPSED_OVERRIDE_WARNING = 'Event date has passed';

// PostgreSQL check_violation. The lapsed guard raises it with a message
// written for the manager to read, naming the booking and its event date.
export const CHECK_VIOLATION_CODE = '23514';

/**
 * The message to show for a failed status write.
 *
 * A disabled button is not a guarantee: a booking can lapse while the list is
 * open, and this app has two other writers (the customer app, the Operations
 * Manager app). When the database refuses the write it explains why in
 * language meant for a person, so that sentence is shown instead of a generic
 * failure. Anything else falls back to the caller's own wording.
 */
export function statusWriteErrorMessage(error, fallback) {
  if (error?.code === CHECK_VIOLATION_CODE && error?.message) return error.message;
  return fallback;
}
