// src/utils/vehicle.js
//
// Vehicles are unit-based, not stock-based — each row in `vehicle` is one
// physical car/motorcycle, assigned whole to a single booking at a time via
// `vehicle_assign`. There's no quantity/capacity column the way `equipment`
// has, so "availability" here means "is this specific vehicle free or
// assigned on this date", not a committed/free unit count.
import { supabase } from '../supabase';
import { ACTIVE_BOOKING_STATUSES } from './bookingStatus';

/**
 * Full per-vehicle availability snapshot for a single calendar date — powers
 * the Vehicles page's date-based "Availability" view. For every vehicle in
 * the fleet, reports whether it's free or already dispatched to an event on
 * that date (and to which one), plus the list of events happening that day.
 *
 * A vehicle whose base `vehicle_status` is Maintenance/Unavailable is
 * reported as such regardless of assignment — that's a fleet-condition
 * override, not a date-scoped fact.
 *
 * Returns:
 *   {
 *     vehicles: [{ vehicle_id, plate_number, vehicle_type, vehicle_status,
 *                   assignment: { assignment_id, booking_id, booking_type,
 *                     ref, customerName, venue, event_datetime,
 *                     dispatch_datetime } | null }],
 *     eventsOnDate: [{ booking_id, ref, customerName, venue, event_datetime,
 *                       pax_count, booking_type }]
 *   }
 */
export const getDailyVehicleSnapshot = async (dateStr) => {
  if (!dateStr) return { vehicles: [], eventsOnDate: [] };

  const startOfDay = new Date(dateStr);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(dateStr);
  endOfDay.setHours(23, 59, 59, 999);

  const { data: fleet, error: fleetError } = await supabase
    .from('vehicle')
    .select('vehicle_id, plate_number, vehicle_type, vehicle_status')
    .order('plate_number');
  if (fleetError) throw fleetError;

  // Vehicles serve both Package bookings and Short Orders — no booking_type
  // filter here, unlike equipment which is Package-only.
  const { data: bookings, error: bookingError } = await supabase
    .from('booking')
    .select(`
      booking_id, booking_number, booking_type, venue, event_datetime, pax_count,
      customer:customer_id (first_name, last_name)
    `)
    .in('booking_status', ACTIVE_BOOKING_STATUSES)
    .gte('event_datetime', startOfDay.toISOString())
    .lte('event_datetime', endOfDay.toISOString());
  if (bookingError) throw bookingError;

  const refFor = (b) => b.booking_number || `${b.booking_type === 'Short Order' ? 'SO' : 'BKG'}-${b.booking_id.slice(0, 8)}`;
  const nameFor = (b) => b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';

  const eventsOnDate = (bookings || []).map(b => ({
    booking_id: b.booking_id,
    ref: refFor(b),
    customerName: nameFor(b),
    venue: b.venue,
    event_datetime: b.event_datetime,
    pax_count: b.pax_count,
    booking_type: b.booking_type,
  }));

  if (!bookings || bookings.length === 0) {
    return {
      vehicles: (fleet || []).map(v => ({ ...v, assignment: null })),
      eventsOnDate: [],
    };
  }

  const bookingIds = bookings.map(b => b.booking_id);
  const bookingMap = Object.fromEntries(bookings.map(b => [b.booking_id, b]));

  const { data: assigns, error: assignError } = await supabase
    .from('vehicle_assign')
    .select('assignment_id, vehicle_id, booking_id, dispatch_datetime, assignment_status')
    .in('booking_id', bookingIds)
    .neq('assignment_status', 'Completed');
  if (assignError) throw assignError;

  const assignByVehicle = {};
  (assigns || []).forEach(a => {
    const b = bookingMap[a.booking_id];
    if (!b) return;
    assignByVehicle[a.vehicle_id] = {
      assignment_id: a.assignment_id,
      booking_id: b.booking_id,
      booking_type: b.booking_type,
      ref: refFor(b),
      customerName: nameFor(b),
      venue: b.venue,
      event_datetime: b.event_datetime,
      dispatch_datetime: a.dispatch_datetime,
    };
  });

  const vehicles = (fleet || []).map(v => ({
    ...v,
    assignment: assignByVehicle[v.vehicle_id] || null,
  }));

  return { vehicles, eventsOnDate };
};
