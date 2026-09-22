// src/pages/Reports/helpers.js

export const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0).replace('PHP', '₱');
};

export const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

// One decimal place, so a set of shares still visibly adds to 100.0% —
// rounding to whole numbers makes a four-row table total 99% or 101% and
// leaves the reader wondering which figure is wrong.
export const formatPercent = (value, digits = 1) => `${(value || 0).toFixed(digits)}%`;

export const getBookingRef = (booking) => {
  if (booking.booking_number) return booking.booking_number;
  const prefix = booking.booking_type === 'Short Order' ? 'SO' : 'BKG';
  return `${prefix}-${booking.booking_id.slice(0, 8)}`;
};

// Calendar periods only. "Last 30 Days" is gone: accounting periods are
// calendar months, and a rolling thirty days names no month and never matches a
// monthly statement, so its figures could not be compared with anything.
export const DATE_RANGE_PRESETS = ['This Month', 'Last Month', 'This Year', 'All Time', 'Custom'];

// What a page opens on, and what "clear the filter" returns it to.
//
// All Time was the old default everywhere, and it read as "no filter" — so a
// manager saw every record the business had ever taken and had no prompt that
// a period existed at all. The current month is the question actually being
// asked most of the time, and DateRangeFilter now states the window on screen.
//
// This is also what "active filter" is measured against. Comparing to
// 'All Time' would make every page report one active filter the moment it
// loaded, which is not something the manager did.
//
// The Bookings and Short Orders LISTS deliberately stay on 'All Time' and do
// not import this: their job is showing what is coming, and an event next
// month must not be hidden behind a filter nobody chose.
export const DEFAULT_DATE_PRESET = 'This Month';

// The selected period, named, for a card subtext: "September", "2026",
// "the last 30 days", "all time", "1–15 September".
//
// THE RULE, as amended: a card subtext may not contain a digit that is
// CURRENCY or an ENTITY COUNT, and may not say "events". Digits that are dates
// or periods are fine — "2026", "the last 30 days", "1–15 September" are how
// financial reporting states a period, and hiding them only makes the card
// vague. What the rule stops is a second money figure or a row count sitting
// under the first number, which is what invites a reader to reconcile them.
// "for September" / "during September" / "in September" — and, when the range
// is unbounded, just "all time". Without these, a subtext reads "Collected
// during all time".
export const ALL_TIME_LABEL = 'all time';
export const forPeriod = (period) => (period === ALL_TIME_LABEL ? ALL_TIME_LABEL : `for ${period}`);
export const duringPeriod = (period) => (period === ALL_TIME_LABEL ? ALL_TIME_LABEL : `during ${period}`);
export const inPeriod = (period) => (period === ALL_TIME_LABEL ? ALL_TIME_LABEL : `in ${period}`);

export function periodLabel(preset, start, end) {
  if ((preset === 'This Month' || preset === 'Last Month') && start) {
    return start.toLocaleString('en-PH', { month: 'long', timeZone: MANILA });
  }
  if (preset === 'This Year' && start) return String(manilaParts(start).y);
  if (preset === 'All Time') return 'all time';
  if (start && end) {
    const sameMonth = start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth();
    const month = (d) => d.toLocaleString('en-PH', { month: 'long' });
    return sameMonth
      ? `${start.getDate()}–${end.getDate()} ${month(end)}`
      : `${start.getDate()} ${month(start)} – ${end.getDate()} ${month(end)}`;
  }
  return 'the selected range';
}

/**
 * The period title: the one place on a page that names the month.
 *
 *   This Month  -> September 2026        This Year -> 2026
 *   Last Month  -> August 2026           All Time  -> All time
 *   Custom      -> 25 Aug – 10 Sep 2026  (both years when they differ)
 *
 * Shown once, under the filter bar, on the pages whose figures depend on a
 * period. Money cards also state the exact days (periodSpan below), at
 * Vaughn's request of 21 Sep 2026: "this month" alone did not say which days
 * a service-date figure and a payment-date figure each count.
 */
export function periodTitle(preset, start, end) {
  if (preset === 'All Time' || (!start && !end)) return 'All time';
  if ((preset === 'This Month' || preset === 'Last Month') && start) {
    return start.toLocaleString('en-PH', { month: 'long', year: 'numeric', timeZone: MANILA });
  }
  if (preset === 'This Year' && start) return String(manilaParts(start).y);
  // A fixed list, not toLocaleString: locale data abbreviates September as
  // "Sept" in some runtimes and "Sep" in others.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (d) => { const p = manilaParts(d); return `${p.d} ${MONTHS[p.m]}`; };
  if (start && end) {
    const ys = manilaParts(start).y;
    const ye = manilaParts(end).y;
    return ys === ye
      ? `${day(start)} – ${day(end)} ${ye}`
      : `${day(start)} ${ys} – ${day(end)} ${ye}`;
  }
  if (start) return `From ${day(start)} ${manilaParts(start).y}`;
  return `Until ${day(end)} ${manilaParts(end).y}`;
}

/**
 * The exact days a period covers, for card subtexts: "September 1–30",
 * "Aug 28 – Sep 4", "Jan 1 – Dec 31, 2026". Null when the period is unbounded
 * (All time) — callers then keep their plain subtext.
 *
 * Why the cards carry it: a service-date figure and a payment-date figure sit
 * side by side, and "this month" alone did not say which days each counts.
 * Both ends are inclusive — getRangeBounds ends a period just before midnight.
 */
export function periodSpan(start, end) {
  if (!start || !end) return null;
  const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const s = manilaParts(start);
  const e = manilaParts(end);
  if (s.y === e.y && s.m === e.m) return `${LONG[s.m]} ${s.d}–${e.d}`;
  if (s.y === e.y) return `${SHORT[s.m]} ${s.d} – ${SHORT[e.m]} ${e.d}, ${e.y}`;
  return `${SHORT[s.m]} ${s.d}, ${s.y} – ${SHORT[e.m]} ${e.d}, ${e.y}`;
}

/**
 * Payments Received is money KEPT: verified receipts less refunds, both by
 * payment date (f_report_period cash_receipts − refunds_issued). A deposit
 * kept on a cancellation stays in; a refunded amount comes out, and the
 * subtext says so, so the subtraction is visible rather than silent.
 */
export const paymentsReceivedNet = (receipts, refunds) => (Number(receipts) || 0) - (Number(refunds) || 0);

/** The pop-up behind a Payments Received card — one definition for both tabs. */
export const paymentsReceivedDetail = (s) => ({
  title: 'Payments Received',
  description: 'Money kept: verified receipts less refunds, each counted on the day the money moved. Claims awaiting verification, reversals and reversed receipts are excluded — the same rule the Payments page uses.',
  fields: [
    { label: 'Payments received', value: formatCurrency(s.paymentsReceived), emphasis: true },
    { label: 'Verified receipts', value: formatCurrency(s.cashReceipts) },
    { label: 'Less refunds', value: formatCurrency(s.refundsIssued) },
    { label: 'Receipts counted', value: s.receiptCount },
  ],
});

export function paymentsReceivedSub(span, refunds) {
  const refunded = Number(refunds) || 0;
  const when = span ? `Paid ${span}` : 'All verified receipts';
  return refunded > 0 ? `${when}, after ${formatCurrency(refunded)} refunded` : (span ? `Verified receipts, paid ${span}` : when);
}

// ---------------------------------------------------------------------------
// TWO DIFFERENT QUESTIONS. Do not use this constant for the second one.
// ---------------------------------------------------------------------------
//
//   "Is a filter active — has the manager moved off the default?"
//        preset !== DEFAULT_DATE_PRESET
//        Used by the active-filter badges and the filter label colour.
//
//   "Should a date range be applied at all?"
//        preset !== 'All Time'
//        'All Time' is the ONLY preset that means unbounded. Every other
//        preset, the default included, has real bounds that must be applied.
//
// Conflating these shipped a live defect on 5 Sep 2026: the guards were
// written `preset !== DEFAULT_DATE_PRESET && !isWithinRange(...)`, so on the
// default preset the guard was false, the range was never applied, and seven
// pages showed ALL-TIME data under a label that said "this month". The
// Payments page read PHP 103,000 while the Dashboard read PHP 50,500 for the
// same rule and the same period.
//
// It fails silently and it fails only on the default, which is the one state
// nobody thinks to test.
// ---------------------------------------------------------------------------

// MANILA TIME, EXPLICITLY. Every period is a Philippine calendar period, so
// its bounds are computed in Asia/Manila whatever the device's own timezone
// is. They used to be built with local-time constructors, which were right only
// on a computer set to the Philippines: anywhere else every month started and
// ended eight hours off, and a receipt taken on the 1st could fall into the
// previous month. This Month is 2026-09-01 00:00 +08 up to, and not including,
// 2026-10-01 00:00 +08 — expressed here as an inclusive end one millisecond
// earlier, because isWithinRange and the list queries compare with <=.
export const MANILA = 'Asia/Manila';
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000; // the Philippines has no DST

// Year / month / day of a moment, as read on a Manila calendar.
function manilaParts(date) {
  const shifted = new Date(date.getTime() + MANILA_OFFSET_MS);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), d: shifted.getUTCDate() };
}

// Midnight Manila on a calendar day, as a real instant. Month and day may
// overflow (month 12, day 0); Date.UTC normalises them.
const manilaMidnight = (y, m, d = 1) => new Date(Date.UTC(y, m, d) - MANILA_OFFSET_MS);
const justBefore = (date) => new Date(date.getTime() - 1);

// Returns { start: Date|null, end: Date|null } — null on either side means
// "unbounded" (used for 'All Time' or an incomplete custom range).
export function getRangeBounds(preset, customStart, customEnd) {
  const { y, m } = manilaParts(new Date());

  if (preset === 'This Month') {
    return { start: manilaMidnight(y, m), end: justBefore(manilaMidnight(y, m + 1)) };
  }

  if (preset === 'Last Month') {
    return { start: manilaMidnight(y, m - 1), end: justBefore(manilaMidnight(y, m)) };
  }

  if (preset === 'This Year') {
    return { start: manilaMidnight(y, 0), end: justBefore(manilaMidnight(y + 1, 0)) };
  }

  if (preset === 'Custom') {
    // Both dates inclusive, both Manila days. DateRangeFilter refuses an end
    // before the start, so an inverted pair should never reach here; if one
    // does (a stale value, a future caller), it is swapped rather than
    // returning a window that matches nothing.
    const start = customStart ? new Date(`${customStart}T00:00:00+08:00`) : null;
    const end = customEnd ? new Date(`${customEnd}T23:59:59.999+08:00`) : null;
    if (start && end && end < start) {
      return {
        start: new Date(`${customEnd}T00:00:00+08:00`),
        end: new Date(`${customStart}T23:59:59.999+08:00`),
      };
    }
    return { start, end };
  }

  // 'All Time'
  return { start: null, end: null };
}

export function isWithinRange(dateValue, start, end) {
  if (!dateValue) return false;
  const d = new Date(dateValue);
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

// One card treatment across every tab: white surface, hairline border, and a
// 3px accent bar that carries the colour. The accent is a positioned element
// rather than a border-l, so eight cards side by side read as one family
// instead of eight tinted blocks.
const CARD_ACCENTS = {
  green:  'bg-[#008A45]',
  teal:   'bg-teal-600',
  amber:  'bg-amber-500',
  blue:   'bg-blue-500',
  purple: 'bg-purple-600',
  red:    'bg-red-500',
  slate:  'bg-slate-400',
};

// Shell classes. `relative overflow-hidden` are required — the accent bar is
// absolutely positioned inside. Keeps its old call signature (the colour
// argument is now ignored) so no call site breaks.
export function cardColorClasses() {
  return 'relative overflow-hidden bg-white border-slate-200/70 hover:border-[#c9dfd4] hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)]';
}

export function cardAccentClass(color = 'green') {
  return `absolute left-0 top-0 bottom-0 w-[3px] ${CARD_ACCENTS[color] || CARD_ACCENTS.green}`;
}

// Figures are near-black everywhere now; colour lives in the accent bar, not
// the number. The red "damaged" card is the one intentional exception.
export function cardValueClass(color = 'green') {
  return color === 'red' ? 'text-red-700' : 'text-slate-900';
}


// ---------------------------------------------------------------------------
// MONTHLY GROUPING
//
// Months are grouped by a NUMERIC key and sorted on it, never by re-parsing the
// display string. `new Date("Aug 2026")` is implementation-defined, and under a
// non-English locale toLocaleString emits "ago 2026" / "8月 2026", which parses
// to Invalid Date and sorts the chart into arbitrary order.
// ---------------------------------------------------------------------------
export const monthSortKey = (date) => date.getFullYear() * 12 + date.getMonth();
export const monthLabel = (date) => date.toLocaleString('default', { month: 'short', year: 'numeric' });

/**
 * The Financial tab's three-line trend: estimated gross revenue, what has been
 * paid against it, and what is left — per EVENT month.
 *
 * Anchored on the EVENT date, matching the three cards above the chart. That is
 * a different question from the cash-by-payment-month series, and reusing that
 * one here would quietly answer the wrong one.
 *
 * DELIBERATELY IGNORES THE PERIOD FILTER, which is why it takes the full
 * booking and payment lists rather than range-scoped copies. A trend scoped to
 * one month is a single point — which is exactly what the bar chart this
 * replaced rendered under the default "This Month" preset. The window is the
 * last six months plus anything already scheduled ahead.
 *
 * Pending bookings are EXCLUDED by the caller (excludeStatuses), which keeps
 * this consistent with the Estimated Gross Revenue card and with every other
 * money figure on the page: a request nobody has agreed to is a lead, not a
 * sale. "Estimated" still earns its name — an accepted booking's total can
 * change before the event.
 *
 * Pure — `now` is a parameter, so this is testable and never reads the clock.
 */
export const buildMonthlyFinancialTrend = (
  bookings = [],
  verifiedPayments = [],
  now = new Date(),
  { monthsBack = 5, excludeStatuses = ['Rejected', 'Cancelled'], keptByBooking = {} } = {}
) => {
  const floor = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);

  // Every verified payment against a booking, whenever it was taken: it is
  // credited to the month of the EVENT it pays for, not the month it landed.
  const paidByBooking = {};
  verifiedPayments.forEach(p => {
    paidByBooking[p.booking_id] = (paidByBooking[p.booking_id] || 0) + (p.amount_paid || 0);
  });

  // Payments Received per PAYMENT month: every counted entry (receipts in,
  // refunds out), the same figure as the Payments Received card.
  const receivedByMonth = {};
  verifiedPayments.forEach(p => {
    if (!p.pay_datetime) return;
    const key = monthSortKey(new Date(p.pay_datetime));
    receivedByMonth[key] = (receivedByMonth[key] || 0) + (p.amount_paid || 0);
  });

  const byMonth = {};
  bookings.forEach(b => {
    if (!b.event_datetime) return;
    // A cancelled or rejected booking that FORFEITED its deposit counts for
    // that deposit alone — earned and paid, nothing owed — as on the cards
    // above. keptByBooking holds forfeited deposits only (reportMetrics).
    const kept = keptByBooking[b.booking_id] || 0;
    if (excludeStatuses.includes(b.booking_status) && kept <= 0) return;
    const when = new Date(b.event_datetime);
    if (Number.isNaN(when.getTime()) || when < floor) return; // no upper bound
    const key = monthSortKey(when);
    if (!byMonth[key]) byMonth[key] = { month: monthLabel(when), estimatedGrossRevenue: 0, paidToDate: 0 };
    if (kept > 0) {
      byMonth[key].estimatedGrossRevenue += kept;
      byMonth[key].paidToDate += kept;
      return;
    }
    byMonth[key].estimatedGrossRevenue += b.total_amount || 0;
    byMonth[key].paidToDate += paidByBooking[b.booking_id] || 0;
  });

  // A month with no events is a GAP, not a zero. Zero would draw the line down
  // to the axis and claim there was nothing to earn, when the truth is there
  // was nothing booked. The span is filled in so the axis stays continuous and
  // the chart can break each line across the empty month.
  const keys = Object.keys(byMonth).map(Number);
  const first = monthSortKey(floor);
  const last = keys.length ? Math.max(...keys) : first;

  const series = [];
  for (let key = first; key <= last; key++) {
    const hit = byMonth[key];
    const received = receivedByMonth[key] ?? null;
    series.push(hit
      ? {
          month: hit.month,
          estimatedGrossRevenue: hit.estimatedGrossRevenue,
          paymentsReceived: received,
          // Still owed on that month's services — the Collectible card's rule.
          collectible: Math.max(0, hit.estimatedGrossRevenue - hit.paidToDate),
        }
      : {
          month: monthLabel(new Date(Math.floor(key / 12), key % 12, 1)),
          estimatedGrossRevenue: null,
          paymentsReceived: received,
          collectible: null,
        });
  }
  return series;
};
