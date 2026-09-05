// src/pages/Reports/DateRangeFilter.jsx
import { Check, X } from 'lucide-react';
import { DATE_RANGE_PRESETS, formatDate } from './helpers';

export default function DateRangeFilter({
  preset, customStart, customEnd, rangeStart, rangeEnd,
  onPresetChange, onCustomStartChange, onCustomEndChange, onClear,
}) {
  const isFiltered = preset !== 'All Time';

  // `min` on the end input stops the range being inverted from that side. This
  // covers the other side: moving the start past an end that is already set
  // would otherwise leave the pair impossible, and adding a matching `max` to
  // the start input would instead leave the manager stuck — unable to move the
  // range forward without clearing the end first. Carrying the end along keeps
  // the range valid and moving.
  const handleStartChange = (nextStart) => {
    onCustomStartChange(nextStart);
    if (nextStart && customEnd && customEnd < nextStart) onCustomEndChange(nextStart);
  };

  // A custom range with only one side filled matches nothing useful, so say so
  // rather than showing an empty table with no explanation.
  const isIncomplete = preset === 'Custom' && (!customStart || !customEnd);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className={`flex flex-wrap items-center gap-2 bg-white border rounded-lg p-2 transition-colors ${isFiltered ? 'border-emerald-300 ring-1 ring-emerald-100' : 'border-slate-200'}`}>
        {DATE_RANGE_PRESETS.map((p) => {
          const isActive = preset === p;
          return (
            <button
              key={p}
              onClick={() => onPresetChange(p)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-[#008A45] text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {isActive && <Check size={12} />}
              {p}
            </button>
          );
        })}
        {preset === 'Custom' && (
          <div className="flex items-center gap-2 pl-2 ml-1 border-l border-slate-200">
            <input
              type="date"
              value={customStart}
              onChange={(e) => handleStartChange(e.target.value)}
              aria-label="Range start date"
              className="border border-slate-300 rounded-md px-2 py-1 text-xs focus:ring-2 focus:ring-[#008A45] outline-none"
            />
            <span className="text-xs text-slate-400">to</span>
            {/* The trap: the calendar cannot offer a day before the start
                date, so an impossible range can't be built in the first place.
                Both inputs were previously unconstrained, and picking an end
                before the start produced a silently empty result set with
                nothing on screen to explain why. */}
            <input
              type="date"
              value={customEnd}
              min={customStart || undefined}
              onChange={(e) => onCustomEndChange(e.target.value)}
              aria-label="Range end date"
              className="border border-slate-300 rounded-md px-2 py-1 text-xs focus:ring-2 focus:ring-[#008A45] outline-none"
            />
          </div>
        )}
        {isFiltered && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors border-l border-slate-200 ml-1 pl-3"
          >
            <X size={12} />
            Clear Filter
          </button>
        )}
      </div>
      {/* Most pages now open on This Month rather than All Time, so this line
          stopped being a note about a filter someone applied and became the
          statement of what is on screen. Hence "Showing" rather than "Filter
          applied", and the period carried at full weight instead of trailing
          off in muted grey — a manager who does not notice the window will
          read a partial figure as the whole business.

          The dates are spelled out for the same reason the "next 7 days" card
          spells out its window: "This Month" alone leaves the reader to work
          out what it covers, and an empty table is alarming until you can see
          the period that produced it. */}
      <p className="text-[12.5px] font-medium text-slate-500 pr-1">
        {isIncomplete ? (
          <span className="text-amber-600 font-semibold">
            Pick {!customStart ? 'a start date' : 'an end date'} to apply this range
          </span>
        ) : isFiltered ? (
          <>
            Showing{' '}
            <span className="text-emerald-700 font-semibold">{preset}</span>
            {rangeStart && rangeEnd && (
              <span className="text-emerald-700 font-semibold">
                {' '}· {formatDate(rangeStart)} – {formatDate(rangeEnd)}
              </span>
            )}
          </>
        ) : (
          <>Showing <span className="font-semibold text-slate-600">all time</span> — every record, no date limit</>
        )}
      </p>
    </div>
  );
}
