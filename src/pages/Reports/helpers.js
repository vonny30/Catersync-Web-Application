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
