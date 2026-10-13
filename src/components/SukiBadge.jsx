// src/components/SukiBadge.jsx
//
// The small emerald "Suki" badge shown beside a suki (loyal) customer's name —
// in the Approve pop-ups, the Customers list and panel, and the Bookings and
// Short Orders lists. One component so it reads the same everywhere.
import { Star } from 'lucide-react';

export default function SukiBadge({ className = '' }) {
  return (
    <span
      title="Suki customer: may pay in installments"
      className={`inline-flex items-center gap-1 px-1.5 py-px rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-bold align-middle whitespace-nowrap ${className}`}
    >
      <Star size={10} className="fill-emerald-500 text-emerald-500" /> Suki
    </span>
  );
}
