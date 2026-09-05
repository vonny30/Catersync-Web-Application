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

// The `booking.status_order` DB column drives the Bookings/ShortOrders list
// pages' primary sort (Pending first, then Approved, Confirmed, Completed,
// Cancelled, Rejected, with newest-created first inside each group) — it
// exists because PostgREST can't ORDER BY an arbitrary CASE expression, so
// this needs a real column.
//
// IT *IS* MAINTAINED BY THE DATABASE, AND THE DATABASE IS WRONG.
// Corrected 5 Sep 2026; this comment previously said the opposite.
//
//   CREATE TRIGGER set_status_order BEFORE INSERT OR UPDATE OF booking_status
//     ON public.booking FOR EACH ROW EXECUTE FUNCTION update_status_order()
//
// `update_status_order` writes a mapping that predates the Confirmed status:
//
//   Pending 1 · Approved 2 · Completed 3 · Cancelled 4 · Rejected 5
//   Confirmed -> falls through to ELSE -> 5
//
// It disagrees with the map below on four of six values, and it overwrites
// whatever the app supplies, on every insert and on every update that touches
// booking_status. So each write path here still has to set status_order — the
// trigger is not doing the job — but setting it in the SAME statement that
// changes booking_status is useless, because the trigger fires after and wins.
//
// The self-heal below works only because its UPDATE touches status_order
// alone: the trigger is scoped to UPDATE OF booking_status and does not fire.
// That is load-bearing. Do not fold the repair into a status change.
//
// The real fix is to correct the trigger function to match this map, or to
// drop it. Until then the drift returns after every status change and is only
// cleaned up on the next list load.
export const STATUS_ORDER = {
  Pending: 1,
  Approved: 2,
  Confirmed: 3,
  Completed: 4,
  Rejected: 5,
  Cancelled: 6,
};

// `status_order` duplicates information already in `booking_status`, and
// nothing in the database keeps the two in step — so they drift, and when
// they do the list silently sorts a row into the wrong group. It has already
// happened: three Confirmed bookings carried status_order 5 (Rejected's
// slot) and a Cancelled one carried 4 (Completed's), which is why Confirmed
// and Cancelled rows appeared interleaved with Rejected and Completed.
//
// The cause was found on 5 Sep 2026 and it is the `set_status_order` trigger
// described above, not stale rows and not the mobile app. Those two figures
// are the trigger's mapping exactly: it sends Confirmed to 5 through its ELSE
// branch and Cancelled to 4. Every booking inserted through any client gets
// them, including this one — a freshly seeded database reproduced it on all
// 13 rows at once.
//
// Given that, the list can't assume the column is right. This returns the
// rows whose status_order contradicts their status, so a caller can repair
// them. booking_status is the authority; status_order is only ever derived.
export function findStatusOrderDrift(rows) {
  return (rows || [])
    .filter(r => r?.booking_id
      && STATUS_ORDER[r.booking_status] !== undefined
      && r.status_order !== STATUS_ORDER[r.booking_status])
    .map(r => ({
      booking_id: r.booking_id,
      booking_status: r.booking_status,
      was: r.status_order,
      status_order: STATUS_ORDER[r.booking_status],
    }));
}

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
