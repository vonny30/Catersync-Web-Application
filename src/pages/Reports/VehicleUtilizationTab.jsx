// src/pages/Reports/VehicleUtilizationTab.jsx
import { cardColorClasses, cardAccentClass } from './helpers';

export default function VehicleUtilizationTab({ derived, onOpenDetail }) {
  const { vehicleUtilizationData, totalVehicles, dispatchedVehicles } = derived;
  const utilizationRate = totalVehicles > 0 ? Math.round((dispatchedVehicles / totalVehicles) * 100) : 0;
  const availableVehicles = totalVehicles - dispatchedVehicles;

  return (
    <div className="space-y-[18px]">
      <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
        <button
          onClick={() => onOpenDetail({
            title: 'Fleet Size',
            description: 'From the vehicle table: every registered vehicle, regardless of current status.',
            fields: [{ label: 'Total vehicles', value: totalVehicles, emphasis: true }],
          })}
          className={`border rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${cardColorClasses()}`}
        >
          <span className={cardAccentClass('slate')} />
          <p className="text-[13px] font-semibold text-slate-600 mb-2">Fleet Size</p>
          <h3 className="text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">{totalVehicles}</h3>
          <p className="text-[13px] text-slate-600 mt-2.5">Total registered vehicles</p>
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Currently Dispatched',
            description: 'From the vehicle_assign table: vehicles with an assignment currently marked "Scheduled".',
            fields: [
              { label: 'Dispatched', value: dispatchedVehicles, emphasis: true },
              { label: 'Utilization', value: `${utilizationRate}%` },
            ],
          })}
          className={`border rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${cardColorClasses()}`}
        >
          <span className={cardAccentClass('green')} />
          <p className="text-[13px] font-semibold text-slate-600 mb-2">Currently Dispatched</p>
          <h3 className="text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">{dispatchedVehicles} <span className="text-[17px] text-slate-600 font-medium">({utilizationRate}%)</span></h3>
          <p className="text-[13px] text-slate-600 mt-2.5">On an active (Scheduled) assignment</p>
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Available Vehicles',
            description: 'From the vehicle table: vehicles with no active (Scheduled) assignment right now.',
            fields: [{ label: 'Available vehicles', value: availableVehicles, emphasis: true }],
          })}
          className={`border rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${cardColorClasses()}`}
        >
          <span className={cardAccentClass('teal')} />
          <p className="text-[13px] font-semibold text-slate-600 mb-2">Available</p>
          <h3 className="text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">{availableVehicles}</h3>
          <p className="text-[13px] text-slate-600 mt-2.5">Free for a new dispatch</p>
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">Vehicle Fleet Status</h3>
          <p className="text-xs text-slate-500 mt-1">Live snapshot of current status — not affected by the date range above.</p>
        </div>
        {vehicleUtilizationData.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">No vehicles registered.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fbfcfd] border-b border-slate-100">
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Plate Number</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Type</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Status</th>
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Active Dispatches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {vehicleUtilizationData.map((v) => (
                  <tr
                    key={v.id}
                    onClick={() => onOpenDetail({
                      title: v.plateNumber,
                      description: 'From the vehicle table (status) and vehicle_assign table (Scheduled assignments).',
                      badge: { label: v.status, variant: v.status === 'Available' ? 'good' : 'warning' },
                      fields: [
                        { label: 'Type', value: v.type },
                        { label: 'Active dispatches', value: v.activeDispatches, emphasis: true },
                      ],
                    })}
                    className="hover:bg-[#fbfcfd] cursor-pointer"
                  >
                    <td className="px-5 py-[15px] font-bold text-slate-900">{v.plateNumber}</td>
                    <td className="px-5 py-[15px] text-slate-700">{v.type}</td>
                    <td className="px-5 py-[15px]">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        v.status === 'Available' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-amber-100 text-amber-700 border border-amber-200'
                      }`}>
                        {v.status}
                      </span>
                    </td>
                    <td className="px-5 py-[15px] text-blue-600 font-medium">{v.activeDispatches}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
