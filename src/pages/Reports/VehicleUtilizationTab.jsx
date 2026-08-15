// src/pages/Reports/VehicleUtilizationTab.jsx
import { cardColorClasses } from './helpers';

export default function VehicleUtilizationTab({ derived, onOpenDetail }) {
  const { vehicleUtilizationData, totalVehicles, dispatchedVehicles } = derived;
  const utilizationRate = totalVehicles > 0 ? Math.round((dispatchedVehicles / totalVehicles) * 100) : 0;
  const availableVehicles = totalVehicles - dispatchedVehicles;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <button
          onClick={() => onOpenDetail({
            title: 'Fleet Size',
            description: 'From the vehicle table: every registered vehicle, regardless of current status.',
            fields: [{ label: 'Total vehicles', value: totalVehicles, emphasis: true }],
          })}
          className={`border rounded-xl p-6 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 ${cardColorClasses('purple')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Fleet Size</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{totalVehicles}</h3>
          <p className="text-xs text-slate-500 font-medium mt-2">Total registered vehicles</p>
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
          className={`border rounded-xl p-6 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 ${cardColorClasses('blue')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Currently Dispatched</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{dispatchedVehicles} <span className="text-lg text-slate-400 font-medium">({utilizationRate}%)</span></h3>
          <p className="text-xs text-slate-500 font-medium mt-2">On an active (Scheduled) assignment</p>
        </button>
        <button
          onClick={() => onOpenDetail({
            title: 'Available Vehicles',
            description: 'From the vehicle table: vehicles with no active (Scheduled) assignment right now.',
            fields: [{ label: 'Available vehicles', value: availableVehicles, emphasis: true }],
          })}
          className={`border rounded-xl p-6 text-left transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-opacity-50 ${cardColorClasses('green')}`}
        >
          <p className="text-xs font-bold text-slate-500 tracking-wider uppercase mb-1">Available</p>
          <h3 className="text-3xl font-extrabold text-slate-900">{availableVehicles}</h3>
          <p className="text-xs text-slate-500 font-medium mt-2">Free for a new dispatch</p>
        </button>
      </div>

      <div className="bg-[#f8fafa] border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">Vehicle Fleet Status</h3>
          <p className="text-xs text-slate-500 mt-1">Live snapshot of current status — not affected by the date range above.</p>
        </div>
        {vehicleUtilizationData.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">No vehicles registered.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#EAF3F2] text-slate-800 text-xs font-bold border-b border-slate-200">
                  <th className="p-4">Plate Number</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Active Dispatches</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
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
                    className="hover:bg-slate-50 cursor-pointer"
                  >
                    <td className="p-4 font-bold text-slate-900">{v.plateNumber}</td>
                    <td className="p-4 text-slate-700">{v.type}</td>
                    <td className="p-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        v.status === 'Available' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' : 'bg-amber-100 text-amber-700 border border-amber-200'
                      }`}>
                        {v.status}
                      </span>
                    </td>
                    <td className="p-4 text-blue-600 font-medium">{v.activeDispatches}</td>
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
