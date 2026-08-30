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

/**
 * Is this short order being delivered, or collected by the customer?
 *
 * Nothing in the schema records it — the Short Orders page has always said
 * "(pickup/delivery)" in its subtitle while storing only a `delivery_fee`, and
 * the no-schema-change rule means that fee is the whole signal available.
 *
 * A fee above zero is a delivery, confidently: nobody charges for delivery on
 * an order the customer comes to fetch. A fee of zero is *probably* a pickup,
 * but it could also be a delivery with the fee waived — so this is stated as
 * derived wherever it is shown, and dispatch treats it as a default rather
 * than a verdict: a zero-fee order is not given a van automatically, and the
 * approval panel still lists every vehicle so a manager can add one when the
 * fee was simply waived.
 *
 * Returns 'Delivery' | 'Customer pickup' | null (not a short order).
 */
export const getShortOrderFulfilment = (booking) => {
  if (booking?.booking_type !== 'Short Order') return null;
  return Number(booking?.delivery_fee || 0) > 0 ? 'Delivery' : 'Customer pickup';
};

/** Does this booking need a vehicle at all? A customer collecting their own
 *  trays does not. */
export const needsTransport = (booking) => getShortOrderFulfilment(booking) !== 'Customer pickup';

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
// Calibrated with PG's, 30 Aug 2026 (blueprint-03 §9.2). Vaughn:
//
//   "They do 2-3 hours setting it up and goes back to the warehouse to proceed
//    if there is event then goes back after 4 or 7 hours after the event for
//    retrieving of equipments."
//
// Three things follow, and they change the shape of a trip rather than just
// its length:
//
//   setupHours is 3, the long end of 2-3. The blueprint's own instruction for
//   a range was to take the conservative end, and here conservative means the
//   van is assumed busy longer — the failure that matters is promising a van
//   that is still at a venue, not leaving one idle on paper.
//
//   The van RETURNS TO BASE after setting up rather than waiting out the
//   event, so the trip is travel out, set up, travel back. The window now
//   includes that return leg: the vehicle is occupied until it is actually
//   back, and free from the moment it is.
//
//   Collection is a SECOND trip, not the tail of the first — out, load, back —
//   starting hours after the event rather than at its end.
export const TRIP_PROFILE = {
  [TRIP_TYPE.eventSetup]: {
    travelHours: 1,        // base -> venue, and venue -> base again
    setupHours: 3,         // unload and set up on site (PG's: 2-3)
    teardownHours: 1,      // load out again on the collection run
    hasPickup: true,
  },
  [TRIP_TYPE.delivery]: {
    travelHours: 0.5,
    setupHours: 0.25,      // hand over and go
    teardownHours: 0,
    hasPickup: false,
  },
};

// The gap between one run ending and the next beginning, for a vehicle doing
// two setups in a day.
//
// This used to mean venue-to-venue transit, on the assumption a van drove
// straight from one site to the next. Both of Vaughn's answers say otherwise:
// §9.2, *"goes back to the warehouse to proceed"*, and §9.4, *"the van goes
// into the venue earlier to make haste to proceed with the next one so what
// they do is give a more time allowance in transporting"*. The van returns to
// base and reloads; the "haste" is a buffer they build in, not a shortcut.
//
// The driving home is now inside the trip window itself, so what is left here
// is reload-and-allowance at base. 1.5h — raised from 0.75 to be the allowance
// described rather than the bare minimum.
export const HOP_HOURS = 1.5;

// Base to base: unloading, refuelling, getting out again. Used when two trips
// are unrelated rather than chained.
export const TURNAROUND_HOURS = 1;

// How long after an event starts before the vehicle goes back to collect.
//
// PG's returns 4 to 7 hours after the event. Four, deliberately the EARLY end
// — the opposite choice from setupHours, for the same reason. This is when the
// van is committed to collecting, so assuming the earliest keeps it from being
// promised elsewhere at a time it might already be on the road. Assuming seven
// would free it on paper for hours it may not actually have.
export const PICKUP_GRACE_HOURS = 4;

// "Pickup" collided with the short-order sense of the word — a customer
// collecting their own trays — which is the opposite direction of travel. The
// legs are named for what the van is doing: taking equipment out, and going
// back for it.
export const TRIP_LEG = { setup: 'Setup run', pickup: 'Collection run' };

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
    // Out, load out, back. The outbound leg used to be missing, which had the
    // van collecting the instant it left base.
    const start = dispatch;
    const end = new Date(start.getTime() + (profile.travelHours + profile.teardownHours + profile.travelHours) * HOUR_MS);
    return { start, end, type, leg: TRIP_LEG.pickup };
  }

  // Out and set up — this much has to be finished by the time the event starts.
  const workHours = profile.travelHours + profile.setupHours;
  // No stored dispatch time (rows saved before dispatch times were captured):
  // fall back to the latest departure that still finishes on time.
  const start = dispatch || new Date(event.getTime() - workHours * HOUR_MS);
  // ...and then back to base, which is the part that decides when the vehicle
  // is free again. PG's does not wait out the event.
  const end = new Date(start.getTime() + (workHours + profile.travelHours) * HOUR_MS);
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
 * The gap two trips need between them. Two setups back to back get the fuller
 * reload allowance; anything else gets the standard turnaround.
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
    // The next run cannot leave until this one is back at base and reloaded.
    // The return leg has to be counted here explicitly: this deadline is the
    // moment setup FINISHES, while getDispatchWindow's window runs on to the
    // moment the van is home. Leaving it out would let the chain propose
    // departures that tripsConflict then refuses — the planner and the checker
    // disagreeing about the same van.
    const chainDeadline = nextStart === null
      ? ownDeadline
      : Math.min(ownDeadline, nextStart - (HOP_HOURS + profile.travelHours) * HOUR_MS);

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
// How many vehicles a trip takes.
//
// Blueprint-03 §9.3 asked whether a 120-guest event is two vans or one van
// twice. Vaughn answered it from how PG's actually works, 30 Aug 2026:
//
//   "what they do is 3 vehicles for booking for dispatch ... make the setup or
//    dispatch more earlier to one booking and proceeds to the next place of
//    the other booking"
//
// So an event setup is not sized per event at all. The whole fleet goes out
// together, unloads, and moves on to the next venue — which is why the setup
// for an earlier booking is pushed earlier still, to leave time for the hop.
// planSetupChain already models that movement; this is the count it moves.
//
// Three, because that is the load a typical package takes — not "the fleet".
// An earlier version read this as the whole fleet, which happened to be right
// while PG's owned exactly three vehicles and became wrong the moment a fourth
// arrived: approving one 50-pax booking then sent every van they had, and with
// ten it would have sent ten.
//
// This is a DEFAULT, not a decision. The approval panel lists the suggested
// vehicles and lets the manager add or remove before approving, because the
// number of vans a job really takes depends on the load, and only the person
// looking at the booking knows that.
export const EVENT_SETUP_DEFAULT_VEHICLES = 3;

export const FLEET_SIZING = {
  // 'default' — EVENT_SETUP_DEFAULT_VEHICLES, capped by what is in service.
  // 'by-pax'  — size per event from the bands below.
  eventSetupMode: 'default',
  eventSetupByPax: [
    { maxPax: 50, vehicles: 1 },
    { maxPax: 150, vehicles: 2 },
    { maxPax: Infinity, vehicles: 3 },
  ],
  unitsPerExtraVehicle: 250,
  // A tray delivery is one vehicle's work, and a motorcycle's if there is one.
  // Sending the fleet to drop off trays would strand every event that day.
  delivery: { vehicles: 1, preferType: 'Motorcycle' },
};

export function vehiclesNeededFor(booking, allocatedUnits = 0, serviceableFleetSize = null) {
  // The customer is collecting this one themselves — no van leaves the yard.
  if (!needsTransport(booking)) return 0;
  if (getTripType(booking) === TRIP_TYPE.delivery) return FLEET_SIZING.delivery.vehicles;

  if (FLEET_SIZING.eventSetupMode === 'default') {
    // Never more than exist, and never zero — a plan for no vehicles is not a
    // plan. A fleet of ten does not mean ten go out.
    if (!serviceableFleetSize || serviceableFleetSize < 1) return EVENT_SETUP_DEFAULT_VEHICLES;
    return Math.max(1, Math.min(EVENT_SETUP_DEFAULT_VEHICLES, serviceableFleetSize));
  }

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
  // Sized against vehicles that are actually in service — a van in the
  // workshop is not part of the fleet that can go out today.
  const serviceable = (fleet || []).filter(v => v.vehicle_status === 'Available').length;
  const needed = vehiclesNeededFor(booking, allocatedUnits, serviceable);
  const noTransportNeeded = needed === 0
    ? 'No delivery fee on this order, so it is treated as a customer pickup and nothing is dispatched. Tick a vehicle below if it is actually being delivered.'
    : null;
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
    });

  // Every serviceable vehicle stays visible, because the approval panel lets
  // the manager add one the planner did not pick — usually because it wanted
  // fewer vehicles, not because that van was unfit. Ones that genuinely cannot
  // go are offered with the reason rather than hidden, so a manager looking
  // for a fourth van learns why there isn't one.
  const usable = candidates.filter(c => c.proposed && !c.clash && c.chain.feasible);
  const blocked = candidates.filter(c => !(c.proposed && !c.clash && c.chain.feasible));

  usable.sort((a, b) => {
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

  const picks = usable.slice(0, needed).map(c => ({
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

  const options = [
    ...usable.map(c => ({
      vehicle_id: c.vehicle.vehicle_id,
      plate_number: c.vehicle.plate_number,
      vehicle_type: c.vehicle.vehicle_type,
      selectable: true,
      setupDispatch: c.proposed.start,
      setupEnds: c.proposed.end,
      pickupDispatch: profile.hasPickup ? defaultPickupDispatch(booking) : null,
      reason: c.chainLength === 0
        ? 'Free all day'
        : `Set up after ${c.chainLength} earlier booking${c.chainLength === 1 ? '' : 's'} on this vehicle`,
    })),
    ...blocked.map(c => ({
      vehicle_id: c.vehicle.vehicle_id,
      plate_number: c.vehicle.plate_number,
      vehicle_type: c.vehicle.vehicle_type,
      selectable: false,
      setupDispatch: null,
      setupEnds: null,
      pickupDispatch: null,
      reason: c.clash
        ? 'Already out on another booking at that time'
        : !c.chain.feasible
          ? 'Would have to leave too early to chain with its other trips'
          : 'Cannot make this event as scheduled',
    })),
  ];

  return {
    options,
    tripType,
    vehiclesNeeded: needed,
    noTransportNeeded,
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
export const allocateVehiclesForBooking = async (booking, chosenVehicleIds = null) => {
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

  // A manager who adjusted the list in the approval panel has overruled the
  // suggestion, and the suggestion must not quietly reinstate itself. Their
  // set is filtered against the plan so a vehicle they added still gets a
  // dispatch time worked out for it, and one they removed simply does not go.
  if (Array.isArray(chosenVehicleIds)) {
    const chosen = new Set(chosenVehicleIds);
    const kept = plan.picks.filter(p => chosen.has(p.vehicle_id));
    // Anything they added that the planner had not picked — usually because it
    // wanted fewer vehicles, not because that van was unfit.
    const extraIds = chosenVehicleIds.filter(id => !plan.picks.some(p => p.vehicle_id === id));
    const extras = extraIds
      .map(id => fleet.find(v => v.vehicle_id === id))
      .filter(Boolean)
      .map(v => ({
        vehicle_id: v.vehicle_id,
        plate_number: v.plate_number,
        setupDispatch: plan.picks[0]?.setupDispatch || defaultSetupDispatch(booking),
        pickupDispatch: plan.picks[0]?.pickupDispatch || defaultPickupDispatch(booking),
        reason: 'Added by the manager',
      }));
    plan.picks = [...kept, ...extras];
    // Their choice is the plan now, so a shortfall against the old suggested
    // count is no longer a shortfall.
    plan.shortfall = plan.picks.length === 0
      ? { needed: 1, found: 0, reason: 'No vehicle was selected for this booking.' }
      : null;
  }

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
