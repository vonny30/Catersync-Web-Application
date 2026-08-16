// src/pages/Reports/EquipmentUtilizationTab.jsx
import { cardColorClasses } from './helpers';

export default function EquipmentUtilizationTab({ derived, onOpenDetail }) {
  const { equipmentUtilizationData } = derived;

  const totalUnits = equipmentUtilizationData.reduce((sum, e) => sum + e.total, 0);
  const totalDeployed = equipmentUtilizationData.reduce((sum, e) => sum + e.deployed, 0);
  const totalAvailable = equipmentUtilizationData.reduce((sum, e) => sum + e.available, 0);
  const totalDamaged = equipmentUtilizationData.reduce((sum, e) => sum + e.damaged, 0);
  const totalMaintenance = equipmentUtilizationData.reduce((sum, e) => sum + e.maintenance, 0);
  const utilizationRate = totalUnits > 0 ? Math.round((totalDeployed / totalUnits) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          onClick={() => onOpenDetail({
            title: 'Fleet Utilization',
            description: `Live snapshot across ${equipmentUtilizationData.length} equipment type(s) from the equipment table (stock) and booking_equipment table (items not yet returned).`,
            fields: [
              { label: 'Utilization', value: `${utilizationRate}%`, emphasis: true },
              { label: 'Deployed', value: totalDeployed },
              { label: 'Total units', value: totalUnits },
            ],
          })}
          className={`border rounded-2xl p-5 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 ${cardColorClasses('blue')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Utilization</p>
          <h3 className="text-2xl font-extrabold text-slate-900">{utilizationRate}%</h3>
          <p className="text-xs text-slate-500 font-medium mt-1.5">{totalDeployed} of {totalUnits} units deployed</p>
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Available Equipment',
            description: 'From the equipment table: units currently in good condition and not deployed to a booking.',
            fields: [{ label: 'Available units', value: totalAvailable, emphasis: true }],
          })}
          className={`border rounded-2xl p-5 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 ${cardColorClasses('green')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Available</p>
          <h3 className="text-2xl font-extrabold text-slate-900">{totalAvailable}</h3>
          <p className="text-xs text-slate-500 font-medium mt-1.5">Ready to deploy right now</p>
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
          <p className="text-xs text-slate-500 mt-1">Live snapshot of current inventory status — not affected by the date range above.</p>
        </div>
        {equipmentUtilizationData.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No equipment data available.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                  <th className="p-4">Equipment</th>
                  <th className="p-4">Total</th>
                  <th className="p-4">Deployed</th>
                  <th className="p-4">Available</th>
                  <th className="p-4">Damaged</th>
                  <th className="p-4">Maintenance</th>
                  <th className="p-4">Utilization</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {equipmentUtilizationData.map((item) => {
                  const usageRate = item.total > 0 ? Math.round((item.deployed / item.total) * 100) : 0;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => onOpenDetail({
                        title: item.name,
                        description: 'From the equipment table (stock, damaged, maintenance) and booking_equipment table (currently deployed, not yet returned).',
                        badge: usageRate >= 80 ? { label: 'Near capacity', variant: 'warning' } : { label: 'Available', variant: 'good' },
                        fields: [
                          { label: 'Utilization', value: `${usageRate}%`, emphasis: true },
                          { label: 'Deployed', value: item.deployed },
                          { label: 'Available', value: item.available },
                          { label: 'Damaged', value: item.damaged },
                          { label: 'In maintenance', value: item.maintenance },
                          { label: 'Total inventory', value: item.total },
                        ],
                      })}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="p-4 font-bold text-slate-900">{item.name}</td>
                      <td className="p-4 text-slate-700 font-semibold">{item.total}</td>
                      <td className="p-4 text-blue-600 font-medium">{item.deployed}</td>
                      <td className="p-4 text-emerald-600 font-medium">{item.available}</td>
                      <td className="p-4 text-red-500 font-medium">{item.damaged}</td>
                      <td className="p-4 text-amber-600 font-medium">{item.maintenance}</td>
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
