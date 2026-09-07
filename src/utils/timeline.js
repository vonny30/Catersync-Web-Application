// src/utils/timeline.js
//
// The colour vocabulary and geometry behind every "trips laid on a day" view.
//
// This was inline in pages/Vehicles.jsx and nowhere else, so the moment a
// second screen needed the same picture — the approval panel, which has to show
// WHY a vehicle is unavailable — the only options were to import from a page or
// to write the tints a second time. A second copy of LEG_TONE is precisely how
// two screens end up disagreeing about what amber means.
//
// Pure module: no JSX, no React. The components that draw with it live in
// components/DayTimeline.jsx, kept apart so neither file mixes component and
// non-component exports (the react-refresh rule DetailPrimitives.jsx was split
// for).

// ---------------------------------------------------------------------------
// COLOUR
//
// Three legs need telling apart, but every block already carries its leg NAME,
// so hue is the second cue and never the first. These tints are deliberately
// near-grey: the only saturated colours on these screens are the ones that mean
// something — brand green for what is ours and running, amber for out of
// service, red for a clash or a late return. A leg is not a status and must not
// compete with them.
// ---------------------------------------------------------------------------
export const LEG_TONE = {
  'Setup run':      { bg: '#eef3f9', bd: '#cfdcea', fg: '#33506e' },
  'Collection run': { bg: '#faf5ec', bd: '#e6dabf', fg: '#6a5426' },
  Delivery:         { bg: '#f2f0f8', bd: '#d7d2e8', fg: '#474070' },
};

/** A run already back at base. Drained of hue: it is history, not a plan. */
export const BACK_TONE = { bg: '#f1f4f7', bd: '#dde3ea', fg: '#64748b' };

/**
 * The run being PROPOSED but not yet committed — the approval panel's own
 * booking. Brand green, because unlike a leg tint this genuinely is a status:
 * it is the one block on the strip that does not exist yet.
 */
export const PROPOSED_TONE = { bg: '#EAF3F2', bd: '#008A45', fg: '#00603a' };

export const toneFor = (legLabel, completed) =>
  completed ? BACK_TONE : (LEG_TONE[legLabel] || LEG_TONE['Setup run']);

/**
 * Diagonal hatching, not a flat fill. An open window is the ABSENCE of a
 * commitment; a solid band beside the solid trip blocks reads as one more thing
 * booked into the day.
 */
export const OPEN_FILL =
  'repeating-linear-gradient(135deg, #f8fafc 0px, #f8fafc 5px, #eef2f7 5px, #eef2f7 10px)';

// ---------------------------------------------------------------------------
// GEOMETRY
// ---------------------------------------------------------------------------

/** "4 AM", "1 PM" — never the bare 24-hour number the first version printed. */
export const fmtHourTick = (h) => {
  const ampm = h >= 12 && h < 24 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
};

/**
 * A fixed day scale.
 *
 * Fixed, not fitted to the widest trip of the day, so a block sits in the same
 * place from one date to the next — a bar that rescales itself cannot be
 * compared against yesterday's.
 *
 * Callers pass 0..24. An earlier 4..23 window was chosen as "the hours anything
 * actually happens in", and it quietly dropped work: a collection run leaving
 * 10 PM is back at 1 AM the NEXT day, and on that next day its whole 00:00-01:00
 * span fell before the axis, so blockGeometry returned null and the trip
 * vanished from a schedule that had already decided to show it.
 */
export const makeAxis = (dayStart, startHour, endHour, tickEvery = 3) => {
  const start = new Date(dayStart.getTime() + startHour * 3600 * 1000);
  const end = new Date(dayStart.getTime() + endHour * 3600 * 1000);
  const ms = end - start;
  const ticks = [];
  // Strictly less than endHour: on a 0..24 axis a tick exactly at 24 renders a
  // second "12 AM" jammed against the right edge, reading as a second midnight
  // rather than the end of this one.
  for (let h = startHour; h < endHour; h += tickEvery) {
    ticks.push({ hour: h, label: fmtHourTick(h), pct: ((h - startHour) / (endHour - startHour)) * 100 });
  }
  return {
    start,
    end,
    ms,
    ticks,
    startHour,
    endHour,
    pctOf: (instantMs) => ((instantMs - start.getTime()) / ms) * 100,
  };
};

/**
 * Where one window sits on the axis, or null if it misses the axis entirely.
 *
 * Clamps, never drops: a run finishing after the scale must still render, since
 * a trip that silently vanishes off the axis is worse than one drawn short.
 * `minWidthPct` keeps a 90-minute delivery from becoming an invisible sliver
 * that reads as an open day, and the result is never allowed past the right
 * edge.
 */
export const blockGeometry = (axis, startMs, endMs, minWidthPct = 6) => {
  const from = Math.max(startMs, axis.start.getTime());
  const to = Math.min(endMs, axis.end.getTime());
  if (to <= from) return null;
  const left = axis.pctOf(from);
  const width = Math.min(100 - left, Math.max(minWidthPct, axis.pctOf(to) - left));
  return {
    left,
    width,
    clippedStart: startMs < axis.start.getTime(),
    clippedEnd: endMs > axis.end.getTime(),
  };
};
