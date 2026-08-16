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
