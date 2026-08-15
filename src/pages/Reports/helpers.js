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

// Shared card color palette so stat cards across every tab look like the
// same family as the original Financial cards, instead of flat gray boxes.
// Each entry supplies the resting background/border and a slightly deeper
// hover state, matching the Financial tab's existing button-card pattern.
export const CARD_COLORS = {
  green: {
    bg: 'bg-[#EAF3F2]', border: 'border-[#d2e8e5]',
    hoverBorder: 'hover:border-emerald-300', hoverBg: 'hover:bg-[#dcefed]',
  },
  blue: {
    bg: 'bg-blue-50', border: 'border-blue-200',
    hoverBorder: 'hover:border-blue-300', hoverBg: 'hover:bg-blue-100',
  },
  amber: {
    bg: 'bg-amber-50', border: 'border-amber-200',
    hoverBorder: 'hover:border-amber-300', hoverBg: 'hover:bg-amber-100',
  },
  red: {
    bg: 'bg-red-50', border: 'border-red-200',
    hoverBorder: 'hover:border-red-300', hoverBg: 'hover:bg-red-100',
  },
  purple: {
    bg: 'bg-purple-50', border: 'border-purple-200',
    hoverBorder: 'hover:border-purple-300', hoverBg: 'hover:bg-purple-100',
  },
  teal: {
    bg: 'bg-teal-50', border: 'border-teal-200',
    hoverBorder: 'hover:border-teal-300', hoverBg: 'hover:bg-teal-100',
  },
};

export function cardColorClasses(color = 'green') {
  const c = CARD_COLORS[color] || CARD_COLORS.green;
  return `${c.bg} ${c.border} ${c.hoverBorder} ${c.hoverBg}`;
}
