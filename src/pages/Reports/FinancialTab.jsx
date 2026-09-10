// src/pages/Reports/FinancialTab.jsx
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LabelList,
} from 'recharts';
import { useNavigate } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { formatCurrency, formatPercent, formatDate } from './helpers';

export default function FinancialTab({ derived, onCardClick, onOpenDetail }) {
  const navigate = useNavigate();
  const { financialSummary, monthlyFinancialTrend, paymentMethodData, refunds, totalRefunded, bookingSummaryData } = derived;

  // Share of estimated gross revenue that has been paid. BOTH sides are
  // event-anchored (the estimate and the payments against those same events),
  // so the ratio is like-for-like. It deliberately does NOT use
  // paymentsReceived: that figure is anchored on payment date and counts cash
  // from events outside this period, so dividing it by this period's estimate
  // would compare two different populations and produce a number that means
  // nothing.
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
              <span className="block text-[13px] text-slate-600 mb-1.5">Estimated Gross Revenue</span>
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
                {formatPercent(collectedPct)} of estimated gross revenue paid for these events
              </span>
              <span className="block text-[12.5px] text-slate-500 mt-1 tabular-nums">
                {formatCurrency(financialSummary.paidAgainstEvents)} paid ÷ {formatCurrency(financialSummary.contractValue)} estimated gross revenue
              </span>
            </>
          ) : (
            <span className="block text-[13px] text-slate-600">
              No events fall in this period, so there is no estimated gross revenue to measure against.
            </span>
          )}
        </div>
      </section>

      <div className="bg-white border border-slate-200/70 rounded-2xl p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <h3 className="text-base font-bold tracking-[-0.01em] text-slate-900">Money by event month</h3>
          <span className="text-[13px] text-slate-600">Same three figures as the cards above</span>
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
          Each month is the events happening THAT month — not the cash taken that month. Estimated Gross Revenue
          includes bookings not yet approved, exactly as the card above does, so a month can carry an estimate for
          work PG&#39;s has not accepted yet. Unpaid is the estimate minus what has been paid against those same events.
        </p>
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
