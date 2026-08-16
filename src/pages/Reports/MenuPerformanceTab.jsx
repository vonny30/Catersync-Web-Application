// src/pages/Reports/MenuPerformanceTab.jsx
import { formatCurrency } from './helpers';

export default function MenuPerformanceTab({ derived, onOpenDetail }) {
  const { menuPerformanceData, categoryPopularityData } = derived;
  const maxCategoryBookings = Math.max(1, ...categoryPopularityData.map(c => c.bookings));

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">Comprehensive Menu Performance – Packages & Short Order Items</h3>
          <p className="text-xs text-slate-500 mt-1">Performance is based on total revenue generated (relative to highest performer).</p>
        </div>
        {menuPerformanceData.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No performance data available.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                  <th className="p-4">Name</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Popularity Metric</th>
                  <th className="p-4">Total Orders / Qty</th>
                  <th className="p-4">Gross Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {menuPerformanceData.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => onOpenDetail({
                      title: item.name,
                      description: item.type === 'Package'
                        ? 'From the booking table: bookings of this package in the selected period.'
                        : 'From short-order bookings\' menu_selections: orders including this menu item in the selected period.',
                      badge: { label: item.type, variant: item.type === 'Package' ? 'info' : 'neutral' },
                      fields: [
                        { label: 'Revenue generated', value: formatCurrency(item.revenueGenerated), emphasis: true },
                        { label: item.type === 'Menu Item' ? 'Quantity ordered' : 'Total orders', value: item.type === 'Menu Item' ? `${item.quantity} trays` : item.totalOrders },
                        { label: 'Popularity (vs. top performer)', value: `${item.performance}%` },
                      ],
                    })}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <td className="p-4 font-bold text-slate-900">{item.name}</td>
                    <td className="p-4">
                      {item.type === 'Package' ? (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full border border-blue-200 whitespace-nowrap">Package</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full border border-purple-200 whitespace-nowrap">Menu Item</span>
                      )}
                    </td>
                    <td className="p-4 w-1/3">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-slate-600 w-8">{item.performance}%</span>
                        <div className="w-full bg-slate-200 rounded-full h-2 max-w-xs">
                          <div className={`h-2 rounded-full ${item.status === 'warning' ? 'bg-red-500' : 'bg-[#008A45]'}`} style={{ width: `${item.performance}%` }}></div>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 font-medium text-slate-700">
                      {item.type === 'Menu Item' ? `${item.quantity} trays` : `${item.totalOrders} orders`}
                    </td>
                    <td className="p-4 font-bold text-emerald-700">{formatCurrency(item.revenueGenerated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">Category Popularity</h3>
          <p className="text-xs text-slate-500 mt-1">How often each food category appears across package bookings in this period.</p>
        </div>
        <div className="p-5 space-y-3">
          {categoryPopularityData.length === 0 ? (
            <p className="text-sm text-slate-400 italic text-center py-4">No category data for this period.</p>
          ) : (
            categoryPopularityData.map((cat) => (
              <button
                key={cat.name}
                onClick={() => onOpenDetail({
                  title: cat.name,
                  description: 'From the package_category table: package bookings whose package includes this category, in the selected period.',
                  fields: [{ label: 'Bookings including this category', value: cat.bookings, emphasis: true }],
                })}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-semibold text-slate-700">{cat.name}</span>
                  <span className="text-xs text-slate-500">{cat.bookings} booking(s)</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div className="h-2 rounded-full bg-[#008A45]" style={{ width: `${(cat.bookings / maxCategoryBookings) * 100}%` }} />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
