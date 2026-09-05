// src/components/ModalTotal.jsx
//
// The figure a manager opened the modal to see, kept where they can always
// see it.
//
// Every record modal in this app puts its total in a <tfoot> — correct for a
// table, since the number lines up under the column it sums. But the table
// scrolls inside the modal and the total sits at the bottom of it, so on any
// list longer than the viewport the one number the modal exists to show is
// off-screen until you scroll to the end of it.
//
// This renders the same figure in the modal's action bar, which is `shrink-0`
// and therefore always visible. The <tfoot> stays: both are fed from ONE
// computed value at the call site rather than two copies of the same reduce,
// so the two cannot drift apart.
//
// Renders an empty span when there is nothing to show, so a `justify-between`
// action bar keeps its Close button hard right instead of centring it.
const TONES = {
  positive: 'text-emerald-700',
  negative: 'text-red-600',
  neutral: 'text-slate-900',
};

export default function ModalTotal({ label, value, tone = 'positive', hint }) {
  if (value === null || value === undefined) return <span />;
  return (
    <div className="flex items-baseline gap-2.5 min-w-0">
      <span className="text-[13px] font-semibold text-slate-600 whitespace-nowrap">{label}</span>
      <span className={`text-[19px] font-bold tracking-[-0.02em] tabular-nums whitespace-nowrap ${TONES[tone] || TONES.neutral}`}>
        {value}
      </span>
      {hint && <span className="text-xs text-slate-500 truncate">{hint}</span>}
    </div>
  );
}
