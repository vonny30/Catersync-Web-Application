// src/pages/Reports/OverviewTab.jsx
//
// ONE ROW of money (22 Sep 2026): Estimated Gross Revenue, Payments Received,
// Collectible. Each card's subtext names the days it counts — the services in
// the period for revenue and collectible, the payments made in the period for
// Payments Received — so no "service date / payment date" or "accrual / cash
// basis" headings are needed, and none are shown.
//
// A card shows ONE number; its subtext says what the number is and names the
// period.
//
// Every figure comes from f_report_period. Pending bookings are in none of
// them: a request nobody has agreed to is not revenue.
import { formatCurrency, formatPercent, cardColorClasses, cardAccentClass, paymentsReceivedSub, paymentsReceivedDetail } from './helpers';
import { EmptyResult } from '../../components/FilterBar';

// The hint sits OUTSIDE the card's button (a button inside a button is
// invalid, and the click would go to the card), so the card is a positioned
// wrapper with the button inside it.
function StatCard({ label, value, sub, color, onClick, count = false, hint = null }) {
  return (
    <div className="relative">
      <button
        onClick={onClick}
        className={`w-full border rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${cardColorClasses()}`}
      >
        <span className={cardAccentClass(color)} />
        <p className={`text-[13px] font-semibold text-slate-600 mb-2 ${hint ? 'pr-6' : ''}`}>{label}</p>
        <h3 className={`font-semibold tracking-[-0.03em] tabular-nums text-slate-900 ${count ? 'text-[32px] leading-none' : 'text-[26px] leading-[1.05]'}`}>{value}</h3>
        {sub && <p className="text-[13px] text-slate-600 mt-2.5">{sub}</p>}
      </button>
      {hint && <span className="absolute top-[18px] right-[14px]">{hint}</span>}
    </div>
  );
}

const ROW_GRID = 'grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]';

export default function OverviewTab({ derived, span, onCardClick, onOpenDetail, canClearFilters, onClearFilters }) {
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
    <div className="space-y-8">
      {/* The month's money in one row (22 Sep 2026): what was earned, what
          came in, what is still owed. Paid on These Events and Completed
          Bookings were removed, and so were the "service date / payment date"
          and "accrual / cash basis" headings — each card's subtext says which
          days it counts. */}
      <section>
        <div className={ROW_GRID}>
          {/* Contracted work only — Confirmed and Completed — plus forfeited
              deposits. A Pending request is not revenue. */}
          <StatCard
            label="Estimated Gross Revenue"
            value={formatCurrency(financialSummary.earnedRevenue)}
            sub={span ? `Services ${span}, incl. kept deposits` : 'Confirmed, completed and kept deposits'}
            color="green"
            onClick={() => onCardClick('revenue')}
          />
          {/* Money kept, by the day it moved: the same figure as the Payments
              page and the Dashboard. */}
          <StatCard
            label="Payments Received"
            value={formatCurrency(financialSummary.paymentsReceived)}
            sub={paymentsReceivedSub(span, financialSummary.refundsIssued)}
            color="teal"
            onClick={() => onOpenDetail(paymentsReceivedDetail(financialSummary))}
          />
          {/* outstanding_contracted: still owed on Confirmed and Completed
              services in the period. */}
          <StatCard
            label="Collectible"
            value={formatCurrency(financialSummary.outstandingContracted)}
            sub={span ? `Still owed on services ${span}` : 'Not yet collected'}
            color="amber"
            onClick={() => onCardClick('outstanding')}
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
            <EmptyResult canClear={canClearFilters} onClear={onClearFilters} />
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
