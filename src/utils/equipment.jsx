// src/utils/equipment.js
import { supabase } from '../supabase';

/**
 * Compute equipment demand for a given package and pax count.
 * Returns an object: { equipment_id: quantity }
 */
export const computeEquipmentDemand = async (packageId, paxCount) => {
  const { data: equipTemplate, error } = await supabase
    .from('package_equipment')
    .select('equipment_id, included_quantity, per_pax')
    .eq('package_id', packageId);

  if (error) throw error;
  if (!equipTemplate || equipTemplate.length === 0) return {};

  const demand = {};
  for (const item of equipTemplate) {
    let quantity;
    if (item.per_pax) {
      const raw = item.included_quantity * (paxCount || 0);
      quantity = Math.max(1, Math.ceil(raw));
    } else {
      quantity = item.included_quantity || 1;
    }
    demand[item.equipment_id] = (demand[item.equipment_id] || 0) + quantity;
  }
  return demand;
};

/**
 * Allocate equipment for a booking (creates reservation records).
 * Does NOT deduct from equipment.quantity_available.
 */
export const allocateEquipmentForBooking = async (bookingId, packageId, paxCount) => {
  try {
    const { data: equipTemplate, error: templateError } = await supabase
      .from('package_equipment')
      .select(`
        equipment_id,
        included_quantity,
        per_pax,
        equipment:equipment_id (eqm_name)
      `)
      .eq('package_id', packageId);

    if (templateError) throw templateError;
    if (!equipTemplate || equipTemplate.length === 0) {
      console.log('No equipment template found for this package.');
      return;
    }

    const allocations = [];
    for (const item of equipTemplate) {
      let quantity;
      if (item.per_pax) {
        const raw = item.included_quantity * (paxCount || 0);
        quantity = Math.max(1, Math.ceil(raw));
      } else {
        quantity = item.included_quantity || 1;
      }
      allocations.push({
        booking_id: bookingId,
        equipment_id: item.equipment_id,
        quantity: quantity,
        notes: `Auto-allocated from package (${paxCount} pax)`,
        returned: false,
        assigned_at: new Date().toISOString(),
      });
    }

    const { error: insertError } = await supabase
      .from('booking_equipment')
      .insert(allocations);
    if (insertError) throw insertError;

    console.log(`✅ Allocated ${allocations.length} equipment items for booking ${bookingId}`);
    return allocations;
  } catch (error) {
    console.error('Error allocating equipment:', error);
    throw error;
  }
};

/**
 * Check equipment capacity for a given event date.
 * Returns an array of shortages: { equipment_id, eqm_name, needed, available }
 * Includes both package‑based and manually assigned equipment.
 * Compares against total stock (quantity_available).
 */
export const checkEquipmentCapacityForDate = async (eventDate, excludeBookingId = null) => {
  const startOfDay = new Date(eventDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(eventDate);
  endOfDay.setHours(23, 59, 59, 999);

  // 1. Get all approved bookings on that date (excluding the one being approved/edited)
  let query = supabase
    .from('booking')
    .select('booking_id, package_id, pax_count')
    .eq('booking_status', 'Approved')
    .gte('event_datetime', startOfDay.toISOString())
    .lte('event_datetime', endOfDay.toISOString());

  if (excludeBookingId) {
    query = query.neq('booking_id', excludeBookingId);
  }

  const { data: bookings, error } = await query;
  if (error) throw error;
  if (!bookings || bookings.length === 0) return [];

  // 2. Get all manual equipment assignments for these bookings
  const bookingIds = bookings.map(b => b.booking_id);
  const { data: manualAssignments, error: assignError } = await supabase
    .from('booking_equipment')
    .select('booking_id, equipment_id, quantity')
    .in('booking_id', bookingIds)
    .eq('returned', false); // only count non-returned items

  if (assignError) throw assignError;

  // 3. Build a map of manual assignments per equipment
  const manualMap = {};
  manualAssignments.forEach(a => {
    if (!manualMap[a.equipment_id]) manualMap[a.equipment_id] = 0;
    manualMap[a.equipment_id] += a.quantity;
  });

  // 4. Compute package-based demand and merge with manual assignments
  const totalDemand = {};

  // Copy manual assignments into totalDemand first
  for (const [eqId, qty] of Object.entries(manualMap)) {
    totalDemand[eqId] = (totalDemand[eqId] || 0) + qty;
  }

  // Add package-based demand
  for (const booking of bookings) {
    if (booking.package_id) {
      const demand = await computeEquipmentDemand(booking.package_id, booking.pax_count);
      for (const [eqId, qty] of Object.entries(demand)) {
        totalDemand[eqId] = (totalDemand[eqId] || 0) + qty;
      }
    }
  }

  // 5. Get total physical stock
  const eqIds = Object.keys(totalDemand);
  if (eqIds.length === 0) return [];

  const { data: inventory, error: invError } = await supabase
    .from('equipment')
    .select('equipment_id, eqm_name, quantity_available')
    .in('equipment_id', eqIds);

  if (invError) throw invError;

  // 6. Compare and return shortages
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
};