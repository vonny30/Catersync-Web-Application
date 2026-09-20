// src/utils/equipmentAvailability.js
//
// "How much of this item is actually free on the event's date?" — asked of the
// database, which owns the answer.
//
// f_equipment_availability(date) returns usable / committed / free per item
// for one date. Using it replaces a client-side derivation that had a known
// and documented gap: the label in the Assign modal and the guard on submit
// counted different bookings, so the form could offer units the write then
// refused. Both now read this, so they agree by construction.
//
// `free` already nets off everything committed that day, INCLUDING this
// booking's own rows. That is deliberate: assigning is additive, so topping an
// item up to ten units needs ten free units that day.
import { supabase } from '../supabase';

/**
 * The date f_equipment_availability should be asked about.
 *
 * Local parts, not toISOString(): the event is displayed to the manager in
 * Manila time, and an 8am Manila event is the previous day in UTC. Asking
 * about the wrong day would quietly return another day's availability.
 */
export function eventDateKey(eventDatetime) {
  if (!eventDatetime) return null;
  const d = new Date(eventDatetime);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function eventDayLabel(eventDatetime) {
  if (!eventDatetime) return '';
  const d = new Date(eventDatetime);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}

/**
 * @returns {{ status: 'ready'|'failed', byId: Record<string, {usable:number, committed:number, free:number, eqm_name:string}> }}
 *
 * Never throws: a failed availability read degrades the label and the warning,
 * it does not stop a manager assigning equipment. The database's own CHECK
 * constraints remain the hard floor.
 */
export async function fetchEquipmentAvailability(eventDatetime) {
  const p_date = eventDateKey(eventDatetime);
  if (!p_date) return { status: 'failed', byId: {} };
  try {
    const { data, error } = await supabase.rpc('f_equipment_availability', { p_date });
    if (error) throw error;
    const byId = Object.fromEntries((data || []).map(row => [row.equipment_id, {
      usable: Number(row.usable) || 0,
      committed: Number(row.committed) || 0,
      free: Number(row.free) || 0,
      eqm_name: row.eqm_name,
    }]));
    return { status: 'ready', byId };
  } catch (error) {
    console.error('Could not read equipment availability for the event date:', error);
    return { status: 'failed', byId: {} };
  }
}

/**
 * The over-allocation warning, in the manager's terms.
 *
 * It WARNS. Over-allocating is sometimes a real decision — units returning
 * early, a unit borrowed from another site — and refusing it would send the
 * manager to a spreadsheet, which is worse than a system that knows what was
 * promised. The system's job here is to inform, not to refuse.
 */
export function overAllocationWarning({ name, requested, free, dayLabel }) {
  return {
    title: 'More than is free that day',
    message: `Requested ${requested} · ${free} free on ${dayLabel}. "${name}" is over-allocated for this date. Continue only if you know where the extra units are coming from — the allocation is recorded against your account either way.`,
    confirmLabel: 'Assign anyway',
    confirmVariant: 'warning',
  };
}
