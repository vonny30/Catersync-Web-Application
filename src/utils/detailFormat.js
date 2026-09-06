// src/utils/detailFormat.js
//
// Display helpers for the Booking Details and Short Order Details pages.
//
// These live apart from components/DetailPrimitives.jsx deliberately: a file
// that exports both components and plain functions breaks Fast Refresh, and
// react-refresh/only-export-components says so. Splitting them keeps the
// component file component-only.

/** "AB" from a customer row, for the avatar. */
export function initialsOf(customer) {
  const a = (customer?.first_name || '').trim().charAt(0);
  const b = (customer?.last_name || '').trim().charAt(0);
  return ((a + b) || '?').toUpperCase();
}

export const fmtDateTime = (v) => (v ? new Date(v).toLocaleString() : 'N/A');

export const fmtShortDate = (v) => (
  v ? new Date(v).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'
);

export const fmtTime = (v) => (
  v ? new Date(v).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''
);

/**
 * Notes as a person should read them.
 *
 * The refund flow appends a machine-written marker —
 * "[REFUND] Amount: PHP 12500.00. <remarks>" — into `booking.notes`, which is
 * a user-facing field. It rendered verbatim on the detail page directly above
 * a Refund History card that states the same thing properly.
 *
 * Stripped from DISPLAY only. The stored value is left alone: `notes` is
 * shared with the customer mobile app, and rewriting rows to tidy a heading
 * would be changing their data to fix our layout. Any remark the manager typed
 * after the marker is kept — only the marker itself goes.
 */
export function displayNotes(notes) {
  if (!notes) return '';
  return notes
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*\[REFUND\]\s*Amount:\s*₱?[\d,.]+\.?\s*/i, '').trim())
    .filter(line => line.length > 0)
    .join('\n');
}
