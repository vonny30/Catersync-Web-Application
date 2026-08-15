// src/pages/Reports/SimpleDetailModal.jsx
import { createPortal } from 'react-dom';

const BADGE_STYLES = {
  neutral: 'bg-slate-100 text-slate-700 border-slate-200',
  good: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-100 text-amber-700 border-amber-200',
  danger: 'bg-red-100 text-red-700 border-red-200',
  info: 'bg-blue-100 text-blue-700 border-blue-200',
};

// A deliberately minimal record-detail modal: a title, an optional one-line
// explanation, an optional status badge, and a short list of key facts.
// Used everywhere a card or table row is clicked outside the Financial tab
// (which keeps its own full breakdown modal) so managers get a quick,
// uncluttered answer instead of another dense table.
export default function SimpleDetailModal({ isOpen, title, description, badge, fields = [], onClose }) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="flex justify-between items-start px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {description && <p className="text-xs text-slate-500 mt-1">{description}</p>}
            {badge && (
              <span className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${BADGE_STYLES[badge.variant] || BADGE_STYLES.neutral}`}>
                {badge.label}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          {fields.map((f) => (
            <div key={f.label} className="flex items-center justify-between gap-4">
              <span className="text-sm text-slate-500">{f.label}</span>
              <span className={`text-sm font-bold text-right ${f.emphasis ? 'text-[#008A45] text-base' : 'text-slate-900'}`}>{f.value}</span>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-5 py-2 rounded-lg border border-slate-300 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
