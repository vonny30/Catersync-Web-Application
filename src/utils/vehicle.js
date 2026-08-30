// src/utils/vehicle.js
//
// Vehicles are unit-based, not stock-based — each row in `vehicle` is one
// physical car/motorcycle, so there is no quantity column the way `equipment`
// has. What makes a vehicle exclusive is not the DAY, though: it is the TRIP.
//
// PG's Catering runs three vehicles and handles several bookings on one date -
// including two events starting at the same hour - which works because a van
// delivers, sets up, and leaves. It is not parked at the venue all afternoon.
// This module owns the two ideas that make that expressible:
//
//     A dispatch occupies a vehicle for a trip window, not for a day.
//     When one van serves two events, the one approved first is set up first.
//
// Everything else here — the daily snapshot, the conflict test — is built on
// getDispatchWindow. See docs/blueprint-03-dispatch.md.
import { supabase } from '../supabase';
import { ACTIVE_BOOKING_STATUSES } from './bookingStatus';
import { fetchAllRows } from './fetchAllRows';

// --- Trip types -------------------------------------------------------------
//
// Display names, derived from booking_type. Nothing is stored: the schema is
// read-only, and booking_type already carries the distinction the business
// makes. A short order is a delivery run; a package is an event set-up.
export const TRIP_TYPE = {
  eventSetup: 'Event setup',
  delivery: 'Delivery',
};

export const getTripType = (booking) =>
  booking?.booking_type === 'Short Order' ? TRIP_TYPE.delivery : TRIP_TYPE.eventSetup;

// --- How long a vehicle is actually tied up ---------------------------------
//
// CORRECTED 28 Aug 2026, by Vaughn: a vehicle does NOT sit at the venue through
// the event. It travels, unloads, sets up, and leaves. That is the whole reason
// one van can serve two events starting at the same hour - it finishes the
// first setup, hops to the second venue, and finishes that one too, both before
// either event begins. Modelling the van as parked at the venue for five hours
// made that impossible and was wrong.
//
// A booking therefore produces TWO trips, not one:
//
//   Setup run    leaves base, travels, unloads and sets up. Must FINISH by the
//                event start. Then the vehicle is free.
//   Pickup run   goes back after the event to collect the equipment. Starts a
//                grace period after the event begins - the same 3 hours the
//                page already uses to decide when a return may be recorded, so
//                the two rules cannot drift apart.
//
// A delivery (short order) has no pickup: nothing is left behind to collect.
//
// These numbers ARE the model. They live in one place so they can be calibrated
// with PG's rather than buried in a comparison somewhere.
export const TRIP_PROFILE = {
  [TRIP_TYPE.eventSetup]: {
    travelHours: 1,        // base -> venue
    setupHours: 1.5,       // unload and set up on site
    teardownHours: 1,      // load out again after the event
    hasPickup: true,
  },
  [TRIP_TYPE.delivery]: {
    travelHours: 0.5,
    setupHours: 0.25,      // hand over and go
    teardownHours: 0,
    hasPickup: false,
  },
};

// Venue to venue, when one vehicle does two setups back to back. Shorter than
// a return to base, because it does not go back to base.
export const HOP_HOURS = 0.75;

// Base to base: unloading, refuelling, getting out again. Used when two trips
// are unrelated rather than chained.
export const TURNAROUND_HOURS = 1;

// How long after an event starts before the vehicle can collect. Matches
// RETURN_GRACE_MS in Vehicles.jsx - one rule, stated twice only because the
// page needs it for its button state.
export const PICKUP_GRACE_HOURS = 3;

export const TRIP_LEG = { setup: 'Setup', pickup: 'Pickup' };

const HOUR_MS = 60 * 60 * 1000;

// Every date in this module arrives as either a Date or a Postgres timestamp
// string, and an unparseable one must become null rather than an Invalid Date
// that silently poisons every comparison it touches.
const asDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * The span of time one dispatch takes a vehicle out of the fleet.
 *
 * Which leg this is - setup or pickup - is DERIVED, not stored: a dispatch
 * timed at or after the event start is a pickup, anything earlier is a setup.
 * That is the whole trick that lets one booking hold two trips without a new
 * column. `vehicle_assign` keeps exactly the shape it has.
 *
 *   Setup   [dispatch, dispatch + travel + setup]. The default dispatch is
 *           set so the setup FINISHES at the event start, never later.
 *   Pickup  [event + PICKUP_GRACE_HOURS, + teardown + travel].
 *
 * Returns null when there is no event date to anchor to - the caller has to
 * decide what an unanchored assignment means rather than silently getting a
 * window that spans nothing.
 */
export function getDispatchWindow(assignment, booking) {
  const event = asDate(booking?.event_datetime);
  if (!event) return null;

  const type = getTripType(booking);
  const profile = TRIP_PROFILE[type] || TRIP_PROFILE[TRIP_TYPE.eventSetup];
  const dispatch = asDate(assignment?.dispatch_datetime);

  const isPickup = !!dispatch && dispatch >= event;

  if (isPickup) {
    const start = dispatch;
    const end = new Date(start.getTime() + (profile.teardownHours + profile.travelHours) * HOUR_MS);
    return { start, end, type, leg: TRIP_LEG.pickup };
  }

  const workHours = profile.travelHours + profile.setupHours;
  // No stored dispatch time (rows saved before dispatch times were captured):
  // fall back to the latest departure that still finishes on time.
  const start = dispatch || new Date(event.getTime() - workHours * HOUR_MS);
  const end = new Date(start.getTime() + workHours * HOUR_MS);
  return { start, end, type, leg: TRIP_LEG.setup };
}

/**
 * When a vehicle should leave base so its setup finishes exactly as the event
 * starts - the default the planner and the Assign modal both suggest.
 */
export function defaultSetupDispatch(booking) {
  const event = asDate(booking?.event_datetime);
  if (!event) return null;
  const profile = TRIP_PROFILE[getTripType(booking)] || TRIP_PROFILE[TRIP_TYPE.eventSetup];
  return new Date(event.getTime() - (profile.travelHours + profile.setupHours) * HOUR_MS);
}

/** When the vehicle goes back for the equipment, or null if nothing is left. */
export function defaultPickupDispatch(booking) {
  const event = asDate(booking?.event_datetime);
  if (!event) return null;
  const profile = TRIP_PROFILE[getTripType(booking)] || TRIP_PROFILE[TRIP_TYPE.eventSetup];
  if (!profile.hasPickup) return null;
  return new Date(event.getTime() + PICKUP_GRACE_HOURS * HOUR_MS);
}

/**
 * Do two dispatch windows collide, once each has been padded by half the
 * turnaround on either side? Null windows never collide — an assignment we
 * can't place in time can't be proven to conflict, and blocking on it would
 * resurrect the whole-day lock by another route.
 */
export function windowsOverlap(a, b, turnaroundHours = TURNAROUND_HOURS) {
  if (!a || !b) return false;
  const pad = (turnaroundHours / 2) * HOUR_MS;
  return a.start.getTime() - pad < b.end.getTime() + pad
    && b.start.getTime() - pad < a.end.getTime() + pad;
}

/**
 * The gap two trips need between them. Venue to venue is a hop; anything
 * involving a return to base is the longer turnaround.
 */
export function requiredGapHours(a, b) {
  if (!a || !b) return 0;
  return (a.leg === TRIP_LEG.setup && b.leg === TRIP_LEG.setup)
    ? HOP_HOURS
    : TURNAROUND_HOURS;
}

/** Do two trips on the same vehicle collide, with the right gap between them? */
export function tripsConflict(a, b) {
  return windowsOverlap(a, b, requiredGapHours(a, b));
}

/** Does a window touch the given calendar day at all? */
export function windowIntersectsDay(window, startOfDay, endOfDay) {
  if (!window) return false;
  return window.start <= endOfDay && window.end >= startOfDay;
}

/**
 * Full per-vehicle availability snapshot for a single calendar date — powers
 * the Vehicles page's date-based "Availability" view.
 *
 * Three things this deliberately does differently from a naive read:
 *
 *   1. Every vehicle carries an ARRAY of the day's dispatches, not one. A van
 *      doing a morning set-up and an afternoon delivery is the normal case for
 *      PG's; keeping one slot per vehicle silently discarded the second trip.
 *   2. The day is matched on the DISPATCH WINDOW, not the event date. A van
 *      leaving at 22:00 for a 06:00 event the next morning is on the road
 *      tonight, and the night it is out is the night it must not be promised
 *      to anyone else.
 *   3. Completed trips are kept. Looking at a past date and being told every
 *      vehicle is "Available" is not an answer — for a day that has already
 *      happened, the honest answer is what happened.
 *
 * Because (2) means an event on a neighbouring date can put a vehicle on the
 * road today, bookings are read across a window either side of the date.
 *
 * Returns:
 *   {
 *     vehicles: [{ vehicle_id, plate_number, vehicle_type, vehicle_status,
 *                  assignments: [{ assignment_id, booking_id, booking_type,
 *                    ref, customerName, venue, event_datetime,
 *                    dispatch_datetime, completed, tripType, window }] }],
 *     eventsOnDate: [{ booking_id, ref, customerName, venue, event_datetime,
 *                      pax_count, booking_type, tripType }]
 *   }
 *
 * `assignments` is sorted by dispatch time, so a row reads left to right as
 * the vehicle's actual day.
 */
export const getDailyVehicleSnapshot = async (dateStr) => {
  if (!dateStr) return { vehicles: [], eventsOnDate: [] };

  const startOfDay = new Date(`${dateStr}T00:00:00`);
  const endOfDay = new Date(`${dateStr}T23:59:59.999`);

  // A trip can start the evening before or end the morning after, so the
  // booking sweep is wider than the day itself. One day either side covers
  // every profile in TRIP_PROFILE with room to spare.
  const sweepStart = new Date(startOfDay.getTime() - 24 * HOUR_MS);
  const sweepEnd = new Date(endOfDay.getTime() + 24 * HOUR_MS);

  const fleet = await fetchAllRows(
    () => supabase
      .from('vehicle')
      .select('vehicle_id, plate_number, vehicle_type, vehicle_status')
      .order('plate_number')
      .order('vehicle_id'),
    'vehicle fleet'
  );

  // Vehicles serve both Package bookings and Short Orders — no booking_type
  // filter here, unlike equipment which is Package-only.
  const bookings = await fetchAllRows(
    () => supabase
      .from('booking')
      .select(`
        booking_id, booking_number, booking_type, venue, event_datetime, pax_count,
        customer:customer_id (first_name, last_name)
      `)
      .in('booking_status', ACTIVE_BOOKING_STATUSES)
      .gte('event_datetime', sweepStart.toISOString())
      .lte('event_datetime', sweepEnd.toISOString())
      .order('event_datetime')
      .order('booking_id'),
    'bookings near date'
  );

  const refFor = (b) => b.booking_number || `${b.booking_type === 'Short Order' ? 'SO' : 'BKG'}-${b.booking_id.slice(0, 8)}`;
  const nameFor = (b) => b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';

  // The events list is still the selected day's own events — it answers "what
  // is happening today", which is a different question from "what is on the
  // road today" and should not inherit the wider sweep.
  const eventsOnDate = bookings
    .filter(b => {
      const when = asDate(b.event_datetime);
      return when && when >= startOfDay && when <= endOfDay;
    })
    .map(b => ({
      booking_id: b.booking_id,
      ref: refFor(b),
      customerName: nameFor(b),
      venue: b.venue,
      event_datetime: b.event_datetime,
      pax_count: b.pax_count,
      booking_type: b.booking_type,
      tripType: getTripType(b),
    }));

  if (bookings.length === 0) {
    return {
      vehicles: fleet.map(v => ({ ...v, assignments: [] })),
      eventsOnDate: [],
    };
  }

  const bookingIds = bookings.map(b => b.booking_id);
  const bookingMap = Object.fromEntries(bookings.map(b => [b.booking_id, b]));

  // Completed rows are kept on purpose — see (3) above.
  const assigns = await fetchAllRows(
    () => supabase
      .from('vehicle_assign')
      .select('assignment_id, vehicle_id, booking_id, dispatch_datetime, assignment_status')
      .in('booking_id', bookingIds)
      .order('dispatch_datetime')
      .order('assignment_id'),
    'vehicle assignments near date'
  );

  const assignsByVehicle = {};
  assigns.forEach(a => {
    const b = bookingMap[a.booking_id];
    if (!b) return;
    const window = getDispatchWindow(a, b);
    if (!windowIntersectsDay(window, startOfDay, endOfDay)) return;

    if (!assignsByVehicle[a.vehicle_id]) assignsByVehicle[a.vehicle_id] = [];
    assignsByVehicle[a.vehicle_id].push({
      assignment_id: a.assignment_id,
      booking_id: b.booking_id,
      booking_type: b.booking_type,
      ref: refFor(b),
      customerName: nameFor(b),
      venue: b.venue,
      event_datetime: b.event_datetime,
      dispatch_datetime: a.dispatch_datetime,
      completed: a.assignment_status === 'Completed',
      tripType: getTripType(b),
      window,
    });
  });

  Object.values(assignsByVehicle).forEach(list =>
    list.sort((x, y) => x.window.start - y.window.start)
  );

  const vehicles = fleet.map(v => ({
    ...v,
    assignments: assignsByVehicle[v.vehicle_id] || [],
  }));

  return { vehicles, eventsOnDate };
};

// ============================================================================
// PLANNING — who goes where, and when they leave
// ============================================================================
//
// The ordering rule, from Vaughn 28 Aug 2026: when one vehicle serves two
// events, the booking APPROVED FIRST is set up first. Not the nearer venue,
// not the earlier event — the one that was approved first. That is a rule the
// system can actually apply, because allocation happens at the moment of
// approval: anything already on the vehicle was approved earlier and keeps its
// place, and the booking being approved now queues behind it.
//
// Two events at the same hour on one van is therefore legal, and it is the case
// that makes the whole thing worth building. It just means leaving very early:
// the chain is planned BACKWARDS from each event's start, so the last setup in
// the chain finishes exactly on time and everything before it is pushed
// earlier. If that pushes the first departure before EARLIEST_DISPATCH_HOUR,
// the plan is reported as not feasible rather than quietly scheduling a 2am
// start nobody agreed to.

// The hour before which nobody is realistically leaving the yard. A plan that
// needs an earlier start is a plan that needs another vehicle.
export const EARLIEST_DISPATCH_HOUR = 3;

/**
 * Place a chain of setup runs on ONE vehicle, in approval order.
 *
 * Each entry is { booking, deadline } where deadline is when the setup must be
 * finished — the event start. Returns the same entries with a `start` and `end`
 * added, plus whether the chain is workable.
 *
 * Planned backwards: the LAST setup finishes at its own deadline, and each one
 * before it must finish by the earlier of its own deadline and the next
 * departure minus a hop. Working forwards instead would let an early trip eat
 * the time a later one needs and only discover it at the end.
 */
export function planSetupChain(entries) {
  const planned = [];
  let nextStart = null;

  for (let i = entries.length - 1; i >= 0; i--) {
    const { booking } = entries[i];
    const event = asDate(booking?.event_datetime);
    if (!event) continue;
    const profile = TRIP_PROFILE[getTripType(booking)] || TRIP_PROFILE[TRIP_TYPE.eventSetup];
    const workMs = (profile.travelHours + profile.setupHours) * HOUR_MS;

    const ownDeadline = event.getTime();
    const chainDeadline = nextStart === null
      ? ownDeadline
      : Math.min(ownDeadline, nextStart - HOP_HOURS * HOUR_MS);

    const start = new Date(chainDeadline - workMs);
    const end = new Date(chainDeadline);
    planned.unshift({ ...entries[i], start, end });
    nextStart = start.getTime();
  }

  // A chain is workable if nobody has to leave before EARLIEST_DISPATCH_HOUR.
  // The planner only ever suggests: a manager who really is starting at 02:00
  // can still set that dispatch time by hand. What this must not do is pick
  // such a time silently and let the crew find out on the day.
  const earliest = planned.length ? planned[0].start : null;
  const feasible = !earliest || earliest.getHours() >= EARLIEST_DISPATCH_HOUR;

  return { trips: planned, feasible, earliestStart: earliest };
}

/**
 * How many vehicles a booking needs.
 *
 * There is no capacity or volume anywhere in the schema — `vehicle_type` only
 * holds Car or Motorcycle and `equipment_type` only Countable or Decoration —
 * so sizing works from what a caterer actually thinks in: guests, with the
 * equipment already allocated at approval as a check on top. Calibrate with
 * PG's; the bands are the knob.
 */
export const FLEET_SIZING = {
  eventSetupByPax: [
    { maxPax: 50, vehicles: 1 },
    { maxPax: 150, vehicles: 2 },
    { maxPax: Infinity, vehicles: 3 },
  ],
  unitsPerExtraVehicle: 250,
  delivery: { vehicles: 1, preferType: 'Motorcycle' },
};

export function vehiclesNeededFor(booking, allocatedUnits = 0) {
  if (getTripType(booking) === TRIP_TYPE.delivery) return FLEET_SIZING.delivery.vehicles;
  const pax = booking?.pax_count || 0;
  const band = FLEET_SIZING.eventSetupByPax.find(b => pax <= b.maxPax)
    || FLEET_SIZING.eventSetupByPax[FLEET_SIZING.eventSetupByPax.length - 1];
  const extra = Math.floor((allocatedUnits || 0) / FLEET_SIZING.unitsPerExtraVehicle);
  return Math.max(1, band.vehicles + extra);
}

/**
 * Which vehicles should take this booking, and when each leaves.
 *
 *   booking        the one being approved
 *   fleet          every row from `vehicle`
 *   tripsByVehicle { [vehicle_id]: [{ window, booking }] } — work already
 *                  committed, i.e. approved before this one
 *   allocatedUnits total equipment units on the booking, for sizing
 *
 * Returns a plan the manager can read, never a write. Picking order is fixed so
 * the same inputs always give the same plan: Available only, then no conflict,
 * then the preferred vehicle type, then fewest trips in the last 7 days (which
 * spreads wear instead of always sending the same van), then plate number.
 */
export function suggestDispatchPlan(booking, fleet, tripsByVehicle = {}, allocatedUnits = 0) {
  const tripType = getTripType(booking);
  const needed = vehiclesNeededFor(booking, allocatedUnits);
  const event = asDate(booking?.event_datetime);
  if (!event) {
    return { tripType, vehiclesNeeded: needed, picks: [], shortfall: { needed, found: 0, reason: 'This booking has no event date, so nothing can be scheduled around it.' } };
  }

  const profile = TRIP_PROFILE[tripType] || TRIP_PROFILE[TRIP_TYPE.eventSetup];
  const weekAgo = new Date(event.getTime() - 7 * 24 * HOUR_MS);

  const candidates = (fleet || [])
    .filter(v => v.vehicle_status === 'Available')
    .map(v => {
      const existing = (tripsByVehicle[v.vehicle_id] || []).filter(t => t.window);
      // Approval order == the order already committed. The new booking joins
      // the end of this vehicle's chain for the day.
      const sameDaySetups = existing
        .filter(t => t.window.leg === TRIP_LEG.setup
          && t.window.start.toDateString() === event.toDateString())
        .sort((x, y) => x.window.start - y.window.start);

      const chain = planSetupChain([
        ...sameDaySetups.map(t => ({ booking: t.booking, existing: true })),
        { booking, existing: false },
      ]);
      const mine = chain.trips[chain.trips.length - 1];
      const proposed = mine
        ? { start: mine.start, end: mine.end, type: tripType, leg: TRIP_LEG.setup }
        : null;

      const clash = existing.find(t => tripsConflict(t.window, proposed));
      const recentTrips = existing.filter(t => t.window.start >= weekAgo && t.window.start <= event).length;

      return { vehicle: v, proposed, chain, clash, recentTrips, chainLength: sameDaySetups.length };
    })
    .filter(c => c.proposed && !c.clash && c.chain.feasible);

  candidates.sort((a, b) => {
    const prefer = FLEET_SIZING.delivery.preferType;
    if (tripType === TRIP_TYPE.delivery) {
      const ap = a.vehicle.vehicle_type === prefer ? 0 : 1;
      const bp = b.vehicle.vehicle_type === prefer ? 0 : 1;
      if (ap !== bp) return ap - bp;
    }
    // An empty vehicle before one already carrying a chain — a shorter chain
    // means an earlier, saner departure for everyone on it.
    if (a.chainLength !== b.chainLength) return a.chainLength - b.chainLength;
    if (a.recentTrips !== b.recentTrips) return a.recentTrips - b.recentTrips;
    return a.vehicle.plate_number.localeCompare(b.vehicle.plate_number);
  });

  const picks = candidates.slice(0, needed).map(c => ({
    vehicle_id: c.vehicle.vehicle_id,
    plate_number: c.vehicle.plate_number,
    vehicle_type: c.vehicle.vehicle_type,
    setupDispatch: c.proposed.start,
    setupEnds: c.proposed.end,
    pickupDispatch: profile.hasPickup ? defaultPickupDispatch(booking) : null,
    reason: c.chainLength === 0
      ? 'Free all day'
      : `Set up after ${c.chainLength} earlier booking${c.chainLength === 1 ? '' : 's'} on this vehicle`,
  }));

  return {
    tripType,
    vehiclesNeeded: needed,
    picks,
    shortfall: picks.length < needed
      ? { needed, found: picks.length, reason: `Only ${picks.length} of ${needed} vehicle(s) can make this event.` }
      : null,
  };
}

// ============================================================================
// THE APPROVAL PATH — availability at review, allocation at approve
// ============================================================================
//
// Equipment already works this way: ApprovalAvailabilityCheck previews demand
// while the manager reads the booking, and useApprovalHandlers turns the
// package template into real rows the moment Approve is pressed. Vehicles had
// neither, so a manager could approve an event on a day the whole fleet was
// already out and only find out at dispatch time. These two functions close
// that, deliberately mirroring the equipment pair so the two resources behave
// the same way at the same moment.

/**
 * Everything already committed to the fleet around one event date, shaped for
 * the planner: { [vehicle_id]: [{ booking, window }] }.
 *
 * Only ACTIVE bookings count. A rejected or cancelled booking's assignment is
 * not real work and must not hold a vehicle hostage.
 */
async function getCommittedTrips(eventDate, excludeBookingId = null) {
  const sweepStart = new Date(eventDate.getTime() - 2 * 24 * HOUR_MS);
  const sweepEnd = new Date(eventDate.getTime() + 2 * 24 * HOUR_MS);

  const rows = await fetchAllRows(
    () => supabase
      .from('vehicle_assign')
      .select(`
        assignment_id, vehicle_id, booking_id, dispatch_datetime, assignment_status,
        booking:booking_id (
          booking_id, booking_number, booking_type, booking_status, event_datetime, venue, pax_count
        )
      `)
      .order('dispatch_datetime')
      .order('assignment_id'),
    'committed trips'
  );

  const byVehicle = {};
  rows.forEach(r => {
    const b = r.booking;
    if (!b || !b.event_datetime) return;
    if (!ACTIVE_BOOKING_STATUSES.includes(b.booking_status)) return;
    if (excludeBookingId && b.booking_id === excludeBookingId) return;
    const when = asDate(b.event_datetime);
    if (!when || when < sweepStart || when > sweepEnd) return;

    const window = getDispatchWindow(r, b);
    if (!window) return;
    if (!byVehicle[r.vehicle_id]) byVehicle[r.vehicle_id] = [];
    byVehicle[r.vehicle_id].push({ booking: b, window, assignment_id: r.assignment_id });
  });
  return byVehicle;
}

/** How many equipment units are allocated to a booking — the sizing check. */
async function getAllocatedUnits(bookingId) {
  if (!bookingId) return 0;
  const rows = await fetchAllRows(
    () => supabase
      .from('booking_equipment')
      .select('quantity')
      .eq('booking_id', bookingId)
      // booking_equipment's primary key is assignment_id — the same column
      // name vehicle_assign uses, on a different table. Ordering on a column
      // that does not exist is a PostgREST error, not a silent no-op.
      .order('assignment_id'),
    'allocated equipment units'
  );
  return rows.reduce((sum, r) => sum + (r.quantity || 0), 0);
}

/**
 * Read-only: what the fleet would look like if this booking were approved.
 * Safe to call repeatedly while the manager is still editing the modal.
 * Mirrors getEquipmentAvailabilityPreview.
 */
export const getVehicleAvailabilityPreview = async (booking) => {
  const event = asDate(booking?.event_datetime);
  if (!event) return null;

  const [fleet, committed, units] = await Promise.all([
    fetchAllRows(
      () => supabase
        .from('vehicle')
        .select('vehicle_id, plate_number, vehicle_type, vehicle_status')
        .order('plate_number')
        .order('vehicle_id'),
      'fleet for approval preview'
    ),
    getCommittedTrips(event, booking.booking_id),
    getAllocatedUnits(booking.booking_id),
  ]);

  const plan = suggestDispatchPlan(booking, fleet, committed, units);
  return {
    ...plan,
    fleetSize: fleet.length,
    outOfService: fleet.filter(v => v.vehicle_status !== 'Available').length,
    sufficient: !plan.shortfall,
  };
};

/**
 * Write: commit the plan. Called from useApprovalHandlers the moment Approve
 * succeeds, alongside allocateEquipmentForBooking.
 *
 * Each picked vehicle gets up to TWO rows — the setup run and, for a package,
 * the pickup run. `vehicle_assign` has no column saying which is which; the
 * dispatch time relative to the event start is what distinguishes them, which
 * is why no schema change is needed.
 *
 * The pickup insert is deliberately separate and its failure is non-fatal. If
 * the database turns out to carry a unique constraint on (booking_id,
 * vehicle_id) — something that cannot be verified from the client — the second
 * row is rejected while the setup run, the one that actually gets the event
 * catered, is already safely in. The caller is told, rather than the whole
 * approval being rolled back over a collection trip.
 */
export const allocateVehiclesForBooking = async (booking) => {
  const event = asDate(booking?.event_datetime);
  if (!event) return { picks: [], shortfall: null, pickupsSkipped: false };

  const fleet = await fetchAllRows(
    () => supabase
      .from('vehicle')
      .select('vehicle_id, plate_number, vehicle_type, vehicle_status')
      .order('plate_number')
      .order('vehicle_id'),
    'fleet for allocation'
  );
  const committed = await getCommittedTrips(event, booking.booking_id);
  const units = await getAllocatedUnits(booking.booking_id);

  const plan = suggestDispatchPlan(booking, fleet, committed, units);
  if (plan.picks.length === 0) {
    return { picks: [], shortfall: plan.shortfall, pickupsSkipped: false };
  }

  const setupRows = plan.picks.map(p => ({
    vehicle_id: p.vehicle_id,
    booking_id: booking.booking_id,
    dispatch_datetime: p.setupDispatch.toISOString(),
    assignment_status: 'Scheduled',
  }));
  const { error: setupError } = await supabase.from('vehicle_assign').insert(setupRows);
  if (setupError) throw setupError;

  let pickupsSkipped = false;
  const pickupRows = plan.picks
    .filter(p => p.pickupDispatch)
    .map(p => ({
      vehicle_id: p.vehicle_id,
      booking_id: booking.booking_id,
      dispatch_datetime: p.pickupDispatch.toISOString(),
      assignment_status: 'Scheduled',
    }));
  if (pickupRows.length > 0) {
    const { error: pickupError } = await supabase.from('vehicle_assign').insert(pickupRows);
    if (pickupError) {
      // Kept as a genuine failure path, not the one this comment used to
      // claim. It previously said the table allows only one row per
      // booking+vehicle, so a pickup could never be stored — that was never
      // checked and is not true. vehicle_assign carries three foreign keys and
      // a primary key on assignment_id, and nothing else: a booking can hold a
      // setup row and a pickup row for the same vehicle, which is what the
      // two-leg model depends on.
      //
      // A failure here is therefore a real problem (network, RLS, a bad
      // dispatch time) rather than an expected limitation, and the setup rows
      // are already saved by this point — so the caller warns rather than
      // rolling back a dispatch that did work.
      console.warn('Pickup run not recorded:', pickupError);
      pickupsSkipped = true;
    }
  }

  return { picks: plan.picks, shortfall: plan.shortfall, pickupsSkipped };
};
