// src/pages/Reports/DateRangeFilter.jsx
import { Check, X } from 'lucide-react';
import { DATE_RANGE_PRESETS, formatDate } from './helpers';

export default function DateRangeFilter({
  preset, customStart, customEnd, rangeStart, rangeEnd,
  onPresetChange, onCustomStartChange, onCustomEndChange, onClear,
}) {
  const isFiltered = preset !== 'All Time';

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
              onChange={(e) => onCustomStartChange(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1 text-xs focus:ring-2 focus:ring-[#008A45] outline-none"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => onCustomEndChange(e.target.value)}
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
      <p className="text-xs font-medium text-slate-500 pr-1">
        {isFiltered ? (
          <>
            <span className="text-emerald-600 font-semibold">Filter applied:</span>{' '}
            {preset}
            {rangeStart && rangeEnd && <> ({formatDate(rangeStart)} – {formatDate(rangeEnd)})</>}
          </>
        ) : (
          'Showing all-time data'
        )}
      </p>
    </div>
  );
}
