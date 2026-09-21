// src/pages/Reports/FinancialTab.jsx
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { formatCurrency, formatPercent, formatDate } from './helpers';
import { EmptyResult } from '../../components/FilterBar';

export default function FinancialTab({ derived, span, onCardClick, onOpenDetail, canClearFilters, onClearFilters }) {
  const navigate = useNavigate();
  const { financialSummary, monthlyFinancialTrend, paymentMethodData, refunds, reversals, bookingSummaryData } = derived;

  // Share of this period's CONTRACTED work that has been collected. Both
  // sides are the same population (Confirmed + Completed) and both come from
  // f_report_period, so the bar is the identity on screen: collections plus
  // receivables is the whole bar. It deliberately does NOT use Cash Receipts —
  // that is anchored on payment date and includes cash for services outside
  // this period, so dividing it here would compare two different populations.
  const collectedPct = financialSummary.earnedRevenue > 0
    ? (financialSummary.paidOnEvents / financialSummary.earnedRevenue) * 100
    : 0;

  // Shared class string for the three event-anchored figures.
  const FIG = 'block text-[21px] font-semibold tracking-[-0.02em] tabular-nums';

  const goToBookingDetails = (id, type) => {
    if (!id) return;
    navigate(`/app/${type === 'Short Order' ? 'orders' : 'bookings'}/${id}`);
  };

  return (
    <>
      {/* The same two sections as the Overview tab, so both tabs teach the
          same idea: service-date figures first, then the cash that moved. */}
      <section className="bg-white border border-slate-200/70 rounded-2xl p-6 mb-5">
        <h2 className="text-[15px] font-bold tracking-[-0.01em] text-slate-900 mb-5">By service date<span className="ml-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-slate-400">Accrual basis</span></h2>
        <div className="flex flex-wrap gap-8">
          <button onClick={() => onCardClick('revenue')} className="text-left rounded-lg focus:outline-none focus:ring-2 focus:ring-[#008A45]/40">
            <span className="block text-[13px] text-slate-600 mb-1.5">Estimated Gross Revenue</span>
            <span className={`${FIG} text-slate-900`}>{formatCurrency(financialSummary.earnedRevenue)}</span>
            <span className="block text-[12.5px] text-slate-500 mt-1">{span ? `Services ${span}, incl. kept deposits` : 'Confirmed, completed and kept deposits'}</span>
          </button>
          <button onClick={() => onCardClick('collected')} className="text-left rounded-lg focus:outline-none focus:ring-2 focus:ring-[#008A45]/40">
            {/* Same colour roles as the Equipment page: green for what is in
                hand, orange for what is not. */}
            <span className="flex items-center gap-1.5 text-[13px] text-slate-600 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-[#009E73] shrink-0" aria-hidden="true" />
              Paid on These Events
            </span>
            <span className={`${FIG} text-[#009E73]`}>{formatCurrency(financialSummary.paidOnEvents)}</span>
            <span className="block text-[12.5px] text-slate-500 mt-1">{span ? `Paid toward services ${span}` : 'Paid toward these services'}</span>
          </button>
          <button onClick={() => onCardClick('outstanding')} className="text-left rounded-lg focus:outline-none focus:ring-2 focus:ring-[#008A45]/40">
            <span className="flex items-center gap-1.5 text-[13px] text-slate-600 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-[#D55E00] shrink-0" aria-hidden="true" />
              Collectible
            </span>
            <span className={`${FIG} text-[#D55E00]`}>{formatCurrency(financialSummary.outstandingContracted)}</span>
            <span className="block text-[12.5px] text-slate-500 mt-1">{span ? `Still owed on services ${span}` : 'Not yet collected'}</span>
          </button>
        </div>

        {/* The relationship the separate figures never showed. Clamped at
            100% so an overpaid booking cannot draw a bar wider than its
            track, while the printed percentage stays truthful. */}
        <div className="mt-[22px] mb-2.5 h-2 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full bg-[#009E73]" style={{ width: `${Math.min(100, Math.max(0, collectedPct))}%` }} />
        </div>
        {financialSummary.earnedRevenue > 0 ? (
          <>
            <span className="block text-[13px] text-slate-600 tabular-nums">
              {formatPercent(collectedPct)} of earned revenue collected
            </span>
          </>
        ) : (
          <span className="block text-[13px] text-slate-600">Nothing contracted.</span>
        )}
      </section>

      {/* Whitespace and weight separate the two, never a rule or a coloured
          bar. This sentence is the part that stops the reconciling. */}

      <section className="bg-white border border-slate-200/70 rounded-2xl p-6 mb-[18px]">
        <h2 className="text-[15px] font-bold tracking-[-0.01em] text-slate-900 mb-5">By payment date<span className="ml-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-slate-400">Cash basis</span></h2>
        <div className="flex flex-wrap gap-10">
          <div>
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-600 mb-2.5">
              Payments Received
            </span>
            <span className="block text-[38px] font-semibold tracking-[-0.035em] leading-none tabular-nums text-slate-900">
              {formatCurrency(financialSummary.cashReceipts)}
            </span>
            <span className="block text-[13.5px] text-slate-600 mt-3">{span ? `Verified receipts, paid ${span}` : 'All verified receipts'}</span>
          </div>
        </div>
      </section>

      <div className="bg-white border border-slate-200/70 rounded-2xl p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h3 className="text-base font-bold tracking-[-0.01em] text-slate-900">Money by service month</h3>
          <span className="text-[13px] text-slate-600">By service month</span>
        </div>
        {/* REQUIRED SENTENCE. This chart deliberately ignores the period filter
            sitting above it, and a chart that ignores a nearby control reads as
            a bug unless it says so. It replaced a bar chart of cash-by-payment-
            month which, under the default "This Month" preset, rendered exactly
            one bar — a time series with no time in it. */}
        <p className="text-[13px] text-slate-600 mb-4">
          Last 6 months and scheduled ahead — not affected by the period filter above.
        </p>
        {monthlyFinancialTrend.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-400 text-sm">No events to chart.</div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={monthlyFinancialTrend} margin={{ top: 10, right: 96, left: 20, bottom: 20 }}>
              {/* Horizontal rules only. Vertical grid lines add nothing to a
                  categorical month axis and compete with the lines. */}
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 13, fill: '#475569' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
              {/* One shared axis. All three series are pesos, and a second
                  y-scale would let two lines cross at a point where the
                  underlying amounts are nowhere near each other. */}
              <YAxis
                domain={[0, 'auto']}
                tickFormatter={(value) => `₱${Number(value).toLocaleString()}`}
                tick={{ fontSize: 13, fill: '#475569' }}
                tickLine={false}
                axisLine={false}
                width={100}
              />
              <Tooltip
                cursor={{ stroke: '#94a3b8', strokeWidth: 1 }}
                formatter={(value, name) => [value === null ? 'No events' : `₱${Number(value).toLocaleString()}`, name]}
                labelFormatter={(label) => label}
                contentStyle={{ fontSize: 13, borderRadius: 10, border: '1px solid #e2e8f0' }}
                labelStyle={{ color: '#0f172a', fontWeight: 700 }}
                itemStyle={{ color: '#475569' }}
              />
              <Legend wrapperStyle={{ fontSize: 13, color: '#475569' }} />
              {/* Okabe-Ito. NOT the app's brand green and amber, which sit at
                  dE 4.6 under protanopia — a red-green colourblind manager
                  could not tell Paid from Unpaid, which is the one comparison
                  this chart exists to make. */}
              {[
                { key: 'estimatedGrossRevenue', name: 'Estimated Gross Revenue', color: '#0072B2' },
                { key: 'paidToDate', name: 'Paid to Date', color: '#009E73' },
                { key: 'unpaid', name: 'Unpaid on These Events', color: '#D55E00' },
              ].map((series, i) => (
                <Line
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.name}
                  stroke={series.color}
                  strokeWidth={2}
                  dot={{ r: 4, fill: series.color, strokeWidth: 0 }}
                  activeDot={{ r: 5 }}
                  /* A month with no events is a gap, not a zero: zero would draw
                     the line to the axis and claim there was nothing to earn. */
                  connectNulls={false}
                >
                  {/* Identity is never colour-alone — each line is also named at
                      its own right end, so the legend is a convenience rather
                      than the only key. */}
                  <LabelList
                    dataKey={series.key}
                    position="right"
                    content={({ x, y, index }) =>
                      index === monthlyFinancialTrend.length - 1 && x != null && y != null ? (
                        <text x={x + 8} y={y + (i - 1) * 2} dy={4} fontSize={11} fontWeight={700} fill={series.color}>
                          {series.name.split(' ')[0]}
                        </text>
                      ) : null
                    }
                  />
                </Line>
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
        <p className="mt-2 text-[13px] text-slate-600">
          Each month is the services happening THAT month — not the cash taken that month. Estimated Gross Revenue is
          contracted work plus deposits kept on cancellations, as in the figure above.
          Still to collect is that estimate minus what has been collected against the same services.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200/70 rounded-2xl overflow-hidden">
          <div className="px-5 pt-[18px] pb-4 border-b border-slate-100"><h3 className="text-base font-bold tracking-[-0.01em] text-slate-900">Payment Methods</h3></div>
          {paymentMethodData.length === 0 ? (
            <EmptyResult canClear={canClearFilters} onClear={onClearFilters} />
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
                      description: 'Receipts collected by this method in the selected period. Refunds and reversals are not counted here.',
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
            <span className="text-[13px] font-semibold text-red-700 tabular-nums">{formatCurrency(financialSummary.refundsIssued)} total</span>
          </div>
          {refunds.length === 0 ? (
            <EmptyResult canClear={canClearFilters} onClear={onClearFilters} />
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
                {/* entry_type Refund only. A reversal is a correction, not
                    money returned to a customer, and has its own table. */}
                {refunds.map((r) => (
                  <tr
                    key={r.payment_id}
                    onClick={() => onOpenDetail({
                      title: 'Refund',
                      description: `A refund recorded on ${formatDate(r.pay_datetime)}.`,
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

      {/* Corrections, not transactions. A reversal cancels a receipt that
          should not have been recorded; neither row counts toward any figure
          on this page. Shown only when there are any. */}
      {reversals.length > 0 && (
        <div className="bg-white border border-slate-200/70 rounded-2xl overflow-hidden">
          <div className="px-5 pt-[18px] pb-4 border-b border-slate-100 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold tracking-[-0.01em] text-slate-900">Reversals</h3>
              <p className="text-[13px] text-slate-600 mt-1">Corrections, not refunds. Neither entry counts above.</p>
            </div>
            <span className="text-[13px] font-semibold text-slate-600 tabular-nums shrink-0">{formatCurrency(financialSummary.reversalsRecorded)} total</span>
          </div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#fbfcfd] border-b border-slate-100">
                <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Booking</th>
                <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Date</th>
                <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {reversals.map((r) => (
                <tr key={r.payment_id} className="hover:bg-[#fbfcfd]">
                  <td className="px-5 py-[15px]">
                    {r.bookingRef ? (
                      <button
                        onClick={() => goToBookingDetails(r.booking_id, r.bookingType)}
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
                  <td className="px-5 py-[15px] text-right font-semibold text-slate-600 tabular-nums">−{formatCurrency(Math.abs(r.amount_paid))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white border border-slate-200/70 rounded-2xl overflow-hidden">
        <div className="px-5 pt-[18px] pb-4 border-b border-slate-100"><h3 className="text-base font-bold tracking-[-0.01em] text-slate-900">Recent Months (Completed)</h3>
          <p className="text-[13px] text-slate-600 mt-1">The latest three months. Full history is on the Booking Summary tab.</p>
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
                      description: 'Completed bookings with an event date in this month.',
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
