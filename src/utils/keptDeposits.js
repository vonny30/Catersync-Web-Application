// src/utils/keptDeposits.js
//
// Reads what keptDepositsFor needs for one period and returns its answer.
// Used by the Receivables page and the Dashboard, which do not otherwise load
// closed bookings; Reports already has the rows and calls keptDepositsFor
// directly.
//
// Every read is paged, and the per-booking reads go 100 ids at a time: an
// "all time" period covers every closed booking ever, which outgrows both the
// 1,000-row response cap and the length of one request.
import { supabase } from '../supabase';
import { keptDepositsFor } from './reportMetrics';
import { fetchAllRows, fetchByIds } from './fetchAllRows';

/** Forfeited deposits on bookings whose event falls in [start, end] (null = unbounded). */
export async function fetchKeptDeposits(start, end) {
  const closedRows = await fetchAllRows(() => {
    let q = supabase
      .from('v_booking_money')
      .select('booking_id, event_datetime, net_paid')
      .eq('is_closed', true)
      .gt('net_paid', 0);
    if (start) q = q.gte('event_datetime', start.toISOString());
    if (end) q = q.lte('event_datetime', end.toISOString());
    return q.order('booking_id', { ascending: true });
  }, 'closed bookings with money paid');
  if (!closedRows.length) return { byBooking: {}, total: 0 };

  const ids = closedRows.map(r => r.booking_id);
  const [closedAt, deposits] = await Promise.all([
    fetchByIds(ids, (batch) => supabase
      .from('booking')
      .select('booking_id, closed_at')
      .in('booking_id', batch)
      .order('booking_id', { ascending: true }), 'closing dates'),
    fetchByIds(ids, (batch) => supabase
      .from('v_payment_ledger')
      .select('booking_id, amount_paid')
      .in('booking_id', batch)
      .eq('counts_in_ledger', true)
      .eq('pay_status', 'Deposit Collected')
      .gt('amount_paid', 0)
      .order('payment_id', { ascending: true }), 'deposits on closed bookings'),
  ]);
  const closedAtById = Object.fromEntries(closedAt.map(r => [r.booking_id, r.closed_at]));
  const depositByBooking = {};
  deposits.forEach(p => { depositByBooking[p.booking_id] = (depositByBooking[p.booking_id] || 0) + Number(p.amount_paid); });
  return keptDepositsFor({ closedRows, closedAtById, depositByBooking });
}
