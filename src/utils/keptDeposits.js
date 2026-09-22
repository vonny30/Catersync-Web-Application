// src/utils/keptDeposits.js
//
// Reads what keptDepositsFor needs for one period and returns its answer.
// Used by the Payments page and the Dashboard, which do not otherwise load
// closed bookings; Reports already has the rows and calls keptDepositsFor
// directly.
import { supabase } from '../supabase';
import { keptDepositsFor } from './reportMetrics';

/** Forfeited deposits on bookings whose event falls in [start, end] (null = unbounded). */
export async function fetchKeptDeposits(start, end) {
  let q = supabase
    .from('v_booking_money')
    .select('booking_id, event_datetime, net_paid')
    .eq('is_closed', true)
    .gt('net_paid', 0);
  if (start) q = q.gte('event_datetime', start.toISOString());
  if (end) q = q.lte('event_datetime', end.toISOString());
  const { data: closedRows, error } = await q;
  if (error) throw error;
  if (!closedRows?.length) return { byBooking: {}, total: 0 };

  const ids = closedRows.map(r => r.booking_id);
  const [{ data: closedAt, error: e1 }, { data: deposits, error: e2 }] = await Promise.all([
    supabase.from('booking').select('booking_id, closed_at').in('booking_id', ids),
    supabase.from('v_payment_ledger').select('booking_id, amount_paid')
      .in('booking_id', ids).eq('counts_in_ledger', true).eq('pay_status', 'Deposit Collected').gt('amount_paid', 0),
  ]);
  if (e1) throw e1;
  if (e2) throw e2;
  const closedAtById = Object.fromEntries((closedAt || []).map(r => [r.booking_id, r.closed_at]));
  const depositByBooking = {};
  (deposits || []).forEach(p => { depositByBooking[p.booking_id] = (depositByBooking[p.booking_id] || 0) + Number(p.amount_paid); });
  return keptDepositsFor({ closedRows, closedAtById, depositByBooking });
}
