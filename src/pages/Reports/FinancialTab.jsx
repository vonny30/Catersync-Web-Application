// src/pages/Reports/FinancialTab.jsx
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { formatCurrency, formatDate, cardColorClasses } from './helpers';

const COLORS = ['#008A45', '#2d9b5e', '#5cb885', '#8cd4a8', '#b5e8ca', '#d4f0e0'];

export default function FinancialTab({ derived, onCardClick, onOpenDetail }) {
  const navigate = useNavigate();
  const { financialSummary, monthlyRevenueData, paymentMethodData, refunds, totalRefunded, bookingSummaryData } = derived;

  const goToBookingDetails = (id, type) => {
    if (!id) return;
    navigate(`/app/${type === 'Short Order' ? 'orders' : 'bookings'}/${id}`);
  };

  return (
    <>
      {/* Cash in, by payment date. Deliberately separated from the three
          event-anchored figures below it: this is the only card here that
          answers "how much money arrived in this period?", and it is the one
          that must agree with the Dashboard. */}
      <div className="bg-white border border-slate-200 border-l-4 border-l-[#008A45] rounded-2xl p-6 mb-4">
        <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Payments Received</p>
        <h3 className="text-3xl font-extrabold text-slate-900">{formatCurrency(financialSummary.paymentsReceived)}</h3>
        <p className="text-xs text-slate-500 font-medium mt-2">
          Cash received in this period, by payment date · net of refunds
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-xs">
          {financialSummary.retainedFromCancellations > 0 && (
            <span className="text-amber-700 font-medium">
              + {formatCurrency(financialSummary.retainedFromCancellations)} retained from cancellations
            </span>
          )}
          {financialSummary.refundsIssued > 0 && (
            <span className="text-slate-500">
              {formatCurrency(financialSummary.refundsIssued)} refunded in this period
            </span>
          )}
        </div>
      </div>

      {/* The event-anchored trio. These three reconcile with each other —
          contract value minus paid equals outstanding — which is exactly why
          they belong together and apart from the cash figure above. */}
      <p className="text-xs text-slate-500 mb-2">
        For events happening in this period, whenever they were paid for:
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          onClick={() => onCardClick('revenue')}
          className={`rounded-2xl p-6 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 border ${cardColorClasses('green')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Contract Value</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{formatCurrency(financialSummary.contractValue)}</h3>
          <p className="text-xs text-slate-500 font-medium mt-2">What those events are worth</p>
          <p className="text-[10px] text-emerald-600 font-semibold mt-2 opacity-0 hover:opacity-100 transition-opacity">Click to view breakdown →</p>
        </button>
        <button
          onClick={() => onCardClick('collected')}
          className={`rounded-2xl p-6 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 border ${cardColorClasses('teal')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Paid So Far</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{formatCurrency(financialSummary.paidAgainstEvents)}</h3>
          <p className="text-xs text-slate-500 font-medium mt-2">Paid against those events</p>
          <p className="text-[10px] text-emerald-600 font-semibold mt-2 opacity-0 hover:opacity-100 transition-opacity">Click to view breakdown →</p>
        </button>
        <button
          onClick={() => onCardClick('outstanding')}
          className={`rounded-2xl p-6 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 border ${cardColorClasses('amber')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Outstanding Balance</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{formatCurrency(financialSummary.outstanding)}</h3>
          <p className="text-xs text-slate-500 font-medium mt-2">Still to collect</p>
          <p className="text-[10px] text-emerald-600 font-semibold mt-2 opacity-0 hover:opacity-100 transition-opacity">Click to view breakdown →</p>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <h3 className="text-base font-bold text-slate-900 mb-4">Monthly Payments Received</h3>
        {monthlyRevenueData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-400 text-sm">No payment data available.</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyRevenueData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis tickFormatter={(value) => `₱${value.toLocaleString()}`} />
              <Tooltip formatter={(value) => [`₱${value.toLocaleString()}`, 'Collected']} labelFormatter={(label) => `Month: ${label}`} />
              <Legend />
              <Bar dataKey="revenue" fill="#008A45" radius={[4, 4, 0, 0]}>
                {monthlyRevenueData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <div className="mt-2 text-xs text-slate-500 text-right">Each bar is the total verified payments received in that month, net of refunds</div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200"><h3 className="text-base font-bold text-slate-900">Payment Methods</h3></div>
          {paymentMethodData.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No payments in this period.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                  <th className="p-3">Method</th>
                  <th className="p-3">Payments</th>
                  <th className="p-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {paymentMethodData.map((m) => (
                  <tr
                    key={m.method}
                    onClick={() => onOpenDetail({
                      title: m.method,
                      description: 'From the payment table: payments with this pay_method in the selected period.',
                      fields: [
                        { label: 'Total collected', value: formatCurrency(m.total), emphasis: true },
                        { label: 'Number of payments', value: m.count },
                      ],
                    })}
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="p-3 font-bold text-slate-900">{m.method}</td>
                    <td className="p-3 text-slate-600">{m.count}</td>
                    <td className="p-3 text-right font-semibold text-emerald-700">{formatCurrency(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">Refunds</h3>
            <span className="text-xs font-bold text-red-600">{formatCurrency(totalRefunded)} total</span>
          </div>
          {refunds.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">No refunds in this period.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                  <th className="p-3">Booking</th>
                  <th className="p-3">Date</th>
                  <th className="p-3">Method</th>
                  <th className="p-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {refunds.map((r) => (
                  <tr
                    key={r.payment_id}
                    onClick={() => onOpenDetail({
                      title: 'Refund',
                      description: `From the payment table: a negative amount_paid entry recorded ${formatDate(r.pay_datetime)}.`,
                      badge: { label: 'Refund', variant: 'danger' },
                      fields: [
                        { label: 'Booking', value: r.bookingRef || 'Unknown' },
                        { label: 'Amount refunded', value: formatCurrency(Math.abs(r.amount_paid)), emphasis: true },
                        { label: 'Method', value: r.pay_method || 'Unspecified' },
                      ],
                    })}
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="p-3">
                      {r.bookingRef ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); goToBookingDetails(r.booking_id, r.bookingType); }}
                          className="font-mono text-xs font-bold text-[#008A45] hover:underline inline-flex items-center gap-1 cursor-pointer"
                          title="View full booking details"
                        >
                          {r.bookingRef} <ExternalLink size={10} />
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Unknown</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-600">{formatDate(r.pay_datetime)}</td>
                    <td className="p-3 text-slate-600">{r.pay_method || 'Unspecified'}</td>
                    <td className="p-3 text-right font-semibold text-red-600">{formatCurrency(Math.abs(r.amount_paid))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-200"><h3 className="text-base font-bold text-slate-900">Monthly Booking Summary (Completed)</h3></div>
        {bookingSummaryData.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No completed bookings yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                  <th className="p-4">Month</th>
                  <th className="p-4">Completed Bookings</th>
                  <th className="p-4">Revenue</th>
                  <th className="p-4">Top Package</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
                {bookingSummaryData.slice(0, 3).map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => onOpenDetail({
                      title: row.month,
                      description: 'From the booking table: rows with booking_status = "Completed" and an event date in this month.',
                      fields: [
                        { label: 'Completed bookings', value: row.bookings, emphasis: true },
                        { label: 'Revenue', value: formatCurrency(row.revenue) },
                        { label: 'Top package', value: row.topPackage },
                      ],
                    })}
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="p-4 font-bold text-slate-900">{row.month}</td>
                    <td className="p-4">{row.bookings}</td>
                    <td className="p-4 font-semibold text-slate-900">{formatCurrency(row.revenue)}</td>
                    <td className="p-4">{row.topPackage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
