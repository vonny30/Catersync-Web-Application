// src/pages/Reports/FinancialTab.jsx
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { formatCurrency, formatPercent, formatDate } from './helpers';

export default function FinancialTab({ derived, onCardClick, onOpenDetail }) {
  const navigate = useNavigate();
  const { financialSummary, monthlyRevenueData, paymentMethodData, refunds, totalRefunded, bookingSummaryData } = derived;

  // Share of contracted value that has been paid. BOTH sides are event-anchored
  // (contract value and payments against those same events), so the ratio is
  // like-for-like. It deliberately does NOT use paymentsReceived: that figure
  // is anchored on payment date and counts cash from events outside this
  // period, so dividing it by this period's contract value would compare two
  // different populations and produce a number that means nothing.
  const collectedPct = financialSummary.contractValue > 0
    ? (financialSummary.paidAgainstEvents / financialSummary.contractValue) * 100
    : 0;

  // Shared class string for the three event-anchored figures.
  const FIG = 'block text-[21px] font-semibold tracking-[-0.02em] tabular-nums';

  const goToBookingDetails = (id, type) => {
    if (!id) return;
    navigate(`/app/${type === 'Short Order' ? 'orders' : 'bookings'}/${id}`);
  };

  return (
    <>
      {/* One section instead of four hero cards, but the two anchors stay
          visually separated by a rule and each keeps its own heading.
          Collapsing them into a single undifferentiated block is what
          reportMetrics.js warns against: cash received in a period and the
          value of events in that period are different questions, and the page
          disagreed with the Dashboard for exactly that reason. */}
      <section className="bg-white border border-slate-200/70 rounded-2xl p-6 mb-[18px]">
        <div>
          <span className="block text-[13px] font-semibold text-slate-600 mb-2.5">Payments Received</span>
          <span className="block text-[38px] font-semibold tracking-[-0.035em] leading-none tabular-nums text-slate-900">
            {formatCurrency(financialSummary.revenueReceived)}
          </span>
          <span className="block text-[13.5px] text-slate-600 mt-3">
            Cash received in this period on confirmed &amp; completed bookings, by payment date
            {financialSummary.refundsNettedAgainstReceived > 0
              ? ` — net of ${formatCurrency(financialSummary.refundsNettedAgainstReceived)} refunded`
              : ''}
          </span>
          {/* The two figures the headline excludes. Both are real cash, so
              neither is dropped: one is on a booking not yet confirmed, the
              other was kept when a booking was cancelled. Stated rather than
              folded in, and in the same order on all three pages that show
              this number. */}
          {financialSummary.awaitingConfirmation > 0 && (
            <span className="block text-[13px] text-slate-600 mt-1.5">
              A further {formatCurrency(financialSummary.awaitingConfirmation)} is awaiting confirmation.
            </span>
          )}
          {financialSummary.retainedFromCancellations > 0 && (
            <span className="block text-[13px] text-slate-600 mt-1.5">
              A further {formatCurrency(financialSummary.retainedFromCancellations)} was retained from cancelled bookings.
            </span>
          )}
        </div>

        <div className="h-px bg-slate-100 my-[22px]" />

        <div>
          <span className="block text-[13px] font-bold text-slate-600 tracking-[0.04em] mb-4">
            Events happening in this period
          </span>
          <div className="flex flex-wrap gap-8">
            <button onClick={() => onCardClick('revenue')} className="text-left rounded-lg focus:outline-none focus:ring-2 focus:ring-[#008A45]/40">
              <span className="block text-[13px] text-slate-600 mb-1.5">Contract Value</span>
              <span className={`${FIG} text-slate-900`}>{formatCurrency(financialSummary.contractValue)}</span>
            </button>
            <button onClick={() => onCardClick('collected')} className="text-left rounded-lg focus:outline-none focus:ring-2 focus:ring-[#008A45]/40">
              <span className="block text-[13px] text-slate-600 mb-1.5">Paid to Date</span>
              <span className={`${FIG} text-slate-900`}>{formatCurrency(financialSummary.paidAgainstEvents)}</span>
            </button>
            <button onClick={() => onCardClick('outstanding')} className="text-left rounded-lg focus:outline-none focus:ring-2 focus:ring-[#008A45]/40">
              <span className="block text-[13px] text-slate-600 mb-1.5">Unpaid on These Events</span>
              <span className={`${FIG} text-amber-700`}>{formatCurrency(financialSummary.outstanding)}</span>
            </button>
          </div>

          {/* The relationship the three separate cards never showed. Width is
              clamped at 100% so an overpaid booking cannot render a bar wider
              than its track, while the printed percentage stays truthful. */}
          <div className="mt-[22px] mb-2.5 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-[#008A45]" style={{ width: `${Math.min(100, Math.max(0, collectedPct))}%` }} />
          </div>
          {/* The figure alone invites "where does that number come from?", so
              the division that produced it is printed underneath in the same
              two amounts shown above. Both sides are event-anchored, which is
              what makes the ratio meaningful. */}
          {financialSummary.contractValue > 0 ? (
            <>
              <span className="block text-[13px] text-slate-600 tabular-nums">
                {formatPercent(collectedPct)} of contract value paid for these events
              </span>
              <span className="block text-[12.5px] text-slate-500 mt-1 tabular-nums">
                {formatCurrency(financialSummary.paidAgainstEvents)} paid ÷ {formatCurrency(financialSummary.contractValue)} contract value
              </span>
            </>
          ) : (
            <span className="block text-[13px] text-slate-600">
              No events fall in this period, so there is no contract value to measure against.
            </span>
          )}
        </div>
      </section>

      <div className="bg-white border border-slate-200/70 rounded-2xl p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
          <h3 className="text-base font-bold tracking-[-0.01em] text-slate-900">Payments received by month</h3>
          <span className="text-[13px] text-slate-600">Refunds already subtracted</span>
        </div>
        {monthlyRevenueData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-400 text-sm">No payment data available.</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyRevenueData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 13, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
              <YAxis tickFormatter={(value) => `₱${value.toLocaleString()}`} tick={{ fontSize: 13, fill: '#475569' }} tickLine={false} axisLine={false} width={90} />
              <Tooltip formatter={(value) => [`₱${value.toLocaleString()}`, 'Collected']} labelFormatter={(label) => `Month: ${label}`} />
              {/* Six rotating greens carried no meaning -- adjacent months were
                  different colours for no reason. One neutral fill for history
                  and brand green for the most recent month, so "now" is the
                  only thing the colour marks. */}
              <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                {monthlyRevenueData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index === monthlyRevenueData.length - 1 ? '#008A45' : '#cbd5e1'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        <p className="mt-2 text-[13px] text-slate-600">Each bar is the verified payments taken that month, net of any refunds issued in the same month — so a month can read lower than the payments alone, or go negative.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200/70 rounded-2xl overflow-hidden">
          <div className="px-5 pt-[18px] pb-4 border-b border-slate-100"><h3 className="text-base font-bold tracking-[-0.01em] text-slate-900">Payment Methods</h3></div>
          {paymentMethodData.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">No payments in this period.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fbfcfd] border-b border-slate-100">
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Method</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Payments</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
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
                    className="hover:bg-[#fbfcfd] cursor-pointer"
                  >
                    <td className="px-5 py-[15px] text-[14.5px] font-semibold text-slate-900">{m.method}</td>
                    <td className="px-5 py-[15px] text-sm text-slate-800 tabular-nums">{m.count}</td>
                    <td className="px-5 py-[15px] text-[14.5px] font-semibold text-slate-900 text-right tabular-nums">{formatCurrency(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white border border-slate-200/70 rounded-2xl overflow-hidden">
          <div className="px-5 pt-[18px] pb-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-base font-bold tracking-[-0.01em] text-slate-900">Refunds</h3>
            <span className="text-[13px] font-semibold text-red-700 tabular-nums">{formatCurrency(totalRefunded)} total</span>
          </div>
          {refunds.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">No refunds in this period.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fbfcfd] border-b border-slate-100">
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Booking</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Date</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Method</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
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
                    className="hover:bg-[#fbfcfd] cursor-pointer"
                  >
                    <td className="px-5 py-[15px]">
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
                    <td className="px-5 py-[15px] text-sm text-slate-800 tabular-nums">{formatDate(r.pay_datetime)}</td>
                    <td className="px-5 py-[15px] text-sm text-slate-800 tabular-nums">{r.pay_method || 'Unspecified'}</td>
                    <td className="px-5 py-[15px] text-right font-semibold text-red-600">{formatCurrency(Math.abs(r.amount_paid))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-200/70 rounded-2xl overflow-hidden">
        <div className="px-5 pt-[18px] pb-4 border-b border-slate-100"><h3 className="text-base font-bold tracking-[-0.01em] text-slate-900">Recent Months (Completed)</h3>
          <p className="text-[13px] text-slate-600 mt-1">Latest 3 months — full history on the Booking Summary tab.</p>
        </div>
        {bookingSummaryData.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">No completed bookings yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fbfcfd] border-b border-slate-100">
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Month</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Completed Bookings</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Revenue</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Top Package</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
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
                    className="hover:bg-[#fbfcfd] cursor-pointer"
                  >
                    <td className="px-5 py-[15px] text-[14.5px] font-semibold text-slate-900">{row.month}</td>
                    <td className="px-5 py-[15px]">{row.bookings}</td>
                    <td className="px-5 py-[15px] font-semibold text-slate-900">{formatCurrency(row.revenue)}</td>
                    <td className="px-5 py-[15px]">{row.topPackage}</td>
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
