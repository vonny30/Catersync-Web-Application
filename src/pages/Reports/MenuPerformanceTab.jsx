// src/pages/Reports/MenuPerformanceTab.jsx
//
// Three separate mixes, never one merged ranking.
//
// A package is sold once per event at price x pax; a menu item is sold by the
// tray. Put them in one list and every tray reads as a failure next to any
// package. Worse, the old share was revenue / biggest-row's-revenue, so the
// top row always showed exactly 100% — a bar that means "this is the largest"
// but reads as "this is all of it", and a 10%-of-the-biggest warning threshold
// that painted every single menu item red.
//
// Here each set is measured against its own total, so every share column adds
// to 100% and a number like 39.4% means what it says. Revenue share and order
// share sit side by side because the most-ordered item and the highest-earning
// item are usually different items — the question the old single "Popularity
// Metric" column could not answer.
import { formatCurrency, formatPercent, cardColorClasses } from './helpers';

const PARETO_LINE = 80;

function ShareBar({ value, muted = false }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xs font-semibold text-slate-600 w-12 text-right tabular-nums">{formatPercent(value)}</span>
      <div className="w-full bg-slate-200 rounded-full h-2 max-w-[160px]">
        <div
          className={`h-2 rounded-full ${muted ? 'bg-slate-400' : 'bg-[#008A45]'}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </div>
    </div>
  );
}

function Panel({ title, description, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-200">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        {description && <p className="text-xs text-slate-500 mt-1 max-w-3xl">{description}</p>}
      </div>
      {children}
    </div>
  );
}

const TH = 'bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200';
const EMPTY = 'p-8 text-center text-slate-400 text-sm';

export default function MenuPerformanceTab({ derived, onOpenDetail }) {
  const {
    productLineMix, packageMix, menuItemMix, categoryDemandData,
    packageRevenue, shortOrderRevenue, combinedRevenue,
    menuItemRevenue, deliveryFeeTotal, traysSold, topSellingItem,
    hasEstimatedMenuRevenue, totalPackageBookings,
  } = derived;

  const totalBookings = productLineMix.reduce((sum, line) => sum + line.count, 0);
  // The row where the running total first reaches 80% — everything down to and
  // including it is what the business actually runs on.
  const paretoIndex = packageMix.findIndex(p => p.cumulativeShare >= PARETO_LINE);

  return (
    <div className="space-y-6">

      {/* ---------- 1. PRODUCT LINE ---------- */}
      <Panel
        title="Revenue by Product Line"
        description="The only place packages and short orders belong in one table — here they really are two parts of one whole. Everything below this panel keeps them apart."
      >
        {combinedRevenue === 0 ? (
          <div className={EMPTY}>No revenue in this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={TH}>
                  <th className="p-4">Product Line</th>
                  <th className="p-4">Bookings</th>
                  <th className="p-4 text-right">Revenue</th>
                  <th className="p-4 w-1/3">Share of Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {productLineMix.map((line) => (
                  <tr
                    key={line.key}
                    onClick={() => onOpenDetail({
                      title: line.name,
                      description: line.key === 'Package'
                        ? 'From the booking table: active package bookings with an event date in the selected period, at their contract value.'
                        : 'From the booking table: active short orders with an event date in the selected period, at their contract value including delivery fees.',
                      fields: [
                        { label: 'Revenue', value: formatCurrency(line.revenue), emphasis: true },
                        { label: 'Share of total revenue', value: formatPercent(line.revenueShare) },
                        { label: 'Bookings', value: line.count },
                      ],
                    })}
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="p-4 font-bold text-slate-900">{line.name}</td>
                    <td className="p-4 text-slate-700 tabular-nums">{line.count}</td>
                    <td className="p-4 text-right font-semibold text-emerald-700 tabular-nums">{formatCurrency(line.revenue)}</td>
                    <td className="p-4"><ShareBar value={line.revenueShare} /></td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold text-slate-900">
                  <td className="p-4">Total</td>
                  <td className="p-4 tabular-nums">{totalBookings}</td>
                  <td className="p-4 text-right tabular-nums">{formatCurrency(combinedRevenue)}</td>
                  <td className="p-4 text-xs tabular-nums">100.0%</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* ---------- 2. PACKAGE MIX ---------- */}
      <Panel
        title="Package Mix"
        description={`Every package measured against total package revenue — this column adds up to 100%, so the top package's share is a real number rather than an automatic full bar. Cumulative shows the running total down the list; where it passes ${PARETO_LINE}% is the line between the packages the business runs on and the tail worth reviewing.`}
      >
        {packageMix.length === 0 ? (
          <div className={EMPTY}>No package bookings in this period.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={TH}>
                  <th className="p-4">Package</th>
                  <th className="p-4">Bookings</th>
                  <th className="p-4">Share of Bookings</th>
                  <th className="p-4 text-right">Revenue</th>
                  <th className="p-4 w-56">Share of Revenue</th>
                  <th className="p-4 text-right">Cumulative</th>
                  <th className="p-4 text-right">Avg per Booking</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {packageMix.map((pkg, index) => (
                  <tr
                    key={pkg.id}
                    onClick={() => onOpenDetail({
                      title: pkg.name,
                      description: 'From the booking table: active bookings of this package with an event date in the selected period. Share is this package’s revenue divided by the revenue of all packages.',
                      badge: index <= paretoIndex && paretoIndex !== -1
                        ? { label: `Top ${PARETO_LINE}%`, variant: 'good' }
                        : { label: 'Tail', variant: 'neutral' },
                      fields: [
                        { label: 'Revenue', value: formatCurrency(pkg.revenue), emphasis: true },
                        { label: 'Share of package revenue', value: formatPercent(pkg.revenueShare) },
                        { label: 'Bookings', value: pkg.count },
                        { label: 'Share of package bookings', value: formatPercent(pkg.countShare) },
                        { label: 'Average value per booking', value: formatCurrency(pkg.averageValue) },
                      ],
                    })}
                    className={`hover:bg-slate-50 cursor-pointer ${paretoIndex !== -1 && index === paretoIndex ? 'border-b-2 border-b-[#008A45]/40' : ''}`}
                  >
                    <td className="p-4 font-bold text-slate-900">{pkg.name}</td>
                    <td className="p-4 text-slate-700 tabular-nums">{pkg.count}</td>
                    <td className="p-4 text-slate-500 text-xs tabular-nums">{formatPercent(pkg.countShare)}</td>
                    <td className="p-4 text-right font-semibold text-emerald-700 tabular-nums">{formatCurrency(pkg.revenue)}</td>
                    <td className="p-4"><ShareBar value={pkg.revenueShare} /></td>
                    <td className="p-4 text-right text-slate-500 text-xs tabular-nums">{formatPercent(pkg.cumulativeShare)}</td>
                    <td className="p-4 text-right text-slate-700 tabular-nums">{formatCurrency(pkg.averageValue)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold text-slate-900">
                  <td className="p-4">All packages</td>
                  <td className="p-4 tabular-nums">{totalPackageBookings}</td>
                  <td className="p-4 text-xs tabular-nums">100.0%</td>
                  <td className="p-4 text-right tabular-nums">{formatCurrency(packageRevenue)}</td>
                  <td className="p-4 text-xs tabular-nums">100.0%</td>
                  <td className="p-4 text-right text-slate-400">—</td>
                  <td className="p-4 text-right tabular-nums">
                    {formatCurrency(totalPackageBookings > 0 ? packageRevenue / totalPackageBookings : 0)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {paretoIndex !== -1 && packageMix.length > 1 && (
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">{paretoIndex + 1}</span> of {packageMix.length} package{packageMix.length === 1 ? '' : 's'} account for the first {PARETO_LINE}% of package revenue.
          </div>
        )}
      </Panel>

      {/* ---------- 3. MENU ITEM MIX ---------- */}
      <Panel
        title="Menu Item Mix"
        description="Short order items measured against total menu item revenue. Trays sold and revenue are shown side by side on purpose: the item people order most and the item that earns most are rarely the same item, and one column can never show both."
      >
        {menuItemMix.length === 0 ? (
          <div className={EMPTY}>No short order items in this period.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={TH}>
                    <th className="p-4">Menu Item</th>
                    <th className="p-4">Trays Sold</th>
                    <th className="p-4">Share of Trays</th>
                    <th className="p-4 text-right">Revenue</th>
                    <th className="p-4 w-56">Share of Revenue</th>
                    <th className="p-4 text-right">Cumulative</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {menuItemMix.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => onOpenDetail({
                        title: item.name,
                        description: 'From short order bookings’ menu_selections in the selected period. Each order’s food revenue (its total minus the delivery fee) is split across its items in proportion to menu price × quantity, so these figures add up to money actually received.',
                        badge: topSellingItem && topSellingItem.id === item.id
                          ? { label: 'Most ordered', variant: 'info' }
                          : null,
                        fields: [
                          { label: 'Revenue', value: formatCurrency(item.revenue), emphasis: true },
                          { label: 'Share of menu item revenue', value: formatPercent(item.revenueShare) },
                          { label: 'Trays sold', value: `${item.quantity} trays` },
                          { label: 'Share of all trays sold', value: formatPercent(item.countShare) },
                          { label: 'Orders including this item', value: item.count },
                        ],
                      })}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="p-4 font-bold text-slate-900">
                        {item.name}
                        {topSellingItem && topSellingItem.id === item.id && (
                          <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-semibold rounded-full border border-blue-200 whitespace-nowrap">
                            Most ordered
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-slate-700 tabular-nums">{item.quantity}</td>
                      <td className="p-4 text-slate-500 text-xs tabular-nums">{formatPercent(item.countShare)}</td>
                      <td className="p-4 text-right font-semibold text-emerald-700 tabular-nums">{formatCurrency(item.revenue)}</td>
                      <td className="p-4"><ShareBar value={item.revenueShare} /></td>
                      <td className="p-4 text-right text-slate-500 text-xs tabular-nums">{formatPercent(item.cumulativeShare)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold text-slate-900">
                    <td className="p-4">All menu items</td>
                    <td className="p-4 tabular-nums">{traysSold}</td>
                    <td className="p-4 text-xs tabular-nums">100.0%</td>
                    <td className="p-4 text-right tabular-nums">{formatCurrency(menuItemRevenue)}</td>
                    <td className="p-4 text-xs tabular-nums">100.0%</td>
                    <td className="p-4 text-right text-slate-400">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {/* Ties this table back to the Short Orders row in panel 1, so the
                two panels can be checked against each other. */}
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-600 space-y-1">
              <div className="flex justify-between max-w-md">
                <span>Menu items</span>
                <span className="font-semibold tabular-nums">{formatCurrency(menuItemRevenue)}</span>
              </div>
              <div className="flex justify-between max-w-md">
                <span>Delivery fees</span>
                <span className="font-semibold tabular-nums">{formatCurrency(deliveryFeeTotal)}</span>
              </div>
              <div className="flex justify-between max-w-md pt-1 border-t border-slate-300 text-slate-800">
                <span className="font-semibold">Short order revenue</span>
                <span className="font-bold tabular-nums">{formatCurrency(shortOrderRevenue)}</span>
              </div>
              {hasEstimatedMenuRevenue && (
                <p className="pt-2 text-amber-700">
                  Some orders had no priced items to split against — those are counted at current menu prices instead.
                </p>
              )}
            </div>
          </>
        )}
      </Panel>

      {/* ---------- 4. CATEGORY DEMAND ---------- */}
      <Panel
        title="Category Demand"
        description="How often each food category appears across package bookings. One package usually includes several categories, so a booking counts toward each of them — these shares are of all package bookings, and they add up to more than 100% on purpose."
      >
        <div className="p-5 space-y-3">
          {categoryDemandData.length === 0 ? (
            <p className="text-sm text-slate-400 italic text-center py-4">No category data for this period.</p>
          ) : (
            categoryDemandData.map((cat) => (
              <button
                key={cat.name}
                onClick={() => onOpenDetail({
                  title: cat.name,
                  description: 'From the package_category table: package bookings in this period whose package includes this category.',
                  fields: [
                    { label: 'Bookings including this category', value: cat.bookings, emphasis: true },
                    { label: 'Share of all package bookings', value: formatPercent(cat.share) },
                    { label: 'Total package bookings', value: totalPackageBookings },
                  ],
                })}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-slate-700">{cat.name}</span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {cat.bookings} of {totalPackageBookings} bookings · {formatPercent(cat.share)}
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div
                    className="h-2 rounded-full bg-[#008A45]"
                    style={{ width: `${Math.min(100, Math.max(0, cat.share))}%` }}
                  />
                </div>
              </button>
            ))
          )}
        </div>
      </Panel>

      <p className={`text-xs text-slate-500 rounded-xl border p-4 ${cardColorClasses('green')}`}>
        Revenue here is contract value — what each booking is worth in total, whether or not it has been paid.
        Rejected and cancelled bookings are excluded throughout. Every share column is measured against its own
        product line's total, which is why each one adds up to 100%.
      </p>
    </div>
  );
}
