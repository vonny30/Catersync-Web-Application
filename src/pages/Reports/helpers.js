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

export const DATE_RANGE_PRESETS = ['All Time', 'This Month', 'This Year', 'Last 30 Days', 'Custom'];

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

// Returns { start: Date|null, end: Date|null } — null on either side means
// "unbounded" (used for 'All Time' or an incomplete custom range).
export function getRangeBounds(preset, customStart, customEnd) {
  const now = new Date();

  if (preset === 'This Month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end };
  }

  if (preset === 'This Year') {
    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { start, end };
  }

  if (preset === 'Last 30 Days') {
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  if (preset === 'Custom') {
    const start = customStart ? new Date(`${customStart}T00:00:00`) : null;
    const end = customEnd ? new Date(`${customEnd}T23:59:59.999`) : null;
    // DateRangeFilter traps the pickers so an end before a start can't be
    // chosen, but a value can still arrive inverted — typed directly into the
    // native input, restored from stale state, or set by a future caller. Swap
    // rather than returning a window that matches nothing: an empty table with
    // no explanation is the worst of the available answers, and a manager who
    // managed to invert the pair plainly meant the range between the two.
    if (start && end && end < start) {
      return {
        start: new Date(`${customEnd}T00:00:00`),
        end: new Date(`${customStart}T23:59:59.999`),
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
