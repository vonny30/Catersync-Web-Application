// src/utils/resourceLock.js
//
// When a booking's equipment and vehicles can be changed.
//
// This used to borrow isPaymentLedgerLocked from utils/payments, which is a
// money rule: a booking's total must not be recomputed once money is against
// it. Equipment allocation has nothing to do with the payment ledger — the two
// just wanted the same status list on the day it was written, and the result
// was that allocation froze at Confirmed, exactly when a caterer finds out
// what the event really needs.
//
// Equipment and vehicles can be changed right up to the event. They are
// physical logistics, not the money ledger: a caterer who discovers on
// Friday that Saturday needs four more chafing dishes must be able to say so.
//
// Pending is locked for a different reason: approval is what allocates. A
// Pending booking has nothing allocated yet, and anything assigned by hand
// before approval would be duplicated when approval allocates the template.
export const RESOURCE_LOCKED_STATUSES = ['Pending', 'Completed', 'Cancelled', 'Rejected'];

// A LAPSED booking is locked too, whatever its status. The database treats a
// booking whose event date passed before it was accepted as holding nothing
// live (lapsed_bookings_hold_nothing_live): its equipment and vehicle rows
// neither commit stock nor fall overdue. The page must not then offer to change
// what it holds — that is the mirror-the-guard rule. `lapsed` is read from
// v_booking_money.is_lapsed by the caller; this file never works it out.
//
// Status stays the first argument so every existing caller keeps its meaning.
export function isResourceLocked(bookingStatus, { lapsed = false } = {}) {
  return lapsed || RESOURCE_LOCKED_STATUSES.includes(bookingStatus);
}

// Why the lock applies, for the tooltip or toast. `resource` picks the wording:
// 'equipment' (the default) or 'vehicles'.
export function resourceLockReason(bookingStatus, resource = 'equipment', { lapsed = false } = {}) {
  if (lapsed) return 'Event date has passed';
  if (resource === 'vehicles') {
    if (bookingStatus === 'Pending') return 'Vehicles are assigned once this booking is approved.';
    if (bookingStatus === 'Completed') return 'This event is finished. Its trips are part of the dispatch history now.';
    if (bookingStatus === 'Cancelled' || bookingStatus === 'Rejected') {
      return `This booking is ${bookingStatus}, so there is nothing to dispatch.`;
    }
    return null;
  }
  if (bookingStatus === 'Pending') {
    return 'Equipment is allocated when this booking is approved. Approve it first.';
  }
  if (bookingStatus === 'Completed') {
    return 'This event is finished and its equipment has been returned. Changing the allocation now would rewrite the return record.';
  }
  if (bookingStatus === 'Cancelled' || bookingStatus === 'Rejected') {
    return `This booking is ${bookingStatus} and its equipment has been released back to stock.`;
  }
  return null;
}
