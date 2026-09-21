// src/pages/Reports/OverviewTab.jsx
//
// TWO SECTIONS, because the figures answer two different questions and a
// reader who sees them in one block tries to add them up:
//
//   Work scheduled for {period}  — anchored on the SERVICE date: what this
//                                  period's catering is worth, and what is
//                                  still owed on it.
//   Money that moved in {period} — anchored on the PAYMENT date: cash in and
//                                  out, whatever month the catering happens.
//
// Cash Receipts can exceed a month's revenue, because a deposit taken now for
// a November wedding belongs to the second and not the first. The sentence
// between the sections says so outright, and the (i) on Cash Receipts repeats
// it where a reader will look first.
//
// And the rule every card obeys:
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
import { formatCurrency, formatPercent, cardColorClasses, cardAccentClass, forPeriod } from './helpers';
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
// Headings, not card labels: darker, larger, with the plain sentence under
// them that says what the section answers.
const SECTION_HEAD = 'text-[15px] font-bold tracking-[-0.01em] text-slate-900 mb-3.5';
// Beside a section heading: which basis the figures under it are measured on.
// Small and muted on purpose — a reader who knows the term is told everything
// they need, and a reader who does not is not slowed down by it.
const BASIS_LABEL = 'ml-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-slate-400';

export default function OverviewTab({ derived, period, span, onCardClick, onOpenDetail, canClearFilters, onClearFilters }) {
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
      {/* SECTION 1 — anchored on the SERVICE date: what this period's catering
          is worth and what is still owed on it. */}
      <section>
        <h2 className={SECTION_HEAD}>By service date<span className={BASIS_LABEL}>Accrual basis</span></h2>
        <div className={ROW_GRID}>
          {/* Contracted work only — Confirmed and Completed. A Pending request
              is not revenue, and it is not folded in under any label. */}
          <StatCard
            label="Estimated Gross Revenue"
            value={formatCurrency(financialSummary.earnedRevenue)}
            sub={span ? `Services ${span}, incl. kept deposits` : 'Confirmed, completed and kept deposits'}
            color="green"
            onClick={() => onCardClick('revenue')}
          />
          <StatCard
            label="Approved"
            value={formatCurrency(financialSummary.grossApproved)}
            sub={span ? `Not yet confirmed, services ${span}` : 'Not yet confirmed'}
            color="blue"
            onClick={() => onCardClick('approved')}
          />
          {/* THE BRIDGE. Cash Receipts answers "what came in"; this answers
              "how much of THIS period's contracted work has been paid for".
              Same population as Estimated Gross Revenue (paid_contracted, not
              paid_against_events), which is what makes the identity below
              hold: collections + receivables = revenue. */}
          <StatCard
            label="Paid on These Events"
            value={formatCurrency(financialSummary.paidOnEvents)}
            sub={span ? `Paid toward services ${span}` : 'Paid toward these services'}
            color="teal"
            onClick={() => onCardClick('collected')}
          />
          {/* outstanding_contracted, never outstanding_receivable: an Approved
              booking is not contracted and is already on the card above. And
              never Confirmed alone — a Completed event with a balance is the
              truest receivable here, since the service was already delivered. */}
          <StatCard
            label="Collectible"
            value={formatCurrency(financialSummary.outstandingContracted)}
            sub={span ? `Still owed on services ${span}` : 'Not yet collected'}
            color="amber"
            onClick={() => onCardClick('outstanding')}
          />
        </div>
      </section>

      {/* SECTION 2 — anchored on the PAYMENT date: cash that actually moved. */}
      <section>
        <h2 className={SECTION_HEAD}>By payment date<span className={BASIS_LABEL}>Cash basis</span></h2>
        <div className={ROW_GRID}>
          {/* The same figure, by the same definition, as Cash Receipts on the
              Receivables page. Both read f_report_period / v_payment_ledger. */}
          <StatCard
            label="Payments Received"
            value={formatCurrency(financialSummary.cashReceipts)}
            sub={span ? `Verified receipts, paid ${span}` : 'All verified receipts'}
            color="teal"
            onClick={() => onOpenDetail({
              title: 'Payments Received',
              description: 'Verified receipts, counted on the day the money moved. Claims awaiting verification, reversals, and receipts that have been reversed are all excluded — the same rule the Receivables page uses.',
              fields: [
                { label: 'Payments received', value: formatCurrency(financialSummary.cashReceipts), emphasis: true },
                { label: 'Receipts counted', value: financialSummary.receiptCount },
                { label: 'Refunds issued', value: formatCurrency(financialSummary.refundsIssued) },
                { label: 'Reversals recorded', value: formatCurrency(financialSummary.reversalsRecorded) },
              ],
            })}
          />
        </div>
      </section>

      {/* A count, so neither money block. Forfeited Deposits and Refunds
          Issued used to sit here and above; both were removed on 21 Sep 2026.
          Kept deposits are now inside Estimated Gross Revenue and Paid on These
          Events (and were always inside Payments Received); refunds are listed
          on the Financial tab. */}
      <section>
        <h2 className={SECTION_HEAD}>Also {forPeriod(period)}</h2>
        <div className={ROW_GRID}>
          <StatCard
            count
            label="Completed Bookings"
            value={financialSummary.completedCount}
            sub={span ? `Services ${span}` : 'Marked completed'}
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
