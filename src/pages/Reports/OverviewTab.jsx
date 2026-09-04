// src/pages/Reports/OverviewTab.jsx
import { formatCurrency, formatPercent, cardColorClasses, cardAccentClass } from './helpers';

// `count` renders a plain integer, which carries a larger optical size than a
// currency string of the same weight.
function StatCard({ label, value, sub, color, onClick, count = false }) {
  return (
    <button
      onClick={onClick}
      className={`border rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${cardColorClasses()}`}
    >
      <span className={cardAccentClass(color)} />
      <p className="text-[13px] font-semibold text-slate-600 mb-2">{label}</p>
      <h3 className={`font-semibold tracking-[-0.03em] tabular-nums text-slate-900 ${count ? 'text-[32px] leading-none' : 'text-[26px] leading-[1.05]'}`}>{value}</h3>
      {sub && <p className="text-[13px] text-slate-600 mt-2.5">{sub}</p>}
    </button>
  );
}

const SECTION_GRID = 'grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))]';
const SECTION_HEAD = 'text-[13px] font-bold text-slate-600 tracking-[0.04em] mb-3';

export default function OverviewTab({ derived, onCardClick, onOpenDetail }) {
  const {
    financialSummary, totalSubmitted, cancellationRate, rejectedCount, customerCancelledCount, pendingInRangeCount,
    packageMix, menuItemMix, topSellingItem,
    equipmentUtilizationData, totalVehicles, dispatchedVehicles, totalCustomers, repeatCustomers, oneTimeCustomers,
    bookingSummaryData,
  } = derived;

  // Two leaders, not one. A package and a tray of food are different kinds of
  // sale and can't be ranked against each other — see MenuPerformanceTab.
  const topPackage = packageMix[0] || null;
  const topItem = menuItemMix[0] || null;
  const hasTopSellers = Boolean(topPackage || topItem);
  const totalEquipmentDeployed = equipmentUtilizationData.reduce((sum, e) => sum + e.deployed, 0);
  const totalEquipmentUnits = equipmentUtilizationData.reduce((sum, e) => sum + e.total, 0);
  const totalEquipmentUsable = equipmentUtilizationData.reduce((sum, e) => sum + e.usable, 0);
  // Usable stock, not units owned — the same denominator EquipmentUtilizationTab
  // uses. Dividing by everything owned counts damaged and under-maintenance gear
  // as spare capacity, which reports a lower utilization than is real. The two
  // pages showed different percentages for the same fleet until this matched.
  const equipmentUsageRate = totalEquipmentUsable > 0 ? Math.round((totalEquipmentDeployed / totalEquipmentUsable) * 100) : 0;
  const totalCompletedBookings = bookingSummaryData.reduce((sum, r) => sum + r.bookings, 0);

  return (
    <div className="space-y-[18px]">
      {/* The eight cards shipped as two arbitrary rows of four with nothing
          saying which was which. They already split cleanly, so the headings
          name a grouping that was always there but never stated.
          Everything in this first group is anchored on the EVENT date -- hence
          the "events in this period" sub-lines. Completed Bookings is a count
          rather than an amount, but it belongs here because it is the volume
          those money figures are earned on. */}
      <section>
        <h2 className={SECTION_HEAD}>Financial</h2>
        <div className={SECTION_GRID}>
        <StatCard label="Contract Value" value={formatCurrency(financialSummary.contractValue)} sub={`Events in this period${pendingInRangeCount > 0 ? ` · includes ${pendingInRangeCount} not yet approved` : ''}`} color="green" onClick={() => onCardClick('revenue')} />
        <StatCard label="Paid to Date" value={formatCurrency(financialSummary.paidAgainstEvents)} sub="Against those events" color="teal" onClick={() => onCardClick('collected')} />
        <StatCard label="Unpaid on These Events" value={formatCurrency(financialSummary.outstanding)} sub="Of the events in this period" color="amber" onClick={() => onCardClick('outstanding')} />
        <StatCard
          label="Completed Bookings"
          count
          value={totalCompletedBookings}
          sub="In selected period"
          color="blue"
          onClick={() => onOpenDetail({
            title: 'Completed Bookings',
            description: `From the booking table: rows where booking_status = "Completed" and the event date falls in the selected period. ${bookingSummaryData.length} month(s) had at least one.`,
            fields: [{ label: 'Completed bookings', value: totalCompletedBookings, emphasis: true }],
          })}
        />
        </div>
      </section>

      <section>
        <h2 className={SECTION_HEAD}>Operations</h2>
        <div className={SECTION_GRID}>
        <StatCard
          label="Bookings & Orders Submitted"
          count
          value={totalSubmitted}
          sub="All statuses"
          color="purple"
          onClick={() => onOpenDetail({
            title: 'Bookings & Orders Submitted',
            description: 'From the booking table: every row submitted in the selected period, counted by its submission date — regardless of what status it ended up with.',
            fields: [{ label: 'Total submitted', value: totalSubmitted, emphasis: true }],
          })}
        />
        <StatCard
          label="Rejected & Cancelled"
          value={`${cancellationRate}%`}
          sub="of all bookings & orders submitted"
          color="red"
          onClick={() => onOpenDetail({
            title: 'Rejected & Cancelled',
            description: 'From the booking table: bookings and orders whose status is Rejected or Cancelled, divided by all submitted in this period. Rejected means PG’s declined the work; Cancelled means the customer withdrew.',
            badge: { label: cancellationRate > 20 ? 'Needs attention' : 'Healthy', variant: cancellationRate > 20 ? 'warning' : 'good' },
            fields: [
              { label: 'Rate', value: `${cancellationRate}%`, emphasis: true },
              { label: 'Rejected by PG’s', value: rejectedCount },
              { label: 'Cancelled by customer', value: customerCancelledCount },
              { label: 'Bookings & orders submitted', value: totalSubmitted },
            ],
          })}
        />
        <StatCard
          label="Equipment Committed"
          value={`${equipmentUsageRate}%`}
          sub={`${totalEquipmentDeployed} of ${totalEquipmentUsable} usable units committed`}
          color="blue"
          onClick={() => onOpenDetail({
            title: 'Equipment Committed',
            description: `Live snapshot from the equipment table (stock counts) and booking_equipment table (items not yet marked returned), across ${equipmentUtilizationData.length} equipment type(s).`,
            fields: [
              { label: 'Utilization', value: `${equipmentUsageRate}%`, emphasis: true },
              { label: 'Committed', value: totalEquipmentDeployed },
              { label: 'Usable stock', value: totalEquipmentUsable },
              { label: 'Units owned', value: totalEquipmentUnits },
            ],
          })}
        />
        <StatCard
          label="Vehicles Dispatched"
          value={`${dispatchedVehicles} / ${totalVehicles}`}
          sub="On the road now"
          color="teal"
          onClick={() => onOpenDetail({
            title: 'Vehicles Dispatched',
            description: 'From vehicle_assign: vehicles whose dispatch window contains this moment. A vehicle booked for a future event is committed, not on the road — that count is shown separately.',
            fields: [
              { label: 'Dispatched', value: dispatchedVehicles, emphasis: true },
              { label: 'Total fleet', value: totalVehicles },
            ],
          })}
        />
        </div>
      </section>

      <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))]">
        <button
          onClick={() => hasTopSellers && onOpenDetail({
            title: 'Top Sellers',
            description: 'The highest-earning package and the highest-earning menu item, each measured against its own product line — a package and a tray are different kinds of sale and are never ranked against each other.',
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
            description: 'From the booking table: distinct customers with at least one active (non-Rejected/Cancelled) booking in the selected period. Repeat = 2+ bookings.',
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
