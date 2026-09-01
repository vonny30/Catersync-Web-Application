// src/utils/datetimeLocal.js
//
// One conversion, because getting it wrong is silent and cumulative.
//
// An `<input type="datetime-local">` holds a LOCAL wall clock — "2026-09-14T18:00"
// means six in the evening wherever the user is. `Date.prototype.toISOString()`
// returns a UTC one. Slicing the ISO string into the input therefore hands it a
// value that is off by the UTC offset: in the Philippines (UTC+8) an 18:00 event
// opens the form reading 10:00.
//
// The damage is not just the display. The manager opens Edit to fix a typo in
// the venue, saves without touching the date, and the save path parses that
// local-looking string back as local — so the event moves eight hours earlier
// and is written that way. Do it twice and a morning event crosses midnight
// onto the previous day, dropping out of every same-day availability check.
//
// The save direction was already correct everywhere: `new Date(value)` on a
// date-time string with no offset is defined to be local. Only the load
// direction was wrong, in four separate edit forms, so it lives here now.

/**
 * A Date (or timestamp string) as the value for an `<input type="datetime-local">`.
 * Returns '' for anything unparseable, which is what an empty input wants.
 */
export const toDateTimeLocalValue = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  // Shift by the offset so the UTC fields of `local` hold the LOCAL clock,
  // then slice. Cheaper and less error-prone than assembling the string by
  // hand, and it keeps the whole rule to one line.
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
};

/**
 * The inverse, for symmetry and so call sites can stop constructing it inline.
 * `new Date(v)` already reads a datetime-local value as local time — this exists
 * so the round trip is written down in one place rather than assumed.
 */
export const fromDateTimeLocalValue = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
