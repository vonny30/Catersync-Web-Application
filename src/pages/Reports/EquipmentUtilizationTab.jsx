// src/pages/Reports/EquipmentUtilizationTab.jsx
//
// Rendered as the "Equipment Stock" tab. The filename is kept — it is imported
// by name and renaming it is churn — but the tab no longer reports a rate.
//
// WHY THERE IS NO UTILIZATION PERCENTAGE HERE
//
// There was one, at two levels, and it was not merely unhelpful but wrong in a
// way no adjustment to the formula could fix:
//
//     committed / usable      (fleet-wide and per item)
//
// has no time dimension. `committed` sums every unreturned commitment across
// dates that never coexist, then divides by stock that is only owned once. An
// item booked for three separate days is counted three times against a single
// day's stock. Measured against live data the error grows with how many days
// an item spans — Chafing Dishes read 93% when its busiest single day used 41%,
// and earlier in this project it read 133%. The per-item bar was clamped with
// Math.min(100, ...), which is the code quietly knowing the value could exceed
// a hundred and hiding it instead of fixing it.
//
// A real utilization rate needs a bounded period and a per-day peak. The
// Vehicle Utilization tab does exactly that — dispatched vehicle-hours over
// available vehicle-hours in a fixed range, and it refuses to compute over All
// Time — so the contrast between the two tabs is deliberate: one measures a
// rate, and this one reports stock.
import { cardColorClasses, cardAccentClass } from './helpers';

export default function EquipmentUtilizationTab({ derived, onOpenDetail }) {
  const { equipmentUtilizationData } = derived;

  const totalDeployed = equipmentUtilizationData.reduce((sum, e) => sum + e.deployed, 0);
  const totalUsable = equipmentUtilizationData.reduce((sum, e) => sum + e.usable, 0);
  const totalFree = equipmentUtilizationData.reduce((sum, e) => sum + e.free, 0);
  const totalDamaged = equipmentUtilizationData.reduce((sum, e) => sum + e.damaged, 0);
  const totalMaintenance = equipmentUtilizationData.reduce((sum, e) => sum + e.maintenance, 0);

  return (
    <div className="space-y-[18px]">
      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr))]">
        <button
          onClick={() => onOpenDetail({
            title: 'Available Equipment',
            description: 'From the equipment table: units currently in good condition and not committed to a booking.',
            fields: [
              { label: 'Available now', value: totalFree, emphasis: true },
              { label: 'Usable stock', value: totalUsable },
              { label: 'Committed', value: totalDeployed },
            ],
          })}
          className={`border rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${cardColorClasses()}`}
        >
          <span className={cardAccentClass('teal')} />
          <p className="text-[13px] font-semibold text-slate-600 mb-2">Available Now</p>
          <h3 className="text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">{totalFree}</h3>
          <p className="text-[13px] text-slate-600 mt-2.5">{totalUsable} usable − {totalDeployed} committed</p>
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Damaged Equipment',
            description: 'From the equipment table: units flagged as damaged (equipment.damaged_quantity), unavailable until repaired or replaced.',
            badge: totalDamaged > 0 ? { label: 'Needs attention', variant: 'warning' } : { label: 'None reported', variant: 'good' },
            fields: [{ label: 'Damaged units', value: totalDamaged, emphasis: true }],
          })}
          className="relative overflow-hidden border border-[#f3d3d3] bg-[#fef4f4] rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)]"
        >
          <span className={cardAccentClass('red')} />
          <p className="text-[13px] font-semibold text-red-700 mb-2">Damaged</p>
          <h3 className="text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-red-700">{totalDamaged}</h3>
          <p className="text-[13px] text-red-600 mt-2.5">Flagged, unavailable for booking</p>
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Equipment In Maintenance',
            description: 'From the equipment table: units currently set aside for maintenance (equipment.maintenance_quantity).',
            fields: [{ label: 'In maintenance', value: totalMaintenance, emphasis: true }],
          })}
          className={`border rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${cardColorClasses()}`}
        >
          <span className={cardAccentClass('amber')} />
          <p className="text-[13px] font-semibold text-slate-600 mb-2">In Maintenance</p>
          <h3 className="text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">{totalMaintenance}</h3>
          <p className="text-[13px] text-slate-600 mt-2.5">Temporarily out of rotation</p>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">Equipment by Type</h3>
          <p className="text-xs text-slate-500 mt-1">Live snapshot — not affected by the date range above. Owned − out of service = usable; usable − committed = available.</p>
        </div>
        {equipmentUtilizationData.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">No equipment data available.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fbfcfd] border-b border-slate-100">
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Equipment</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Owned</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Out of service</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Usable</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Committed</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {equipmentUtilizationData.map((item) => {
                  // The badge that sat here — "Near capacity" at a usageRate of
                  // 80 or more — was built on the same timeless ratio, so it was
                  // not just imprecise but wrong: Chafing Dishes read "Near
                  // capacity" at 93% while its busiest day used 41%. It goes
                  // with the rate rather than being rebuilt on a guess.
                  return (
                    <tr
                      key={item.id}
                      onClick={() => onOpenDetail({
                        title: item.name,
                        description: 'From the equipment table (stock, damaged, maintenance) and booking_equipment table (committed and not yet returned).',
                        fields: [
                          { label: 'Committed', value: item.deployed, emphasis: true },
                          { label: 'Available now', value: item.free },
                          { label: 'Usable', value: item.usable },
                          { label: 'Damaged', value: item.damaged },
                          { label: 'Under maintenance', value: item.maintenance },
                          { label: 'Units owned', value: item.total },
                        ],
                      })}
                      className="hover:bg-[#fbfcfd] cursor-pointer"
                    >
                      <td className="px-5 py-[15px] text-[14.5px] font-semibold text-slate-900">{item.name}</td>
                      <td className="px-5 py-[15px] text-sm text-slate-800 text-right tabular-nums">{item.total}</td>
                      <td className="px-5 py-[15px] text-sm text-right tabular-nums">
                        {item.outOfService > 0
                          ? <span className="text-amber-700 font-medium" title={`${item.damaged} damaged, ${item.maintenance} under maintenance`}>−{item.outOfService}</span>
                          : <span className="text-slate-400">None</span>}
                      </td>
                      <td className="px-5 py-[15px] text-sm font-semibold text-slate-900 text-right tabular-nums">{item.usable}</td>
                      <td className="px-5 py-[15px] text-sm text-slate-800 text-right tabular-nums">{item.deployed}</td>
                      <td className="px-5 py-[15px] text-sm text-slate-800 text-right tabular-nums">{item.free}</td>
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
