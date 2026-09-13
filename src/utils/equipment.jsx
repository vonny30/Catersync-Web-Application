// src/utils/equipment.js
import { supabase } from '../supabase';
import { ACTIVE_BOOKING_STATUSES } from './bookingStatus';
import { fetchAllRows } from './fetchAllRows';

/**
 * The demand rule itself, as a pure function: given a package's equipment
 * template rows, a lookup of equipment by id, and a pax count, how many
 * units of each item does the event need?
 *
 * Split out of computeEquipmentDemand (below) so callers that ALREADY hold
 * the template and equipment rows can apply the identical rule without
 * re-querying per booking. The Equipment page's prep view needs this for
 * every upcoming event at once — recomputing it there by hand would be a
 * second copy of the rule, free to drift from the one the allocator uses,
 * which is exactly how "required" and "assigned" end up disagreeing.
 *
 * Returns { equipment_id: quantity }.
 */
export const deriveEquipmentDemand = (templateRows, equipmentById, paxCount) => {
  const demand = {};
  const pax = paxCount || 0;

  for (const item of (templateRows || [])) {
    const equip = equipmentById?.[item.equipment_id];
    let quantity = 0;

    if (item.per_pax) {
      // Countable item – quantity depends on pax count
      if (equip?.pax_per_unit && equip.pax_per_unit > 0) {
        quantity = Math.ceil(pax / equip.pax_per_unit);
      } else {
        // Fallback: multiply included_quantity by pax count
        quantity = Math.max(1, Math.ceil((item.included_quantity || 0) * pax));
      }
      // Ensure at least 1 if there are guests
      if (pax > 0 && quantity < 1) quantity = 1;
    } else {
      // Decoration / fixed item – quantity is fixed
      quantity = item.included_quantity || 1;
    }

    demand[item.equipment_id] = (demand[item.equipment_id] || 0) + quantity;
  }

  return demand;
};

/**
 * Compute equipment demand for a given package and pax count.
 *
 * Uses `pax_per_unit` from the equipment table to calculate how many units are needed.
 *
 * Returns an object: { equipment_id: quantity }
 * Throws a descriptive error if something goes wrong.
 */
export const computeEquipmentDemand = async (packageId, paxCount) => {
  if (!packageId) {
    throw new Error('Package ID is required to compute equipment demand.');
  }

  try {
    // 1. Get the equipment template from the package
    const { data: equipTemplate, error } = await supabase
      .from('package_equipment')
      .select('equipment_id, included_quantity, per_pax')
      .eq('package_id', packageId);

    if (error) throw error;
    if (!equipTemplate || equipTemplate.length === 0) return {};

    // 2. Get all equipment IDs to fetch their pax_per_unit
    const equipIds = equipTemplate.map(item => item.equipment_id);
    const { data: equipmentData, error: equipError } = await supabase
      .from('equipment')
      .select('equipment_id, pax_per_unit, equipment_type')
      .in('equipment_id', equipIds);

    if (equipError) throw equipError;

    // Create a map for quick lookup
    const equipMap = {};
    equipmentData.forEach(eq => {
      equipMap[eq.equipment_id] = eq;
    });

    // The rule lives in deriveEquipmentDemand so the Equipment page's prep
    // view applies exactly the same one — see the note on that function.
    return deriveEquipmentDemand(equipTemplate, equipMap, paxCount);
  } catch (error) {
    console.error('Error in computeEquipmentDemand:', error);
    throw new Error(`Failed to compute equipment demand: ${error.message}`);
  }
};

/**
 * Allocate equipment for a booking (creates reservation records).
 * Does NOT deduct from equipment.quantity_available.
 * 
 * Returns the inserted records or throws an error.
 */
export const allocateEquipmentForBooking = async (bookingId, packageId, paxCount) => {
  if (!bookingId || !packageId) {
    throw new Error('Booking ID and Package ID are required for equipment allocation.');
  }

  try {
    // Get the equipment template from the package
    const { data: equipTemplate, error: templateError } = await supabase
      .from('package_equipment')
      .select(`
        equipment_id,
        included_quantity,
        per_pax,
        equipment:equipment_id (eqm_name, pax_per_unit, equipment_type)
      `)
      .eq('package_id', packageId);

    if (templateError) throw templateError;
    if (!equipTemplate || equipTemplate.length === 0) {
      console.warn('No equipment template found for this package — approval will allocate nothing.');
      return [];
    }

    const allocations = [];
    const pax = paxCount || 0;

    for (const item of equipTemplate) {
      let quantity = 0;
      const equip = item.equipment;

      if (item.per_pax) {
        if (equip?.pax_per_unit && equip.pax_per_unit > 0) {
          quantity = Math.ceil(pax / equip.pax_per_unit);
        } else {
          quantity = Math.max(1, Math.ceil(item.included_quantity * pax));
        }
        if (pax > 0 && quantity < 1) quantity = 1;
      } else {
        quantity = item.included_quantity || 1;
      }

      allocations.push({
        booking_id: bookingId,
        equipment_id: item.equipment_id,
        quantity: quantity,
        notes: `Auto-allocated from package (${pax} pax)${equip?.pax_per_unit ? ` – ${equip.pax_per_unit} pax/unit` : ''}`,
        returned: false,
        assigned_at: new Date().toISOString(),
      });
    }

    if (allocations.length === 0) {
      if (import.meta.env.DEV) console.log('No allocations to insert.');
      return [];
    }

    const { error: insertError } = await supabase
      .from('booking_equipment')
      .insert(allocations);

    if (insertError) throw insertError;

    if (import.meta.env.DEV) console.log(`✅ Allocated ${allocations.length} equipment items for booking ${bookingId}`);
    return allocations;
  } catch (error) {
    console.error('Error allocating equipment:', error);
    throw new Error(`Failed to allocate equipment: ${error.message}`);
  }
};

/**
 * Check equipment capacity for a given event date.
 * Returns an array of shortages: { equipment_id, eqm_name, needed, available }
 * Returns empty array if no shortages or if no bookings exist.
 */
/**
 * Last-moment capacity re-check, read fresh from the database.
 *
 * The Assign modal validates capacity against the page's local `assignments`
 * state, which is a snapshot from the last fetch. Two managers assigning the
 * same stock for the same date both pass that check against their own stale
 * copies, and both inserts succeed — the units are over-committed and nothing
 * reports it. Realtime narrows that window but cannot close it: the check and
 * the insert are still two separate steps.
 *
 * This re-runs the identical rule against current data immediately before the
 * insert, so the gap shrinks from "however old the page's state is" to the
 * round trip. Stock is re-read too, not just assignments — another manager may
 * have flagged units damaged since the modal opened.
 *
 * Honest about what this is NOT: still check-then-act, so two requests landing
 * inside the same round trip can both pass. Closing it completely needs the
 * database to enforce the invariant (a constraint or a transaction), which is
 * a schema change on a shared project. This is the strongest guarantee
 * available without one.
 *
 * @param eventDate   the event's date (capacity is per-day)
 * @param bookingId   the booking being assigned to, excluded from "already committed"
 * @param items       [{ equipment_id, quantity }]
 * @returns array of violations (empty = safe to proceed)
 */
export const revalidateAssignmentCapacity = async (eventDate, bookingId, items) => {
  if (!eventDate || !items?.length) return [];

  const startOfDay = new Date(eventDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(eventDate);
  endOfDay.setHours(23, 59, 59, 999);

  const equipmentIds = [...new Set(items.map(i => i.equipment_id))];

  // Current stock, not the copy the page loaded.
  const { data: equipRows, error: equipError } = await supabase
    .from('equipment')
    .select('equipment_id, eqm_name, quantity_available')
    .in('equipment_id', equipmentIds);
  if (equipError) throw equipError;
  const stockById = {};
  (equipRows || []).forEach(e => { stockById[e.equipment_id] = e; });

  // Other actively-committed bookings sharing this date.
  let bookingQuery = supabase
    .from('booking')
    .select('booking_id')
    .in('booking_status', ACTIVE_BOOKING_STATUSES)
    .gte('event_datetime', startOfDay.toISOString())
    .lte('event_datetime', endOfDay.toISOString());
  if (bookingId) bookingQuery = bookingQuery.neq('booking_id', bookingId);
  const { data: sameDayBookings, error: bookingError } = await bookingQuery;
  if (bookingError) throw bookingError;

  const committedById = {};
  if (sameDayBookings?.length) {
    const { data: rows, error: rowsError } = await supabase
      .from('booking_equipment')
      .select('equipment_id, quantity')
      .in('booking_id', sameDayBookings.map(b => b.booking_id))
      .in('equipment_id', equipmentIds)
      .eq('returned', false);
    if (rowsError) throw rowsError;
    (rows || []).forEach(r => {
      committedById[r.equipment_id] = (committedById[r.equipment_id] || 0) + (r.quantity || 0);
    });
  }

  const violations = [];
  for (const item of items) {
    const equip = stockById[item.equipment_id];
    if (!equip) continue;
    const alreadyCommitted = committedById[item.equipment_id] || 0;
    const available = equip.quantity_available || 0;
    if (alreadyCommitted + (item.quantity || 0) > available) {
      violations.push({
        equipment_id: item.equipment_id,
        name: equip.eqm_name,
        alreadyCommitted,
        requested: item.quantity || 0,
        available,
      });
    }
  }
  return violations;
};

export const checkEquipmentCapacityForDate = async (eventDate, excludeBookingId = null) => {
  if (!eventDate) {
    throw new Error('Event date is required for capacity check.');
  }

  try {
    const startOfDay = new Date(eventDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(eventDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all actively-committed bookings on that date (Approved or
    // Confirmed — excluding the one being approved/edited)
    let query = supabase
      .from('booking')
      .select('booking_id, package_id, pax_count')
      .in('booking_status', ACTIVE_BOOKING_STATUSES)
      .gte('event_datetime', startOfDay.toISOString())
      .lte('event_datetime', endOfDay.toISOString());

    if (excludeBookingId) {
      query = query.neq('booking_id', excludeBookingId);
    }

    const { data: bookings, error } = await query;
    if (error) throw error;
    if (!bookings || bookings.length === 0) return [];

    // Get all manual equipment assignments for these bookings
    const bookingIds = bookings.map(b => b.booking_id);
    const { data: manualAssignments, error: assignError } = await supabase
      .from('booking_equipment')
      .select('booking_id, equipment_id, quantity')
      .in('booking_id', bookingIds)
      .eq('returned', false);

    if (assignError) throw assignError;

    // Build a map of manual assignments per equipment
    const manualMap = {};
    manualAssignments.forEach(a => {
      if (!manualMap[a.equipment_id]) manualMap[a.equipment_id] = 0;
      manualMap[a.equipment_id] += a.quantity;
    });

    // Bookings that already have real booking_equipment rows (the normal
    // case — allocated at approval time, or re-allocated on edit).
    const bookingIdsWithRealAllocations = new Set(manualAssignments.map(a => a.booking_id));

    // Compute package-based demand and merge with manual assignments
    const totalDemand = {};

    // Copy manual assignments into totalDemand first
    for (const [eqId, qty] of Object.entries(manualMap)) {
      totalDemand[eqId] = (totalDemand[eqId] || 0) + qty;
    }

    // Add THEORETICAL package-based demand only for approved bookings that
    // don't already have real booking_equipment rows — otherwise a normal
    // approved booking gets counted twice (once for its real rows above,
    // once again here from recomputing its package template from scratch).
    for (const booking of bookings) {
      if (booking.package_id && !bookingIdsWithRealAllocations.has(booking.booking_id)) {
        const demand = await computeEquipmentDemand(booking.package_id, booking.pax_count);
        for (const [eqId, qty] of Object.entries(demand)) {
          totalDemand[eqId] = (totalDemand[eqId] || 0) + qty;
        }
      }
    }

    // Get total physical stock
    const eqIds = Object.keys(totalDemand);
    if (eqIds.length === 0) return [];

    const { data: inventory, error: invError } = await supabase
      .from('equipment')
      .select('equipment_id, eqm_name, quantity_available')
      .in('equipment_id', eqIds);

    if (invError) throw invError;

    // Compare and return shortages
    const shortages = [];
    for (const inv of inventory) {
      const needed = totalDemand[inv.equipment_id] || 0;
      const totalStock = inv.quantity_available || 0;
      if (needed > totalStock) {
        shortages.push({
          equipment_id: inv.equipment_id,
          eqm_name: inv.eqm_name,
          needed,
          available: totalStock,
        });
      }
    }
    return shortages;
  } catch (error) {
    console.error('Error checking equipment capacity:', error);
    throw new Error(`Failed to check equipment capacity: ${error.message}`);
  }
};

/**
 * Preview equipment availability for a PENDING package booking, before it's
 * approved — helps the manager see whether there's enough stock left for
 * this date if they approve it. Unlike checkEquipmentCapacityForDate (which
 * only reports shortages for bookings that are ALREADY approved), this
 * includes the hypothetical demand of the booking being reviewed and
 * returns the full per-item breakdown, not just shortages.
 *
 * Returns an array of:
 *   { equipment_id, eqm_name, needed, alreadyCommitted, totalStock, freeBeforeThis, sufficient }
 * sorted with shortages first.
 */
export const getEquipmentAvailabilityPreview = async (eventDate, packageId, paxCount, excludeBookingId = null) => {
  if (!eventDate || !packageId) return [];

  try {
    // 1. What THIS booking would need if approved.
    const thisDemand = await computeEquipmentDemand(packageId, paxCount);
    const eqIds = Object.keys(thisDemand);
    if (eqIds.length === 0) return [];

    // 2. What's already committed to OTHER actively-booked bookings on this
    // date (Approved or Confirmed).
    const startOfDay = new Date(eventDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(eventDate);
    endOfDay.setHours(23, 59, 59, 999);

    let query = supabase
      .from('booking')
      .select('booking_id, package_id, pax_count')
      .in('booking_status', ACTIVE_BOOKING_STATUSES)
      .gte('event_datetime', startOfDay.toISOString())
      .lte('event_datetime', endOfDay.toISOString());
    if (excludeBookingId) {
      query = query.neq('booking_id', excludeBookingId);
    }

    const { data: otherBookings, error } = await query;
    if (error) throw error;

    const committed = {};
    if (otherBookings && otherBookings.length > 0) {
      const bookingIds = otherBookings.map(b => b.booking_id);
      const { data: manualAssignments, error: assignError } = await supabase
        .from('booking_equipment')
        .select('booking_id, equipment_id, quantity')
        .in('booking_id', bookingIds)
        .eq('returned', false);
      if (assignError) throw assignError;

      const bookingIdsWithRealAllocations = new Set((manualAssignments || []).map(a => a.booking_id));
      (manualAssignments || []).forEach(a => {
        committed[a.equipment_id] = (committed[a.equipment_id] || 0) + a.quantity;
      });

      // Same double-counting guard as checkEquipmentCapacityForDate: only
      // recompute theoretical demand for approved bookings that don't
      // already have real booking_equipment rows.
      for (const b of otherBookings) {
        if (b.package_id && !bookingIdsWithRealAllocations.has(b.booking_id)) {
          const demand = await computeEquipmentDemand(b.package_id, b.pax_count);
          for (const [eqId, qty] of Object.entries(demand)) {
            committed[eqId] = (committed[eqId] || 0) + qty;
          }
        }
      }
    }

    // 3. Physical stock.
    const { data: inventory, error: invError } = await supabase
      .from('equipment')
      .select('equipment_id, eqm_name, quantity_available')
      .in('equipment_id', eqIds);
    if (invError) throw invError;

    return (inventory || [])
      .map(inv => {
        const needed = thisDemand[inv.equipment_id] || 0;
        const alreadyCommitted = committed[inv.equipment_id] || 0;
        const totalStock = inv.quantity_available || 0;
        const freeBeforeThis = Math.max(0, totalStock - alreadyCommitted);
        return {
          equipment_id: inv.equipment_id,
          eqm_name: inv.eqm_name,
          needed,
          alreadyCommitted,
          totalStock,
          freeBeforeThis,
          sufficient: freeBeforeThis >= needed,
        };
      })
      .sort((a, b) => Number(a.sufficient) - Number(b.sufficient));
  } catch (error) {
    console.error('Error computing equipment availability preview:', error);
    throw new Error(`Failed to compute equipment availability: ${error.message}`, { cause: error });
  }
};

/**
 * Full per-item availability snapshot for a single calendar date — powers
 * the Equipment page's date-based "Availability" view. For every piece of
 * equipment in inventory, computes how many units are committed to active
 * (Approved/Confirmed) bookings whose event falls on that date, and what's
 * left free. `quantity_available` is static total stock (see comment at the
 * top of this file) — it is never decremented by assignments, so free stock
 * for a date can only be computed, not read off a column.
 *
 * Uses the same double-counting guard as checkEquipmentCapacityForDate /
 * getEquipmentAvailabilityPreview: a booking's real booking_equipment rows
 * are used if it has any, otherwise its package template is recomputed for
 * the theoretical demand — never both, or a normal booking's demand would
 * get counted twice.
 *
 * Returns:
 *   {
 *     items: [{ equipment_id, eqm_name, eqm_description, equipment_type,
 *               quantity_available, damaged_quantity, maintenance_quantity,
 *               pax_per_unit, committed, free,
 *               events: [{ booking_id, assignment_id, ref, customerName,
 *                          venue, event_datetime, quantity, source }] }],
 *     eventsOnDate: [{ booking_id, ref, customerName, venue, event_datetime,
 *                      pax_count, booking_type }]
 *   }
 * `free` is intentionally not clamped at 0 — a negative value is exactly
 * how an overbooked item on that date is surfaced to the caller.
 */
// The stock identity, in one place.
//
// `equipment.quantity_available` stores USABLE units — the add, edit and flag
// handlers all write `total - damaged - maintenance` into it — while the true
// number owned is that plus the two out-of-service counts. Commitments are per
// date and live in booking_equipment; they never touch the equipment row.
//
// Getting this wrong is what made the page contradict itself: the Availability
// tab showed `quantity_available` under a column headed "Total stock" while the
// Inventory tab showed the real total under the same heading, so an item with
// 20 owned and 5 damaged read as "15 total, 5 damaged, 15 free".
//
//   total  =  usable + outOfService
//   free   =  usable - committed        (on the date being viewed)
//
// Both lines hold for every row, which is what lets a manager check the numbers
// by eye instead of trusting them.
export const getStockBreakdown = (item, committedOverride) => {
  const usable = item?.quantity_available || 0;
  const damaged = item?.damaged_quantity || 0;
  const maintenance = item?.maintenance_quantity || 0;
  const outOfService = damaged + maintenance;
  const committed = committedOverride != null ? committedOverride : (item?.committed || 0);
  return {
    total: usable + outOfService,
    usable,
    damaged,
    maintenance,
    outOfService,
    committed,
    // Negative means more is promised than the business can actually supply —
    // surfaced as "Short by N" rather than clamped away, because that is
    // precisely the case a manager has to act on.
    free: usable - committed,
  };
};

export const getDailyEquipmentSnapshot = async (dateStr) => {
  if (!dateStr) return { items: [], eventsOnDate: [] };

  const startOfDay = new Date(dateStr);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(dateStr);
  endOfDay.setHours(23, 59, 59, 999);

  // The daily snapshot's inventory side. Truncated, it would drop items from
  // the availability view entirely rather than showing them as short.
  const inventory = await fetchAllRows(() => supabase
    .from('equipment')
    .select('equipment_id, eqm_name, eqm_description, equipment_type, quantity_available, damaged_quantity, maintenance_quantity, pax_per_unit')
    .order('eqm_name')
    .order('equipment_id', { ascending: true }), 'equipment inventory');

  const { data: bookings, error: bookingError } = await supabase
    .from('booking')
    .select(`
      booking_id, booking_number, booking_type, package_id, pax_count, venue, event_datetime,
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
      items: (inventory || []).map(inv => ({ ...inv, committed: 0, free: inv.quantity_available || 0, events: [] })),
      eventsOnDate: [],
    };
  }

  const bookingIds = bookings.map(b => b.booking_id);
  const { data: realAssignments, error: assignError } = await supabase
    .from('booking_equipment')
    .select('assignment_id, booking_id, equipment_id, quantity')
    .in('booking_id', bookingIds)
    .eq('returned', false);
  if (assignError) throw assignError;

  const bookingMap = Object.fromEntries(bookings.map(b => [b.booking_id, b]));
  const bookingIdsWithRealAllocations = new Set((realAssignments || []).map(a => a.booking_id));

  const committed = {};
  const eventsByEquipment = {};
  const pushEvent = (equipmentId, entry) => {
    if (!eventsByEquipment[equipmentId]) eventsByEquipment[equipmentId] = [];
    eventsByEquipment[equipmentId].push(entry);
  };

  (realAssignments || []).forEach(a => {
    committed[a.equipment_id] = (committed[a.equipment_id] || 0) + a.quantity;
    const b = bookingMap[a.booking_id];
    if (b) {
      pushEvent(a.equipment_id, {
        booking_id: b.booking_id,
        booking_type: b.booking_type,
        assignment_id: a.assignment_id,
        ref: refFor(b),
        customerName: nameFor(b),
        venue: b.venue,
        event_datetime: b.event_datetime,
        quantity: a.quantity,
        source: 'manual',
      });
    }
  });

  for (const b of bookings) {
    if (b.package_id && !bookingIdsWithRealAllocations.has(b.booking_id)) {
      const demand = await computeEquipmentDemand(b.package_id, b.pax_count);
      for (const [eqId, qty] of Object.entries(demand)) {
        committed[eqId] = (committed[eqId] || 0) + qty;
        pushEvent(eqId, {
          booking_id: b.booking_id,
          booking_type: b.booking_type,
          assignment_id: null,
          ref: refFor(b),
          customerName: nameFor(b),
          venue: b.venue,
          event_datetime: b.event_datetime,
          quantity: qty,
          source: 'estimated',
        });
      }
    }
  }

  const items = (inventory || []).map(inv => {
    const committedQty = committed[inv.equipment_id] || 0;
    return {
      ...inv,
      committed: committedQty,
      free: (inv.quantity_available || 0) - committedQty,
      events: (eventsByEquipment[inv.equipment_id] || []).sort((a, b) => new Date(a.event_datetime) - new Date(b.event_datetime)),
    };
  });

  return { items, eventsOnDate };
};

/**
 * Checks whether reducing an equipment item's available stock (by flagging
 * units Damaged/In Repair) would actually clash with anything real, so a
 * status change can be BLOCKED with an accurate reason instead of a vague
 * "some things might be affected somewhere" warning.
 *
 * Naively summing every `returned: false` booking_equipment row (as a
 * simpler check might) is wrong in two ways: (1) it never excludes
 * Rejected/Cancelled bookings, whose rows are never cleaned up, so stale
 * commitments inflate the count; (2) it collapses every date into one
 * total, even though the same physical units can cover two events on
 * different, non-overlapping dates without conflict. Both mistakes only
 * ever make the check MORE trigger-happy than reality — never less — so
 * this instead groups commitments by the actual calendar date (mirroring
 * getDailyEquipmentSnapshot) and only reports a conflict where the
 * proposed available stock genuinely falls short FOR THAT DATE.
 *
 * Past dates are excluded on purpose — a booking whose event already
 * happened but hasn't been marked "returned" yet is an overdue-return
 * bookkeeping gap (already surfaced separately), not a real scheduling
 * conflict that should block today's status change.
 *
 * Returns an array of conflicts (empty if the change is safe):
 *   [{ date, committed, events: [{ ref, customerName, venue, event_datetime, quantity }] }]
 */
export const checkEquipmentAvailabilityImpact = async (equipmentId, proposedAvailable) => {
  const todayStr = new Date().toISOString().slice(0, 10);

  // 1. Real manual assignments for this item, still out, tied to a
  // currently-active booking.
  const { data: realAssignments, error: assignError } = await supabase
    .from('booking_equipment')
    .select(`
      assignment_id, booking_id, quantity,
      booking:booking_id (
        booking_id, booking_number, booking_type, venue, event_datetime, booking_status,
        customer:customer_id (first_name, last_name)
      )
    `)
    .eq('equipment_id', equipmentId)
    .eq('returned', false);
  if (assignError) throw assignError;

  const activeRealAssignments = (realAssignments || []).filter(
    a => a.booking && ACTIVE_BOOKING_STATUSES.includes(a.booking.booking_status)
  );
  const bookingIdsWithRealAllocations = new Set(activeRealAssignments.map(a => a.booking_id));

  // 2. Active bookings whose PACKAGE includes this item but that don't
  // have real rows yet — same theoretical-demand fallback used elsewhere.
  const { data: packageLinks, error: linkError } = await supabase
    .from('package_equipment')
    .select('package_id')
    .eq('equipment_id', equipmentId);
  if (linkError) throw linkError;
  const relevantPackageIds = [...new Set((packageLinks || []).map(l => l.package_id))];

  let theoreticalBookings = [];
  if (relevantPackageIds.length > 0) {
    const { data: candidateBookings, error: bookingError } = await supabase
      .from('booking')
      .select(`
        booking_id, booking_number, booking_type, venue, event_datetime, booking_status, package_id, pax_count,
        customer:customer_id (first_name, last_name)
      `)
      .in('booking_status', ACTIVE_BOOKING_STATUSES)
      .in('package_id', relevantPackageIds);
    if (bookingError) throw bookingError;
    theoreticalBookings = (candidateBookings || []).filter(b => !bookingIdsWithRealAllocations.has(b.booking_id));
  }

  // 3. Group commitments by calendar date (today or later only).
  const refFor = (b) => b.booking_number || `${b.booking_type === 'Short Order' ? 'SO' : 'BKG'}-${b.booking_id.slice(0, 8)}`;
  const nameFor = (b) => b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';

  const byDate = {};
  const addCommitment = (dateStr, qty, entry) => {
    if (dateStr < todayStr) return;
    if (!byDate[dateStr]) byDate[dateStr] = { total: 0, events: [] };
    byDate[dateStr].total += qty;
    byDate[dateStr].events.push(entry);
  };

  activeRealAssignments.forEach(a => {
    const b = a.booking;
    if (!b.event_datetime) return;
    const dateStr = new Date(b.event_datetime).toISOString().slice(0, 10);
    addCommitment(dateStr, a.quantity, { ref: refFor(b), customerName: nameFor(b), venue: b.venue, event_datetime: b.event_datetime, quantity: a.quantity });
  });

  for (const b of theoreticalBookings) {
    if (!b.event_datetime) continue;
    const dateStr = new Date(b.event_datetime).toISOString().slice(0, 10);
    if (dateStr < todayStr) continue;
    const demand = await computeEquipmentDemand(b.package_id, b.pax_count);
    const qty = demand[equipmentId] || 0;
    if (qty <= 0) continue;
    addCommitment(dateStr, qty, { ref: refFor(b), customerName: nameFor(b), venue: b.venue, event_datetime: b.event_datetime, quantity: qty });
  }

  // 4. Only dates where the proposed stock would actually fall short.
  return Object.entries(byDate)
    .filter(([, info]) => info.total > proposedAvailable)
    .map(([date, info]) => ({
      date,
      committed: info.total,
      events: info.events.sort((x, y) => new Date(x.event_datetime) - new Date(y.event_datetime)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * Calculate the recommended quantity for a specific equipment item
 * based on pax count and the equipment's pax_per_unit.
 * 
 * Returns the recommended quantity (number).
 * If equipment not found or pax_per_unit missing, returns fallback.
 */
export const calculateRecommendedQuantity = async (equipmentId, paxCount, includedQuantity = 1, perPax = true) => {
  if (!equipmentId) {
    console.warn('Equipment ID is required for recommended quantity.');
    return includedQuantity || 1;
  }

  if (!perPax) {
    return includedQuantity || 1;
  }

  const pax = paxCount || 0;
  if (pax <= 0) {
    return includedQuantity || 1;
  }

  try {
    const { data, error } = await supabase
      .from('equipment')
      .select('pax_per_unit, equipment_type')
      .eq('equipment_id', equipmentId)
      .single();

    if (error) throw error;

    if (data?.pax_per_unit && data.pax_per_unit > 0) {
      return Math.max(1, Math.ceil(pax / data.pax_per_unit));
    } else {
      // Fallback: multiply included quantity by pax
      return Math.max(1, Math.ceil(includedQuantity * pax));
    }
  } catch (error) {
    console.warn('Error fetching pax_per_unit, using fallback:', error);
    return Math.max(1, Math.ceil(includedQuantity * pax));
  }
};