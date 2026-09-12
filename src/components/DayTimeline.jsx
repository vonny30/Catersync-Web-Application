// src/components/DayTimeline.jsx
//
// One track of a day timeline: gridlines, open windows, and the blocks sitting
// on it. Extracted from pages/Vehicles.jsx so the approval panel can draw the
// same picture rather than a lookalike — see utils/timeline.js for why the
// colour vocabulary is shared rather than copied.
//
// Deliberately just the TRACK. The Vehicles page wraps it with a plate column,
// a now-line and a legend; the approval strip wraps it with a plate and a
// verdict. Folding those into one component would mean a pile of flags for
// layout that is genuinely different on the two screens; what must not differ
// is the geometry and the colour, and that is what lives here.
import { OPEN_FILL } from '../utils/timeline';

/**
 *  ticks         [{ hour, pct }] from makeAxis
 *  blocks        [{ key, left, width, tone, title, primary, secondary,
 *                   onClick, clash, dashed, lane, compactLabel }]
 *                `lane` is 'top' | 'bottom' — two bands inside one track. On a
 *                compact strip a proposed run drawn at full height simply
 *                covers the committed run it overlaps, hiding the very fact the
 *                strip exists to show, and clipping that block's label to
 *                "BK". In separate bands the two cross visibly instead.
 *  openWindows   [{ left, width, label, title }] — omit for a read-only strip
 *  emptyLabel    shown centred when there are no blocks at all
 *  overlay       { text, className } — replaces the contents entirely
 *                (an out-of-service vehicle has empty hours nobody may book)
 *  compact       shorter track, single-line blocks — for the approval modal,
 *                which already scrolls
 */
export default function TimelineTrack({
  ticks = [],
  blocks = [],
  openWindows = [],
  emptyLabel = null,
  overlay = null,
  compact = false,
  clash = false,
}) {
  const laned = compact && blocks.some(b => b.lane);
  const height = laned ? 'h-[40px]' : compact ? 'h-[34px]' : 'h-[52px]';
  const inset = compact ? 'top-[3px] bottom-[3px]' : 'top-[5px] bottom-[5px]';
  const openInset = compact ? 'top-[5px] bottom-[5px]' : 'top-[7px] bottom-[7px]';
  const insetFor = (lane) =>
    lane === 'top' ? 'top-[3px] h-[16px]'
      : lane === 'bottom' ? 'bottom-[3px] h-[16px]'
        : inset;

  return (
    <div className={`relative flex-1 ${height} rounded-[9px] border ${
      clash ? 'border-red-200 bg-red-50/40' : overlay ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'
    }`}>
      {ticks.map(t => (
        <span key={t.hour} className="absolute top-0 bottom-0 w-px bg-slate-100" style={{ left: `${t.pct}%` }} aria-hidden="true" />
      ))}

      {overlay ? (
        <span className={`absolute inset-0 flex items-center justify-center text-[12.5px] font-semibold ${overlay.className || 'text-slate-500'}`}>
          {overlay.text}
        </span>
      ) : (
        <>
          {openWindows.map((w, i) => (
            <span
              key={`open-${i}`}
              title={w.title}
              className={`absolute ${openInset} rounded-[6px] border border-[#e7edf3] flex items-center justify-center overflow-hidden`}
              style={{ left: `${w.left}%`, width: `${w.width}%`, background: OPEN_FILL }}
            >
              {/* Suppressed when there are no blocks at all: the hatch then
                  spans the whole row and its label would print underneath the
                  empty-state line. */}
              {w.label && w.width > 11 && blocks.length > 0 && (
                <span className="text-[11px] text-slate-400 tabular-nums whitespace-nowrap px-1">{w.label}</span>
              )}
            </span>
          ))}

          {blocks.length === 0 && emptyLabel && (
            <span className="absolute inset-0 flex items-center justify-center text-[12.5px] font-semibold text-slate-500 pointer-events-none">
              {emptyLabel}
            </span>
          )}

          {blocks.map(b => {
            const style = {
              left: `${b.left}%`,
              width: `${b.width}%`,
              background: b.tone.bg,
              borderColor: b.tone.bd,
              color: b.tone.fg,
            };
            const cls = `absolute ${insetFor(b.lane)} rounded-[5px] border ${b.dashed ? 'border-dashed' : ''} ${compact ? 'px-1' : 'px-2'} flex ${
              compact ? 'items-center' : 'flex-col justify-center items-start'
            } overflow-hidden text-left ${b.clash ? 'ring-1 ring-red-400' : ''}`;
            // A label only earns its place if the block is wide enough to hold
            // it. Below that, the tint carries the leg (the legend names the
            // colours), the band carries whether it is committed or proposed,
            // and the title carries the full sentence on hover — all of which
            // beat a truncated "BK".
            // Checked against undefined, not truthiness: a block that sets
            // compactLabel to '' is asking for NO label (its band already
            // identifies it), and `|| b.primary` would hand it back the long
            // one it just declined.
            const label = compact && b.compactLabel !== undefined ? b.compactLabel : b.primary;
            // The full-size timeline needs the same threshold the compact strip
            // has. A short-order delivery is 75 minutes on a 24-hour axis — a
            // 61px block with 43px of text space — and its two lines need 76px
            // and 140px. Both rendered, clipped to a few characters each, which
            // reads as a broken box rather than a short trip. The block's own
            // title carries the full sentence on hover either way.
            const showLabel = (compact ? b.width >= 9 : b.width >= 8) && !!label;
            const showSecondary = !compact && b.secondary && b.width >= 14;
            const inner = (
              <>
                {showLabel && (
                <span className={`${compact ? 'text-[9px]' : 'text-[11.5px]'} font-bold leading-none truncate w-full`}>
                  {label}
                </span>
                )}
                {showSecondary && (
                  <span className="text-[10.5px] leading-tight truncate w-full opacity-80 tabular-nums">
                    {b.secondary}
                  </span>
                )}
              </>
            );
            return b.onClick ? (
              <button
                key={b.key}
                type="button"
                onClick={b.onClick}
                title={b.title}
                className={`${cls} cursor-pointer transition-shadow hover:shadow-[0_2px_8px_rgba(15,23,42,0.12)]`}
                style={style}
              >
                {inner}
              </button>
            ) : (
              <span key={b.key} title={b.title} className={cls} style={style}>
                {inner}
              </span>
            );
          })}
        </>
      )}
    </div>
  );
}
