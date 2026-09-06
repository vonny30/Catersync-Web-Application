// src/components/DetailPrimitives.jsx
//
// The shared shell for the Booking Details and Short Order Details pages.
//
// Both pages ran a 5/7 split: twelve label/value rows on the left against four
// or five list cards on the right — roughly a 1:4 content ratio. The left rail
// ended a third of the way down and everything below it was blank, while the
// values inside it were squeezed into ~280px, so a full venue address wrapped
// to two lines in the same width that "120" was wasting.
//
// The fix is to stop putting facts in a rail. `Field` stacks its label ABOVE
// its value, so the value gets the whole cell instead of two thirds of a narrow
// column, and the facts run full-width across the page.
//
// Both pages import these rather than keeping their own copies — the field
// markup alone repeated eleven times across the two files.

// Section heading: neutral icon chip, then the title.
//
// The old cards carried green left borders at four different weights
// (/30, /50, solid, none) across five cards, which read as a status indicator
// that it was not. Icon chips are all the same neutral slate: they separate
// sections without colour-coding them.
export function SectionHeader({ icon: Icon, title, children }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-[18px]">
      <div className="flex items-center gap-[11px] min-w-0">
        <span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px] bg-[#f4f6f8] text-slate-600 shrink-0">
          <Icon size={17} />
        </span>
        <h3 className="text-[15px] font-bold tracking-[-0.015em] text-slate-900 truncate">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export function SectionCard({ children, className = '' }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-2xl p-[clamp(20px,2.2vw,24px)] shadow-xs ${className}`}>
      {children}
    </div>
  );
}

/**
 * The scrollable body of a list card.
 *
 * Wraps ONLY the rows — the card's header and any footer or total stay outside
 * it, so they remain visible while the list scrolls. That is the whole reason
 * this is a separate element rather than a prop on SectionCard: a card that
 * scrolled as a whole would take its own title out of view.
 *
 * `max-h`, never a fixed `h`: a two-item list is shorter than the cap, so it
 * renders at its natural height with no scrollbar and no reserved space. The
 * cap only engages on a record long enough to run away with the page.
 *
 * `overscroll-contain` stops a scroll that reaches the end of this list from
 * continuing into the page behind it.
 */
export function CardScrollArea({ children, className = '', max = '300px' }) {
  return (
    <div className={`overflow-y-auto overscroll-contain ${className}`} style={{ maxHeight: max }}>
      {children}
    </div>
  );
}

/**
 * One label/value fact.
 *
 * `wide` spans two columns, but only from 820px up. At the two-column step a
 * spanning field hands a whole row to a short string, which is the cramping
 * this layout exists to remove, in a different shape.
 *
 * The label is slate-600 rather than the slate-400 these micro-labels usually
 * take: on a white card at 10.5px, slate-400 sits below comfortable reading
 * contrast, and Vaughn asked for the headers darker.
 */
export function Field({ label, value, children, wide = false }) {
  return (
    <div className={wide ? 'min-[820px]:col-span-2' : ''}>
      <span className="block text-[10.5px] font-bold tracking-[0.1em] uppercase text-slate-600">{label}</span>
      <div className="mt-[5px] text-[14.5px] font-semibold leading-[1.4] text-slate-900 [text-wrap:pretty]">
        {children ?? value}
      </div>
    </div>
  );
}

/** A row inside a list card — menu items, equipment, ledger entries. */
export function ListRow({ children, className = '' }) {
  return (
    <div className={`flex justify-between items-center gap-3 px-3.5 py-[11px] bg-[#fbfcfd] border border-[#eef2f6] rounded-[11px] ${className}`}>
      {children}
    </div>
  );
}
