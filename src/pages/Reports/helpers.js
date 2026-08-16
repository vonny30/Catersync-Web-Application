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

// Shared card color palette so stat cards across every Reports tab share the
// same white-card-with-accent look as the Dashboard stat cards and the rest
// of the app, instead of each tab having its own flat pastel-filled boxes.
// Each entry supplies a colored left accent border and a matching value
// color; the card itself stays white for consistent contrast against the
// page's slate-50 shell.
export const CARD_COLORS = {
  green: {
    bg: 'bg-white', border: 'border-slate-200 border-l-4 border-l-[#008A45]',
    hoverBorder: 'hover:border-slate-300', hoverBg: 'hover:bg-slate-50',
    value: 'text-[#008A45]',
  },
  blue: {
    bg: 'bg-white', border: 'border-slate-200 border-l-4 border-l-blue-500',
    hoverBorder: 'hover:border-slate-300', hoverBg: 'hover:bg-slate-50',
    value: 'text-blue-600',
  },
  amber: {
    bg: 'bg-white', border: 'border-slate-200 border-l-4 border-l-amber-500',
    hoverBorder: 'hover:border-slate-300', hoverBg: 'hover:bg-slate-50',
    value: 'text-amber-600',
  },
  red: {
    bg: 'bg-white', border: 'border-slate-200 border-l-4 border-l-red-500',
    hoverBorder: 'hover:border-slate-300', hoverBg: 'hover:bg-slate-50',
    value: 'text-red-600',
  },
  purple: {
    bg: 'bg-white', border: 'border-slate-200 border-l-4 border-l-violet-500',
    hoverBorder: 'hover:border-slate-300', hoverBg: 'hover:bg-slate-50',
    value: 'text-violet-600',
  },
  teal: {
    bg: 'bg-white', border: 'border-slate-200 border-l-4 border-l-teal-600',
    hoverBorder: 'hover:border-slate-300', hoverBg: 'hover:bg-slate-50',
    value: 'text-teal-700',
  },
};

export function cardColorClasses(color = 'green') {
  const c = CARD_COLORS[color] || CARD_COLORS.green;
  return `${c.bg} ${c.border} ${c.hoverBorder} ${c.hoverBg}`;
}

export function cardValueClass(color = 'green') {
  return (CARD_COLORS[color] || CARD_COLORS.green).value;
}
