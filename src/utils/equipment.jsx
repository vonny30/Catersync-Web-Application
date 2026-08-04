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
 * Check equipment capacity for a given event date.
 * Returns an array of shortages: { equipment_id, eqm_name, needed, available }
 */
export const checkEquipmentCapacityForDate = async (eventDate, excludeBookingId = null) => {
  // 1. Get all approved bookings on that date (excluding the one being approved/edited)
  const startOfDay = new Date(eventDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(eventDate);
  endOfDay.setHours(23, 59, 59, 999);

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

  if (!bookings || bookings.length === 0) return []; // no bookings, no conflict

  // 2. Compute total demand per equipment across all bookings
  const totalDemand = {};
  for (const booking of bookings) {
    if (!booking.package_id) continue;
    const demand = await computeEquipmentDemand(booking.package_id, booking.pax_count);
    for (const [eqId, qty] of Object.entries(demand)) {
      totalDemand[eqId] = (totalDemand[eqId] || 0) + qty;
    }
  }

  // 3. Fetch current inventory for these equipment IDs
  const eqIds = Object.keys(totalDemand);
  if (eqIds.length === 0) return [];

  const { data: inventory, error: invError } = await supabase
    .from('equipment')
    .select('equipment_id, eqm_name, quantity_available')
    .in('equipment_id', eqIds);

  if (invError) throw invError;

  // 4. Compare and collect shortages
  const shortages = [];
  for (const inv of inventory) {
    const needed = totalDemand[inv.equipment_id] || 0;
    const available = inv.quantity_available || 0;
    if (needed > available) {
      shortages.push({
        equipment_id: inv.equipment_id,
        eqm_name: inv.eqm_name,
        needed,
        available,
      });
    }
  }
  return shortages;
};