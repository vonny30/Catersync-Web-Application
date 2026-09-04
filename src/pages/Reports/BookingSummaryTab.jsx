// src/pages/Reports/BookingSummaryTab.jsx
import { formatCurrency, cardColorClasses, cardAccentClass } from './helpers';

export default function BookingSummaryTab({ derived, onOpenDetail }) {
  const { bookingSummaryData } = derived;

  // Every row is already summed; the table just never showed the totals. These
  // are plain sums over the same rows rendered below, so the cards and the
  // table can never disagree.
  const totalCompleted = bookingSummaryData.reduce((sum, r) => sum + r.bookings, 0);
  const totalRevenue = bookingSummaryData.reduce((sum, r) => sum + r.revenue, 0);
  // Mean revenue per completed event -- revenue earned divided by the number of
  // events that earned it. Guarded so an empty period reads 0, not NaN.
  const avgPerEvent = totalCompleted > 0 ? totalRevenue / totalCompleted : 0;

  const CARD = `border rounded-2xl p-5 text-left ${cardColorClasses()}`;
  const LABEL = 'text-[13px] font-semibold text-slate-600 mb-2';
  const SUB = 'text-[13px] text-slate-600 mt-2.5';

  return (
    <div className="space-y-[18px]">
      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))]">
        <div className={CARD}>
          <span className={cardAccentClass('blue')} />
          <p className={LABEL}>Completed Events</p>
          <h3 className="text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">{totalCompleted}</h3>
          <p className={SUB}>Events in this period, now marked Completed</p>
        </div>
        <div className={CARD}>
          <span className={cardAccentClass('green')} />
          <p className={LABEL}>Revenue Earned</p>
          <h3 className="text-[26px] font-semibold tracking-[-0.03em] leading-[1.05] tabular-nums text-slate-900">{formatCurrency(totalRevenue)}</h3>
          <p className={SUB}>Contract value of those events</p>
        </div>
        <div className={CARD}>
          <span className={cardAccentClass('teal')} />
          <p className={LABEL}>Average per Event</p>
          <h3 className="text-[26px] font-semibold tracking-[-0.03em] leading-[1.05] tabular-nums text-slate-900">{formatCurrency(avgPerEvent)}</h3>
          <p className={SUB}>Revenue earned ÷ completed events</p>
        </div>
      </div>

    <div className="bg-white border border-slate-200/70 rounded-2xl overflow-hidden">
      <div className="px-5 pt-[18px] pb-4 border-b border-slate-100">
        {/* The qualifier lived in the heading AND the description. Saying it
            twice at two sizes is what made the header look cramped. */}
        <h3 className="text-base font-bold tracking-[-0.01em] text-slate-900">Historical Booking Summary</h3>
        <p className="text-[13.5px] text-slate-600 mt-1.5">Bookings whose <span className="font-semibold text-slate-700">event date</span> falls in the selected period and which are now marked Completed. The period filters the event, not the day it was marked.</p>
      </div>
      {bookingSummaryData.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-sm">No completed bookings found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#fbfcfd] border-b border-slate-100">
                {/* "Accounting Month" implied a closed accounting period, and
                    nothing in this system closes one — these rows are grouped by
                    the month the event happened in. "Gross Revenue" implied a
                    net figure exists to compare it against; with no cost data
                    anywhere, none does. */}
                <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Event Month</th>
                <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Completed Bookings</th>
                <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Revenue Earned</th>
                <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Top Package</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {bookingSummaryData.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => onOpenDetail({
                    title: row.month,
                    description: 'From the booking table: rows with booking_status = "Completed" and an event date in this month.',
                    fields: [
                      { label: 'Revenue', value: formatCurrency(row.revenue), emphasis: true },
                      { label: 'Completed bookings', value: row.bookings },
                      { label: 'Top package', value: row.topPackage },
                    ],
                  })}
                  className="hover:bg-[#fbfcfd] transition-colors cursor-pointer"
                >
                  <td className="px-5 py-[15px] text-[14.5px] font-semibold text-slate-900">{row.month}</td>
                  <td className="px-5 py-[15px] text-sm text-slate-800 text-right tabular-nums">{row.bookings}</td>
                  <td className="px-5 py-[15px] text-[14.5px] font-semibold text-slate-900 text-right tabular-nums whitespace-nowrap">{formatCurrency(row.revenue)}</td>
                  <td className="px-5 py-[15px]"><span className="px-2.5 py-[3px] bg-slate-100 text-slate-700 font-semibold text-[12.5px] rounded-full whitespace-nowrap">{row.topPackage}</span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[#fbfcfd] border-t border-slate-100">
                <td className="px-5 py-3.5 text-sm font-bold text-slate-900">Total</td>
                <td className="px-5 py-3.5 text-sm font-bold text-slate-900 text-right tabular-nums">{totalCompleted}</td>
                <td className="px-5 py-3.5 text-[14.5px] font-bold text-slate-900 text-right tabular-nums whitespace-nowrap">{formatCurrency(totalRevenue)}</td>
                <td className="px-5 py-3.5" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
    </div>
  );
}
