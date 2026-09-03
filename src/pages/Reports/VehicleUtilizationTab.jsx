// src/pages/Reports/VehicleUtilizationTab.jsx
import { cardColorClasses, cardAccentClass } from './helpers';

export default function VehicleUtilizationTab({ derived, onOpenDetail }) {
  const { vehicleUtilizationData, totalVehicles, dispatchedVehicles, committedVehicles, fleetUtilization, serviceableVehicles } = derived;
  // "On the road" is a headcount of vehicles out RIGHT NOW, so the share it
  // belongs with is of the fleet — not the time-based utilization below, which
  // measures something different and would read as the same number twice.
  const onRoadShare = totalVehicles > 0 ? Math.round((dispatchedVehicles / totalVehicles) * 100) : 0;
  // Blueprint-01 defect 18. This was total minus dispatched, so a van flagged
  // Maintenance and therefore not dispatched was counted as available — the
  // one state where it is definitely not. Free means in service AND not out.
  const availableVehicles = Math.max(0, serviceableVehicles - dispatchedVehicles);
  const outOfServiceVehicles = totalVehicles - serviceableVehicles;

  return (
    <div className="space-y-[18px]">
      {/* Fleet utilization over the reporting range. A headcount answers "how
          many are out?"; this answers "how hard is the fleet working?", which
          is the question a percentage should be measuring. */}
      <section className="bg-white border border-slate-200/70 rounded-2xl p-6">
        <span className="block text-[13px] font-semibold text-slate-600 mb-2.5">Fleet utilization</span>
        {fleetUtilization ? (
          <>
            <span className="block text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">
              {fleetUtilization.percent.toFixed(1)}%
            </span>
            <div className="mt-[18px] mb-2.5 h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-[#008A45]" style={{ width: `${Math.min(100, Math.max(0, fleetUtilization.percent))}%` }} />
            </div>
            <span className="block text-[13px] text-slate-600 tabular-nums">
              {Math.round(fleetUtilization.dispatchedHours).toLocaleString()} vehicle-hours on the road
              &nbsp;÷&nbsp;
              {Math.round(fleetUtilization.availableHours).toLocaleString()} available
              &nbsp;·&nbsp;
              {fleetUtilization.serviceableVehicles} vehicle{fleetUtilization.serviceableVehicles === 1 ? '' : 's'} in service across this period
            </span>
          </>
        ) : (
          <span className="block text-[13px] text-slate-600 [text-wrap:pretty]">
            Needs a bounded date range. Over all time there is no fixed number of
            available hours to measure against, so this is left blank rather than
            filled with a figure that would not mean anything.
          </span>
        )}
      </section>

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
            title: 'On the road now',
            description: 'From vehicle_assign: vehicles whose dispatch window contains this moment. A vehicle booked for a future event is committed, not on the road — that count is shown separately.',
            fields: [
              { label: 'On the road now', value: dispatchedVehicles, emphasis: true },
              { label: 'Share of fleet', value: `${onRoadShare}%` },
              { label: 'Booked (now or later)', value: committedVehicles },
            ],
          })}
          className={`border rounded-2xl p-5 text-left transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${cardColorClasses()}`}
        >
          <span className={cardAccentClass('green')} />
          <p className="text-[13px] font-semibold text-slate-600 mb-2">On the road now</p>
          <h3 className="text-[32px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">{dispatchedVehicles} <span className="text-[17px] text-slate-600 font-medium">{onRoadShare}%</span></h3>
          <p className="text-[13px] text-slate-600 mt-2.5">{committedVehicles} booked now or later</p>
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Available Vehicles',
            description: 'From the vehicle table: vehicles in service AND with no dispatch window containing this moment. A vehicle under maintenance or flagged unavailable is not counted as free.',
            fields: [{ label: 'Available vehicles', value: availableVehicles, emphasis: true }, { label: 'In service', value: serviceableVehicles }, { label: 'Out of service', value: outOfServiceVehicles }],
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
                  <th className="px-5 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Trips booked</th>
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
                        { label: 'Trips booked', value: v.activeDispatches, emphasis: true },
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
