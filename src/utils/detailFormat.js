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
