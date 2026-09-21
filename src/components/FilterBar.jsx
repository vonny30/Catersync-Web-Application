// src/components/FilterBar.jsx
//
// One filter system, the same on every page.
//
// Top to bottom, every page reads: page title · FilterBar · (QuickFilters) ·
// (PeriodTitle) · cards · table. Nothing filter-related lives anywhere else —
// not beside the cards, not above the table, not in a sidebar. These three
// components exist so that placement and style are identical by construction
// rather than by copying markup from page to page.
import { X, Search } from 'lucide-react';

/**
 * The filter bar: one row. Period first (where the page has one), then
 * Search, then the page's other filters, then Clear filters — shown only when
 * something differs from its default, and resetting everything in one click.
 */
export function FilterBar({ children, canClear = false, onClear }) {
  return (
    <div className="flex flex-wrap items-end gap-3 bg-white rounded-2xl border border-slate-200/70 px-4 py-3.5">
      {children}
      {canClear && (
        <button
          type="button"
          onClick={onClear}
          className="ml-auto flex items-center gap-1 self-center rounded-[10px] px-3 py-2 text-[13px] font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 transition-colors"
        >
          <X size={13} /> Clear filters
        </button>
      )}
    </div>
  );
}

/** A labelled slot in the bar, so every control carries its label the same way. */
export function FilterField({ label, active = false, children }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={`text-[12.5px] font-semibold ${active ? 'text-[#007038]' : 'text-slate-600'}`}>{label}</span>
      {children}
    </div>
  );
}

/** Quick-filter chips: the second row, directly under the bar. */
export function QuickFilters({ children }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>;
}

/**
 * The period title — the one place a page names the month its figures cover.
 * Only on pages whose figures depend on a period, or have a fixed one
 * ("All time" on Customers). Cards never repeat it.
 */
export function PeriodTitle({ children }) {
  return <h2 className="text-[22px] font-bold tracking-[-0.02em] text-slate-900 leading-tight">{children}</h2>;
}

/**
 * What an empty result shows: "No results", and a way back — nothing else.
 * The Clear filters action appears only when a filter is actually active;
 * offering it on an unfiltered empty list would promise results it cannot
 * bring back.
 */
export function EmptyResult({ canClear = false, onClear, className = 'py-8' }) {
  return (
    <div className={`flex flex-col items-center gap-2 text-center ${className}`}>
      <p className="text-sm text-slate-500">No results</p>
      {canClear && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="text-[13px] font-semibold text-[#007038] hover:underline"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

/**
 * Filters inside a pop-up — one rule for every pop-up in the app.
 *
 * Search, then the pop-up's type or status selects, then Clear filters when
 * something is set. NEVER a date or Period control: a pop-up lists the rows
 * behind a figure on the page, and it uses the page's period. A second period
 * inside the pop-up could move independently and leave the rows out of step
 * with the figure that was clicked.
 */
export function PopupFilters({ search, onSearch, searchPlaceholder = 'Search', canClear = false, onClear, children }) {
  return (
    <div className="px-6 py-3 border-b border-slate-200 shrink-0 flex flex-wrap items-center gap-3">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className={`w-full pl-8 pr-3 py-1.5 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${search.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
        />
      </div>
      {children}
      {canClear && (
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 text-[13px] font-semibold text-slate-600 hover:text-red-600 transition-colors"
        >
          <X size={13} /> Clear filters
        </button>
      )}
    </div>
  );
}

/** The class every select inside a pop-up uses. */
export const popupSelectClass = (active) =>
  `border rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${active ? 'border-emerald-300' : 'border-slate-300'}`;
