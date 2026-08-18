// src/utils/autoComplete.js
//
// There's no backend cron/scheduled job in this stack — the DB is Supabase
// with no server-side functions wired up here — so "automatically" marking
// a Confirmed booking/order Completed can only happen passively, whenever
// an admin has a page open that loads the record. Every list/detail fetch
// runs this pass afterward: any Confirmed record whose event happened more
// than AUTO_COMPLETE_GRACE_HOURS ago AND is fully paid gets completed with
// the exact same side effects as the manual "Mark Completed" button
// (equipment returned, vehicle assignments closed out, payments set Fully
// Paid). A Confirmed record past its event date that still has a balance
// owed is deliberately left alone — completing it automatically would bury
// the fact that money is still owed; a human needs to chase that, not have
// it silently marked done.
import { supabase } from '../supabase';
import { STATUS_ORDER } from './bookingStatus';

export const AUTO_COMPLETE_GRACE_HOURS = 5;

export function isPastGracePeriod(eventDatetime) {
  if (!eventDatetime) return false;
  return Date.now() - new Date(eventDatetime).getTime() > AUTO_COMPLETE_GRACE_HOURS * 60 * 60 * 1000;
}

// A Confirmed record sitting past its event date with money still owed —
// used to flag it in the UI instead of leaving it looking like an
// ordinary, on-track Confirmed booking.
export function hasUnpaidPastEvent(record) {
  if (!record || record.booking_status !== 'Confirmed') return false;
  if (!isPastGracePeriod(record.event_datetime)) return false;
  const paid = record.positivePayments || 0;
  const total = record.total_amount || 0;
  return paid < total;
}

// records need booking_id, booking_status, event_datetime, total_amount,
// and positivePayments (gross verified payments, not net of refunds — a
// Confirmed booking shouldn't have refunds against it anyway). Returns the
// booking_ids that were auto-completed so callers know to refresh.
export async function autoCompletePastEvents(records) {
  const eligible = (records || []).filter(r =>
    r.booking_status === 'Confirmed' &&
    isPastGracePeriod(r.event_datetime) &&
    (r.positivePayments || 0) >= (r.total_amount || 0)
  );
  if (eligible.length === 0) return [];

  const ids = eligible.map(r => r.booking_id);
  try {
    const { error } = await supabase.from('booking').update({ booking_status: 'Completed', status_order: STATUS_ORDER.Completed, is_read: true }).in('booking_id', ids);
    if (error) throw error;

    const { error: equipReturnError } = await supabase
      .from('booking_equipment')
      .update({ returned: true, returned_at: new Date().toISOString() })
      .in('booking_id', ids);
    if (equipReturnError) throw equipReturnError;

    const { error: vehicleReturnError } = await supabase
      .from('vehicle_assign')
      .update({ assignment_status: 'Completed' })
      .in('booking_id', ids);
    if (vehicleReturnError) throw vehicleReturnError;

    const { error: paymentError } = await supabase
      .from('payment')
      .update({ pay_status: 'Fully Paid' })
      .in('booking_id', ids);
    if (paymentError) throw paymentError;

    return ids;
  } catch (err) {
    console.error('Auto-complete past events failed:', err);
    return [];
  }
}
