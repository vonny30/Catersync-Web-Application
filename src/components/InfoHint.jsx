// src/components/InfoHint.jsx
//
// A small (i) that explains ONE figure. Keyboard reachable, not hover-only:
// it opens on hover, on focus, and on click, so a manager tabbing through the
// page gets the same explanation a mouse user does.
//
// Deliberately rationed. An icon on every card is noise; this is for the one
// figure a reader would otherwise try to reconcile with the one beside it.
//
// It renders its own <button>, so place it OUTSIDE a clickable card rather
// than inside one — a button inside a button is invalid, and the click would
// go to the card instead.
import { useState } from 'react';
import { Info } from 'lucide-react';

export default function InfoHint({ label = 'What this figure includes', children, align = 'right' }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(o => !o)}
        className="flex items-center justify-center w-[18px] h-[18px] rounded-full text-slate-400 hover:text-[#007038] hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 transition-colors"
      >
        <Info size={13} />
      </button>
      {open && (
        <span
          role="tooltip"
          className={`absolute top-[26px] z-30 w-[260px] rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-[12.5px] font-normal leading-snug text-slate-700 shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
