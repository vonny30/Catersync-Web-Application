// src/utils/fetchAllRows.js
//
// Paged reads, so a page's figures don't silently go wrong as the data grows.
//
// PostgREST caps every response at the project's max-rows (Supabase default
// 1000) and returns the truncated set WITHOUT an error — nothing throws and
// nothing warns. Any screen that computes a total from an unbounded .select()
// is therefore correct only until the table crosses that line, after which it
// is quietly wrong and gets worse. Reports hit this first (fixed in 9bcdab8);
// the Payments page had the same defect, which is what made its "Fully Paid"
// card disagree with the records behind it.
//
// Two rules the caller has to honour:
//
// 1. Supply a stable .order(). Postgres guarantees no row order without an
//    ORDER BY, so paging an unordered query can repeat or skip rows between
//    pages. "Stable" means the ordering is total — if the column you sort for
//    display is not unique (pay_datetime, event_datetime), chain the primary
//    key after it as a tiebreaker. Ordering by the display column alone is the
//    subtle version of this bug: it looks sorted and still drops rows.
//
// 2. Pass a FACTORY, not a query. A PostgREST query builder is single-use, so
//    each page needs a freshly built one.
export const PAGE_SIZE = 1000;
const MAX_PAGES = 200; // 200k rows — a guard against an unterminated loop

export async function fetchAllRows(buildQuery, label = 'query') {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    // A short page means the end of the set. An exact multiple of PAGE_SIZE
    // costs one extra empty request, which is the cheap, correct trade.
    if (batch.length < PAGE_SIZE) return rows;
  }
  console.warn(`[fetchAllRows] ${label} hit the ${MAX_PAGES}-page ceiling; results may be truncated.`);
  return rows;
}
