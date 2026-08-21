// src/pages/Reports/EquipmentUtilizationTab.jsx
import { cardColorClasses } from './helpers';

export default function EquipmentUtilizationTab({ derived, onOpenDetail }) {
  const { equipmentUtilizationData } = derived;

  const totalUnits = equipmentUtilizationData.reduce((sum, e) => sum + e.total, 0);
  const totalDeployed = equipmentUtilizationData.reduce((sum, e) => sum + e.deployed, 0);
  const totalUsable = equipmentUtilizationData.reduce((sum, e) => sum + e.usable, 0);
  const totalFree = equipmentUtilizationData.reduce((sum, e) => sum + e.free, 0);
  const totalDamaged = equipmentUtilizationData.reduce((sum, e) => sum + e.damaged, 0);
  const totalMaintenance = equipmentUtilizationData.reduce((sum, e) => sum + e.maintenance, 0);
  // Of the stock that can actually go out, how much is committed. Measuring
  // against everything owned would flatter the number by counting broken gear
  // as spare capacity.
  const utilizationRate = totalUsable > 0 ? Math.round((totalDeployed / totalUsable) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          onClick={() => onOpenDetail({
            title: 'Fleet Utilization',
            description: `Live snapshot across ${equipmentUtilizationData.length} equipment type(s) from the equipment table (stock) and booking_equipment table (items not yet returned).`,
            fields: [
              { label: 'Utilization', value: `${utilizationRate}%`, emphasis: true },
              { label: 'In use', value: totalDeployed },
              { label: 'Usable stock', value: totalUsable },
              { label: 'Units owned', value: totalUnits },
            ],
          })}
          className={`border rounded-2xl p-5 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 ${cardColorClasses('blue')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Utilization</p>
          <h3 className="text-2xl font-extrabold text-slate-900">{utilizationRate}%</h3>
          <p className="text-xs text-slate-500 font-medium mt-1.5">{totalDeployed} of {totalUsable} usable units in use</p>
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Available Equipment',
            description: 'From the equipment table: units currently in good condition and not deployed to a booking.',
            fields: [
              { label: 'Free now', value: totalFree, emphasis: true },
              { label: 'Usable stock', value: totalUsable },
              { label: 'In use', value: totalDeployed },
            ],
          })}
          className={`border rounded-2xl p-5 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 ${cardColorClasses('green')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Free Now</p>
          <h3 className="text-2xl font-extrabold text-slate-900">{totalFree}</h3>
          <p className="text-xs text-slate-500 font-medium mt-1.5">{totalUsable} usable − {totalDeployed} in use</p>
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Damaged Equipment',
            description: 'From the equipment table: units flagged as damaged (equipment.damaged_quantity), unavailable until repaired or replaced.',
            badge: totalDamaged > 0 ? { label: 'Needs attention', variant: 'warning' } : { label: 'None reported', variant: 'good' },
            fields: [{ label: 'Damaged units', value: totalDamaged, emphasis: true }],
          })}
          className={`border rounded-2xl p-5 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 ${cardColorClasses('red')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Damaged</p>
          <h3 className="text-2xl font-extrabold text-slate-900">{totalDamaged}</h3>
          <p className="text-xs text-slate-500 font-medium mt-1.5">Flagged, unavailable for booking</p>
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Equipment In Maintenance',
            description: 'From the equipment table: units currently set aside for maintenance (equipment.maintenance_quantity).',
            fields: [{ label: 'In maintenance', value: totalMaintenance, emphasis: true }],
          })}
          className={`border rounded-2xl p-5 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 ${cardColorClasses('amber')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">In Maintenance</p>
          <h3 className="text-2xl font-extrabold text-slate-900">{totalMaintenance}</h3>
          <p className="text-xs text-slate-500 font-medium mt-1.5">Temporarily out of rotation</p>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">Equipment by Type</h3>
          <p className="text-xs text-slate-500 mt-1">Live snapshot — not affected by the date range above. Owned − out of service = usable; usable − in use = free.</p>
        </div>
        {equipmentUtilizationData.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No equipment data available.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                  <th className="p-4">Equipment</th>
                  <th className="p-4">Owned</th>
                  <th className="p-4">Out of service</th>
                  <th className="p-4">Usable</th>
                  <th className="p-4">In use</th>
                  <th className="p-4">Free</th>
                  <th className="p-4">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {equipmentUtilizationData.map((item) => {
                  const usageRate = item.usable > 0 ? Math.round((item.deployed / item.usable) * 100) : 0;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => onOpenDetail({
                        title: item.name,
                        description: 'From the equipment table (stock, damaged, maintenance) and booking_equipment table (currently deployed, not yet returned).',
                        badge: usageRate >= 80 ? { label: 'Near capacity', variant: 'warning' } : { label: 'Available', variant: 'good' },
                        fields: [
                          { label: 'Utilization', value: `${usageRate}%`, emphasis: true },
                          { label: 'In use', value: item.deployed },
                          { label: 'Free now', value: item.free },
                          { label: 'Usable', value: item.usable },
                          { label: 'Damaged', value: item.damaged },
                          { label: 'Under maintenance', value: item.maintenance },
                          { label: 'Units owned', value: item.total },
                        ],
                      })}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="p-4 font-bold text-slate-900">{item.name}</td>
                      <td className="p-4 text-slate-700 font-semibold">{item.total}</td>
                      <td className="p-4 text-slate-600 font-medium">
                        {item.outOfService > 0
                          ? <span title={`${item.damaged} damaged, ${item.maintenance} under maintenance`}>−{item.outOfService}</span>
                          : <span className="text-slate-400">None</span>}
                      </td>
                      <td className="p-4 text-slate-900 font-bold">{item.usable}</td>
                      <td className="p-4 text-blue-600 font-medium">{item.deployed}</td>
                      <td className="p-4 text-emerald-600 font-medium">{item.free}</td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-slate-200 rounded-full h-1.5">
                            <div className="h-1.5 rounded-full bg-slate-700" style={{ width: `${usageRate}%` }}></div>
                          </div>
                          <span className="text-xs font-bold text-slate-700">{usageRate}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
