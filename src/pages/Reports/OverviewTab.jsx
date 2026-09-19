// src/pages/Reports/OverviewTab.jsx
//
// Six cards, and the rule they all obey:
//
//   A card shows ONE number. Its subtext says what that number is and names
//   the period. The subtext never contains a second number.
//
// So no "+ ₱58,150 …" lines, no "across 2 bookings", no percentages tucked
// under an amount: a figure worth showing gets its own card. The word
// "events" is banned from a money card's subtext too — it is a countable
// noun, and the number underneath is pesos, not a count. The only two basis
// labels on this page are "by service date" (the day the catering happens)
// and "by payment date" (the day the money moved).
//
// Every figure comes from f_report_period. Pending bookings are in none of
// them: a request nobody has agreed to is not revenue.
import { formatCurrency, formatPercent, cardColorClasses, cardAccentClass } from './helpers';

function StatCard({ label, value, sub, color, onClick, count = false, secondary = false }) {
  return (
    <button
      onClick={onClick}
      className={`border rounded-2xl text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${secondary ? 'p-4' : 'p-5'} ${cardColorClasses()}`}
    >
      <span className={cardAccentClass(color)} />
      <p className={`font-semibold mb-2 ${secondary ? 'text-[12.5px] text-slate-500' : 'text-[13px] text-slate-600'}`}>{label}</p>
      <h3 className={`font-semibold tracking-[-0.03em] tabular-nums ${secondary ? 'text-[20px] leading-none text-slate-700' : count ? 'text-[32px] leading-none text-slate-900' : 'text-[26px] leading-[1.05] text-slate-900'}`}>{value}</h3>
      {sub && <p className={`mt-2.5 ${secondary ? 'text-[12.5px] text-slate-500' : 'text-[13px] text-slate-600'}`}>{sub}</p>}
    </button>
  );
}

const ROW_GRID = 'grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]';
const SECTION_HEAD = 'text-[13px] font-bold text-slate-600 tracking-[0.04em] mb-3';

export default function OverviewTab({ derived, period, onCardClick, onOpenDetail }) {
  const {
    financialSummary, packageMix, menuItemMix, topSellingItem,
    totalCustomers, repeatCustomers, oneTimeCustomers,
  } = derived;

  // Two leaders, not one. A package and a tray of food are different kinds of
  // sale and can't be ranked against each other — see MenuPerformanceTab.
  const topPackage = packageMix[0] || null;
  const topItem = menuItemMix[0] || null;
  const hasTopSellers = Boolean(topPackage || topItem);

  return (
    <div className="space-y-[18px]">
      <section>
        <h2 className={SECTION_HEAD}>The money that matters</h2>
        <div className={ROW_GRID}>
          {/* Contracted work only — Confirmed and Completed. A Pending request
              is not revenue, and it is not folded in under any label. */}
          <StatCard
            label="Estimated Gross Revenue"
            value={formatCurrency(financialSummary.grossContracted)}
            sub={`Contracted for ${period} · by service date`}
            color="green"
            onClick={() => onCardClick('revenue')}
          />
          {/* The same figure, by the same definition, as Cash Receipts on the
              Receivables page. Both read f_report_period / v_payment_ledger. */}
          <StatCard
            label="Cash Receipts"
            value={formatCurrency(financialSummary.cashReceipts)}
            sub={`Collected during ${period} · by payment date`}
            color="teal"
            onClick={() => onOpenDetail({
              title: 'Cash Receipts',
              description: 'Verified receipts, counted on the day the money moved. Claims awaiting verification, reversals, and receipts that have been reversed are all excluded — the same rule the Receivables page uses.',
              fields: [
                { label: 'Cash receipts', value: formatCurrency(financialSummary.cashReceipts), emphasis: true },
                { label: 'Receipts counted', value: financialSummary.receiptCount },
                { label: 'Refunds issued', value: formatCurrency(financialSummary.refundsIssued) },
                { label: 'Reversals recorded', value: formatCurrency(financialSummary.reversalsRecorded) },
              ],
            })}
          />
          {/* One term, one number, both pages: Approved, Confirmed and
              Completed, exactly as Receivables counts it. */}
          <StatCard
            label="Total Receivables"
            value={formatCurrency(financialSummary.outstandingReceivable)}
            sub={`Still to collect for ${period} · by service date`}
            color="amber"
            onClick={() => onCardClick('outstanding')}
          />
        </div>
      </section>

      <section>
        <h2 className={SECTION_HEAD}>Supporting</h2>
        <div className={ROW_GRID}>
          <StatCard
            secondary
            label="Approved, Not Yet Confirmed"
            value={formatCurrency(financialSummary.grossApproved)}
            sub={`Accepted, awaiting confirmation · for ${period}`}
            color="blue"
            onClick={() => onCardClick('approved')}
          />
          {/* Money the business kept when a booking fell through. It is income,
              but not of the same kind as contracted work, so it is never folded
              into Estimated Gross Revenue. */}
          <StatCard
            secondary
            label="Forfeited Deposits"
            value={formatCurrency(financialSummary.forfeitedDeposits)}
            sub={`Retained from cancellations · for ${period}`}
            color="red"
            onClick={() => onCardClick('forfeited')}
          />
          {/* The one card whose number IS a count, so a countable word is
              right here. */}
          <StatCard
            secondary
            count
            label="Completed Bookings"
            value={financialSummary.completedCount}
            sub={`Finished during ${period}`}
            color="purple"
            onClick={() => onOpenDetail({
              title: 'Completed Bookings',
              description: 'Bookings marked Completed whose service date falls in the selected period.',
              fields: [{ label: 'Completed bookings', value: financialSummary.completedCount, emphasis: true }],
            })}
          />
        </div>
      </section>

      <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
        <button
          onClick={() => hasTopSellers && onOpenDetail({
            title: 'Top Sellers',
            description: 'The highest-earning package and the highest-earning menu item. Each is measured against its own product line, because a package and a tray are different kinds of sale.',
            fields: [
              ...(topPackage ? [
                { label: 'Top package', value: topPackage.name, emphasis: true },
                { label: 'Share of package revenue', value: formatPercent(topPackage.revenueShare) },
                { label: 'Revenue', value: formatCurrency(topPackage.revenue) },
              ] : []),
              ...(topItem ? [
                { label: 'Top menu item', value: topItem.name, emphasis: true },
                { label: 'Share of menu item revenue', value: formatPercent(topItem.revenueShare) },
                { label: 'Revenue', value: formatCurrency(topItem.revenue) },
              ] : []),
              ...(topSellingItem && topItem && topSellingItem.id !== topItem.id ? [
                { label: 'Most ordered item', value: `${topSellingItem.name} · ${topSellingItem.quantity} trays` },
              ] : []),
            ],
          })}
          disabled={!hasTopSellers}
          className={`border rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 disabled:cursor-default ${cardColorClasses()}`}
        >
          <span className={cardAccentClass('purple')} />
          <p className="text-[13px] font-semibold text-slate-600 mb-3">Top Sellers</p>
          {hasTopSellers ? (
            <div className="space-y-3">
              {topPackage && (
                <div className="flex items-baseline justify-between gap-3.5">
                  <div className="min-w-0">
                    <span className="block text-base font-semibold text-slate-900">{topPackage.name}</span>
                    <span className="block text-[13px] text-slate-600 mt-0.5">Highest-earning package</span>
                  </div>
                  <span className="shrink-0 text-[15px] font-semibold text-[#007038] tabular-nums">{formatPercent(topPackage.revenueShare)}</span>
                </div>
              )}
              {topPackage && topItem && <div className="h-px bg-slate-100" />}
              {topItem && (
                <div className="flex items-baseline justify-between gap-3.5">
                  <div className="min-w-0">
                    <span className="block text-base font-semibold text-slate-900">{topItem.name}</span>
                    <span className="block text-[13px] text-slate-600 mt-0.5">Highest-earning menu item</span>
                  </div>
                  <span className="shrink-0 text-[15px] font-semibold text-[#007038] tabular-nums">{formatPercent(topItem.revenueShare)}</span>
                </div>
              )}
              {/* Each share is measured against its OWN product line, so the
                  two percentages are not comparable and must never be summed. */}
              <p className="text-[12.5px] text-slate-600 pt-1">Each share is of its own product line's revenue.</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No sales data in this period.</p>
          )}
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Customers',
            description: 'Customers with at least one active booking in the selected period. Repeat customers have two or more.',
            fields: [
              { label: 'Total customers', value: totalCustomers, emphasis: true },
              { label: 'Repeat customers', value: repeatCustomers },
              { label: 'One-time customers', value: oneTimeCustomers },
            ],
          })}
          className={`border rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${cardColorClasses()}`}
        >
          <span className={cardAccentClass('green')} />
          <p className="text-[13px] font-semibold text-slate-600 mb-2">Customers</p>
          <span className="block text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">{totalCustomers}</span>
          <div className="flex gap-7 mt-[18px] pt-4 border-t border-slate-100">
            <div>
              <span className="block text-[13px] text-slate-600 mb-1">Repeat</span>
              <span className="block text-[19px] font-semibold tabular-nums text-slate-900">{repeatCustomers}</span>
            </div>
            <div>
              <span className="block text-[13px] text-slate-600 mb-1">One-time</span>
              <span className="block text-[19px] font-semibold tabular-nums text-slate-900">{oneTimeCustomers}</span>
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}
