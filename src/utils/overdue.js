// src/utils/overdue.js
//
// How a past-due booking looks and reads, in one place, because the Bookings
// page and the Short Orders page both show it and a manager comparing the two
// must not see two different treatments of the same fact.
//
// WHAT IS OVERDUE IS NOT DECIDED HERE. `is_overdue` and `days_overdue` come
// from v_booking_money: Confirmed or Completed, event already served, balance
// remaining. Nothing in this file recomputes that, and nothing in a page
// should either — an event that has "already happened" depends on the server's
// clock and the booking's timezone, and a second definition in the client
// would drift from the one Receivables and Reports are built on.
//
// The treatment is deliberately three signals at once (tint, colour, chip):
// colour alone fails a colour-blind manager and fails a projector, which is
// where this page gets shown.

// The whole row. Light enough to read through, and it must beat both the
// hover background and any striping, so it is applied last in the class list.
export const OVERDUE_ROW_CLASS = 'bg-rose-50 hover:bg-rose-100/70';

// The stronger edge on the first cell — the signal that survives a monochrome
// print or projector.
export const OVERDUE_EDGE_CLASS = 'border-l-[4px] border-l-rose-500';

// The balance itself, in the danger colour.
export const OVERDUE_AMOUNT_CLASS = 'text-rose-700 font-semibold';

/**
 * The chip's text, with the age.
 *
 * `days_overdue` is 0 for an event served earlier today, which is genuinely
 * past due — the service happened and the balance did not follow it. "0 days"
 * reads like a rounding artefact, so that case is named instead.
 */
export function overdueChipLabel(daysOverdue) {
  const days = Number(daysOverdue) || 0;
  if (days <= 0) return 'Overdue · today';
  return `Overdue · ${days} ${days === 1 ? 'day' : 'days'}`;
}

export const OVERDUE_CHIP_CLASS =
  'inline-flex items-center px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-200 text-[11px] font-bold whitespace-nowrap';

export const FLAGGED_CHIP_CLASS =
  'inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-bold whitespace-nowrap';

/**
 * The tooltip beside a balance that has money claimed but not yet verified.
 * No figure in it on purpose: the balance is the number on the row, and a
 * second amount in a tooltip is a second number to reconcile.
 */
export const AWAITING_VERIFICATION_HINT = 'Payment awaiting verification';
