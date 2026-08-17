// src/utils/availability.js
//
// Shows a manager reviewing a Pending booking/order what else is already
// approved on that same calendar day, so they can judge whether the date
// and time actually work before approving — not just whether equipment
// is free.
import { supabase } from '../supabase';
import { ACTIVE_BOOKING_STATUSES } from './bookingStatus';

// How close two events need to be (in hours) before we call it out as a
// likely time conflict rather than just "same day". There's no explicit
// event-duration field in the schema, so this is a reasonable heuristic,
// not a hard overlap calculation.
const CLOSE_TIME_WINDOW_HOURS = 3;

/**
 * Returns every Approved or Confirmed booking on the same calendar day as
 * eventDate, sorted by time, excluding excludeBookingId. When bookingType
 * is given, only events of that same type (Package or Short Order) are
 * returned — Package bookings and Short Orders are tracked as separate
 * lines of business here, so a manager reviewing one shouldn't be shown
 * the other's schedule.
 * Each item also gets `hoursApart` (vs. referenceTime, if provided) and
 * `isCloseInTime` so callers can flag likely time conflicts.
 */
export async function getBookingsOnDate(eventDate, excludeBookingId = null, referenceTime = null, bookingType = null) {
  if (!eventDate) return [];

  const startOfDay = new Date(eventDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(eventDate);
  endOfDay.setHours(23, 59, 59, 999);

  let query = supabase
    .from('booking')
    .select(`
      booking_id,
      booking_type,
      venue,
      event_datetime,
      pax_count,
      customer:customer_id (first_name, last_name)
    `)
    .in('booking_status', ACTIVE_BOOKING_STATUSES)
    .gte('event_datetime', startOfDay.toISOString())
    .lte('event_datetime', endOfDay.toISOString())
    .order('event_datetime', { ascending: true });

  if (excludeBookingId) {
    query = query.neq('booking_id', excludeBookingId);
  }
  if (bookingType) {
    query = query.eq('booking_type', bookingType);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to check day availability: ${error.message}`, { cause: error });

  const refTime = referenceTime ? new Date(referenceTime).getTime() : null;

  return (data || []).map(b => {
    const hoursApart = refTime !== null && b.event_datetime
      ? Math.abs(new Date(b.event_datetime).getTime() - refTime) / (1000 * 60 * 60)
      : null;
    return {
      ...b,
      customerName: b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown',
      hoursApart,
      isCloseInTime: hoursApart !== null && hoursApart < CLOSE_TIME_WINDOW_HOURS,
    };
  });
}
