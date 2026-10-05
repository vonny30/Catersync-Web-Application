// src/utils/listFilters.js
//
// Filters the Bookings and Short Orders lists receive as a list of booking
// ids rather than a column: the Overdue / Lapsed / Flagged quick filters, and
// a customer-name search (utils/bookingSearch).
//
// A short id list goes to the database inside the query, as before. A long
// one does not fit in one request (every id travels in the URL), so the page
// reads the matching rows in pages and keeps the ones in the list itself.
// Both give the same rows in the same order; only the long case reads more.
import { supabase } from '../supabase';
import { fetchByIds, ID_BATCH_SIZE } from './fetchAllRows';

/** The columns a row needs for `keep` to judge it. */
export const KEEP_COLUMNS = 'booking_id, customer_id, booking_number';

/**
 * Splits the id-list filters into the part the database can take and the
 * part checked after reading.
 * @param search          the result of buildBookingSearch (or null)
 * @param quickFilterIds  ids behind the active quick filter (or null when none)
 * @returns {{ applyIds: (query, opts?) => query, keep: null | ((row, opts?) => boolean) }}
 *   `{ forChips: true }` leaves out the quick-filter ids, as the chip counts need.
 */
export function idListFilters({ search, quickFilterIds }) {
  const quickInQuery = !!quickFilterIds && quickFilterIds.length <= ID_BATCH_SIZE;
  const quickSet = quickFilterIds && !quickInQuery ? new Set(quickFilterIds) : null;

  const applyIds = (q, { forChips = false } = {}) => {
    if (search?.apply) q = search.apply(q);
    if (quickInQuery && !forChips) q = q.in('booking_id', quickFilterIds);
    return q;
  };

  const keep = (search?.keep || quickSet)
    ? (row, { forChips = false } = {}) =>
      (!search?.keep || search.keep(row))
      && (forChips || !quickSet || quickSet.has(row.booking_id))
    : null;

  return { applyIds, keep };
}

/**
 * Booking ids in order of balance (v_booking_money.outstanding), for any
 * number of ids. Matches the database's own order: lowest or highest first,
 * a missing balance counted as the highest, ties by booking id.
 * @param direction  'asc' or 'desc'
 */
export async function orderIdsByBalance(ids, direction) {
  const rows = await fetchByIds(ids, (batch) => supabase
    .from('v_booking_money')
    .select('booking_id, outstanding')
    .in('booking_id', batch)
    .order('booking_id', { ascending: true }), 'balances');
  const value = (r) => (r.outstanding == null ? Infinity : Number(r.outstanding));
  const sign = direction === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x !== y) return (x < y ? -1 : 1) * sign;
    return a.booking_id < b.booking_id ? -1 : a.booking_id > b.booking_id ? 1 : 0;
  });
  return rows.map(r => r.booking_id);
}
