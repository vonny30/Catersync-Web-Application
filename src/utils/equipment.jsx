// src/utils/equipment.js
import { supabase } from '../supabase';

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

    const demand = {};
    const pax = paxCount || 0;

    for (const item of equipTemplate) {
      let quantity = 0;
      const equip = equipMap[item.equipment_id];

      if (item.per_pax) {
        // Countable item – quantity depends on pax count
        if (equip?.pax_per_unit && equip.pax_per_unit > 0) {
          quantity = Math.ceil(pax / equip.pax_per_unit);
        } else {
          // Fallback: multiply included_quantity by pax count
          quantity = Math.max(1, Math.ceil(item.included_quantity * pax));
        }
        // Ensure at least 1 if there are guests
        if (pax > 0 && quantity < 1) {
          quantity = 1;
        }
      } else {
        // Decoration / fixed item – quantity is fixed
        quantity = item.included_quantity || 1;
      }

      demand[item.equipment_id] = (demand[item.equipment_id] || 0) + quantity;
    }

    return demand;
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
      console.log('No equipment template found for this package.');
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
      console.log('No allocations to insert.');
      return [];
    }

    const { error: insertError } = await supabase
      .from('booking_equipment')
      .insert(allocations);

    if (insertError) throw insertError;

    console.log(`✅ Allocated ${allocations.length} equipment items for booking ${bookingId}`);
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
export const checkEquipmentCapacityForDate = async (eventDate, excludeBookingId = null) => {
  if (!eventDate) {
    throw new Error('Event date is required for capacity check.');
  }

  try {
    const startOfDay = new Date(eventDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(eventDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all approved bookings on that date (excluding the one being approved/edited)
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

    // Compute package-based demand and merge with manual assignments
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