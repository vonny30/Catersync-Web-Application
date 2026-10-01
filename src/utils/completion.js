// src/utils/completion.js
//
// When a Confirmed booking or order may be marked Completed — one rule for the
// list pages, the detail pages and the completion handlers, so a button that
// looks ready is never refused on click (and a refused one shows why first).
//
//   1. The event must have happened. Completing marks the equipment returned
//      and closes the vehicle runs, which would free them for other bookings
//      on the event day.
//   2. The balance must be settled.

const fmtDate = (dt) => new Date(dt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

/** True while the event is still ahead. */
export const eventNotYetHappened = (eventDatetime) => !!eventDatetime && new Date(eventDatetime) > new Date();

/**
 * Why Complete is locked, or null when it may be pressed.
 * @param owed  the balance still due (0 when settled)
 */
export function completeLockReason({ eventDatetime, owed }) {
  if (eventNotYetHappened(eventDatetime)) return `Locked — the event is on ${fmtDate(eventDatetime)}`;
  if (Number(owed) > 0) return `Locked — ₱${Number(owed).toLocaleString()} balance due`;
  return null;
}

/** The message shown when Complete is pressed before the event. */
export const completeBeforeEventMessage = (noun, eventDatetime) =>
  `Can't mark this ${noun} as completed before its event on ${fmtDate(eventDatetime)}.`;
