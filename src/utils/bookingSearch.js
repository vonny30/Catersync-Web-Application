// src/utils/bookingSearch.js
//
// The search box on the Bookings and Short Orders lists: "Customer name or
// reference". One implementation for both, because the two copies it replaces
// had the same two faults:
//
//   - The reference was never searched. Typing BKG-103 or SO-024 matched
//     nothing, although the placeholder offers it.
//   - Words were OR-ed. "Juan Cruz" listed every Juan and every Cruz. Now each
//     word must appear in the customer's first or last name.
//
// A row matches when its customer matches the name, OR its booking_number
// contains the text.
import { supabase } from '../supabase';
import { fetchAllRows } from './fetchAllRows';

// PostgREST filter syntax treats these as structure, so they are removed from
// the text before it goes into a filter string (same rule as Customers).
export const searchPattern = (term) => (term || '').replace(/[\\"*%,()]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Resolve a search term into a filter for a `booking` query.
 * @returns {Promise<null | ((query) => query)>} null when there is no term.
 */
export async function buildBookingSearch(term) {
  const clean = searchPattern(term);
  if (!clean) return null;
  const words = clean.split(' ');

  let customerIds = [];
  try {
    const rows = await fetchAllRows(() => {
      // Chained .or() calls are AND-ed: every word must match a name part.
      let q = supabase.from('customer').select('customer_id');
      words.forEach((w) => { q = q.or(`first_name.ilike.*${w}*,last_name.ilike.*${w}*`); });
      return q.order('customer_id', { ascending: true });
    }, 'customer name search');
    customerIds = (rows || []).map((r) => r.customer_id);
  } catch (e) {
    console.warn('Customer search failed:', e);
  }

  const byReference = `booking_number.ilike.*${clean}*`;
  return (query) => query.or(customerIds.length
    ? `customer_id.in.(${customerIds.join(',')}),${byReference}`
    : byReference);
}
