// src/pages/Reports/BookingSummaryTab.jsx
import { formatCurrency } from './helpers';

export default function BookingSummaryTab({ derived, onOpenDetail }) {
  const { bookingSummaryData } = derived;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-200">
        <h3 className="text-base font-bold text-slate-900">Historical Booking Summary – Completed Events Only</h3>
        <p className="text-xs text-slate-500 mt-1">Includes only bookings that have been marked as Completed, within the selected period.</p>
      </div>
      {bookingSummaryData.length === 0 ? (
        <div className="p-8 text-center text-slate-400 text-sm">No completed bookings found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                {/* "Accounting Month" implied a closed accounting period, and
                    nothing in this system closes one — these rows are grouped by
                    the month the event happened in. "Gross Revenue" implied a
                    net figure exists to compare it against; with no cost data
                    anywhere, none does. */}
                <th className="p-4">Event Month</th>
                <th className="p-4">Total Completed Bookings</th>
                <th className="p-4">Revenue Earned</th>
                <th className="p-4">Top Package</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
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
                  className="hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <td className="p-4 font-bold text-slate-900">{row.month}</td>
                  <td className="p-4 text-slate-700 font-medium">{row.bookings} Completed</td>
                  <td className="p-4 font-bold text-slate-900">{formatCurrency(row.revenue)}</td>
                  <td className="p-4"><span className="px-2.5 py-1 bg-slate-200 text-slate-800 font-semibold text-xs rounded-full">{row.topPackage}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
