// src/pages/Reports/OverviewTab.jsx
import { formatCurrency, formatPercent, cardColorClasses } from './helpers';

function StatCard({ label, value, sub, color, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`border rounded-2xl p-5 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 ${cardColorClasses(color)}`}
    >
      <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">{label}</p>
      <h3 className="text-2xl font-extrabold text-slate-900">{value}</h3>
      {sub && <p className="text-xs text-slate-500 font-medium mt-1.5">{sub}</p>}
    </button>
  );
}

export default function OverviewTab({ derived, onCardClick, onOpenDetail }) {
  const {
    financialSummary, totalSubmitted, cancellationRate,
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
  const equipmentUsageRate = totalEquipmentUnits > 0 ? Math.round((totalEquipmentDeployed / totalEquipmentUnits) * 100) : 0;
  const totalCompletedBookings = bookingSummaryData.reduce((sum, r) => sum + r.bookings, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Contract Value" value={formatCurrency(financialSummary.contractValue)} sub="Events in this period" color="green" onClick={() => onCardClick('revenue')} />
        <StatCard label="Paid to Date" value={formatCurrency(financialSummary.paidAgainstEvents)} sub="Against those events" color="teal" onClick={() => onCardClick('collected')} />
        <StatCard label="Outstanding Balance" value={formatCurrency(financialSummary.outstanding)} sub="Still to collect" color="amber" onClick={() => onCardClick('outstanding')} />
        <StatCard
          label="Completed Events"
          value={totalCompletedBookings}
          sub="In selected period"
          color="blue"
          onClick={() => onOpenDetail({
            title: 'Completed Events',
            description: `From the booking table: rows where booking_status = "Completed" and the event date falls in the selected period. ${bookingSummaryData.length} month(s) had at least one.`,
            fields: [{ label: 'Completed events', value: totalCompletedBookings, emphasis: true }],
          })}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Bookings Submitted"
          value={totalSubmitted}
          sub="All statuses"
          color="purple"
          onClick={() => onOpenDetail({
            title: 'Bookings Submitted',
            description: 'From the booking table: every row submitted in the selected period, counted by its submission date — regardless of what status it ended up with.',
            fields: [{ label: 'Total submitted', value: totalSubmitted, emphasis: true }],
          })}
        />
        <StatCard
          label="Cancellation Rate"
          value={`${cancellationRate}%`}
          sub="Rejected + Cancelled"
          color="red"
          onClick={() => onOpenDetail({
            title: 'Cancellation Rate',
            description: 'From the booking table: bookings whose status is Rejected or Cancelled, divided by all bookings submitted in this period.',
            badge: { label: cancellationRate > 20 ? 'Needs attention' : 'Healthy', variant: cancellationRate > 20 ? 'warning' : 'good' },
            fields: [
              { label: 'Rate', value: `${cancellationRate}%`, emphasis: true },
              { label: 'Bookings submitted', value: totalSubmitted },
            ],
          })}
        />
        <StatCard
          label="Equipment In Use"
          value={`${equipmentUsageRate}%`}
          sub={`${totalEquipmentDeployed} of ${totalEquipmentUnits} units deployed`}
          color="blue"
          onClick={() => onOpenDetail({
            title: 'Equipment In Use',
            description: `Live snapshot from the equipment table (stock counts) and booking_equipment table (items not yet marked returned), across ${equipmentUtilizationData.length} equipment type(s).`,
            fields: [
              { label: 'Utilization', value: `${equipmentUsageRate}%`, emphasis: true },
              { label: 'Deployed', value: totalEquipmentDeployed },
              { label: 'Total fleet', value: totalEquipmentUnits },
            ],
          })}
        />
        <StatCard
          label="Vehicles Dispatched"
          value={`${dispatchedVehicles} / ${totalVehicles}`}
          sub="Currently on assignment"
          color="teal"
          onClick={() => onOpenDetail({
            title: 'Vehicles Dispatched',
            description: 'Live snapshot from the vehicle table (fleet) and vehicle_assign table (assignments currently marked Scheduled).',
            fields: [
              { label: 'Dispatched', value: dispatchedVehicles, emphasis: true },
              { label: 'Total fleet', value: totalVehicles },
            ],
          })}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
          className={`border rounded-2xl p-5 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 disabled:cursor-default disabled:hover:shadow-none ${cardColorClasses('purple')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-2">Top Sellers</p>
          {hasTopSellers ? (
            <div className="space-y-1.5">
              {topPackage && (
                <div>
                  <h3 className="text-base font-bold text-slate-900 leading-tight">{topPackage.name}</h3>
                  <p className="text-xs text-slate-500">{formatPercent(topPackage.revenueShare)} of package revenue</p>
                </div>
              )}
              {topItem && (
                <div>
                  <h3 className="text-base font-bold text-slate-900 leading-tight">{topItem.name}</h3>
                  <p className="text-xs text-slate-500">{formatPercent(topItem.revenueShare)} of menu item revenue</p>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-400 italic">No sales data in this period.</p>
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
          className={`border rounded-2xl p-5 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 ${cardColorClasses('green')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-2">Customers</p>
          <h3 className="text-lg font-bold text-slate-900">{totalCustomers} total</h3>
          <p className="text-sm text-slate-500 mt-1">{repeatCustomers} repeat, {oneTimeCustomers} one-time</p>
        </button>
      </div>
    </div>
  );
}
