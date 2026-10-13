// src/components/InstallmentChip.jsx
//
// The small "Installment" chip on a booking paid on an installment plan — in
// the Bookings and Short Orders lists and the customer panel's bookings tab.
import { CalendarClock } from 'lucide-react';

export default function InstallmentChip({ className = '' }) {
  return (
    <span
      title="Paid on an installment plan"
      className={`inline-flex items-center gap-1 px-1.5 py-px rounded-full bg-sky-50 border border-sky-200 text-sky-700 text-[11px] font-bold whitespace-nowrap ${className}`}
    >
      <CalendarClock size={10} /> Installment
    </span>
  );
}
