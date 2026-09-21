// src/components/ApprovalModal.jsx
//
// THE approve pop-up — Bookings, Short Orders and the Dashboard all render
// this one, so approving looks and behaves the same wherever it starts.
//
// Why it exists: the Dashboard had its own copy, and it had drifted. It showed
// no availability (day schedule, equipment, fleet), never disabled Approve on
// an equipment shortage, offered a delivery fee on pickup orders, and — worst
// — its bookings were read without package_id, so approving a package from
// the Dashboard skipped the equipment hard-check AND the equipment allocation
// that approval exists to do (BKG-127 was approved that way with no
// equipment). Callers must pass a booking row carrying package_id.
//
// State stays in useApprovalHandlers; this is only its face.
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import ApprovalAvailabilityCheck from './ApprovalAvailabilityCheck';
import { extraPaxRate } from '../hooks/useApprovalHandlers';
import { getServiceMethod } from '../utils/vehicle';

const INPUT = 'w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none';
const NO_EQUIPMENT_CHECK = { applicable: false, loading: false, sufficient: true, shortages: [] };

/**
 * @param booking   the row being approved (approvalBooking from the hook)
 * @param data      approvalData from the hook
 */
export default function ApprovalModal({
  booking, data, onInputChange, onSubmit, onClose, submitting, onVehicleSelectionChange,
}) {
  // Reported by ApprovalAvailabilityCheck, so Approve is disabled on a
  // shortage instead of letting the manager click through and be refused by
  // the hook's equipment hard-check afterwards.
  const [equipment, setEquipment] = useState(NO_EQUIPMENT_CHECK);
  if (!booking) return null;

  const isShortOrder = booking.booking_type === 'Short Order';
  const pkg = booking.package;
  const isFixed = pkg?.pricing_type === 'fixed';
  const equipmentBlocked = !isShortOrder && equipment.applicable && (equipment.loading || !equipment.sufficient);
  const approveDisabled = submitting || equipmentBlocked;
  const money = (n) => `₱${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-bold text-slate-900">{isShortOrder ? 'Approve Short Order – Adjust Fees' : 'Approve Booking – Adjust Fees'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 bg-[#fbfcfd] text-left">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <span className="font-medium text-slate-600">Customer:</span>
              <span className="font-bold text-slate-900">{booking.customer?.first_name} {booking.customer?.last_name}</span>
              {isShortOrder ? (
                <>
                  <span className="font-medium text-slate-600">Venue:</span>
                  <span className="font-bold text-slate-900">{booking.venue || 'N/A'}</span>
                </>
              ) : (
                <>
                  <span className="font-medium text-slate-600">Package:</span>
                  <span className="font-bold text-slate-900">{pkg?.pkg_name}</span>
                  <span className="font-medium text-slate-600">Current Pax:</span>
                  <span className="font-bold text-slate-900">{booking.pax_count}</span>
                </>
              )}
              <span className="font-medium text-slate-600">Current Total:</span>
              <span className="font-bold text-slate-900">₱{booking.total_amount?.toLocaleString() || '0'}</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {/* The extra-pax input is hidden on a fixed package — it covers a
                  band and refuses anything outside it — so this line must not
                  keep offering it. */}
              {isShortOrder
                ? 'Short order pricing is per tray. You can add extra fees below.'
                : isFixed ? '* Add fees below.' : '* Adjust extra pax or add fees below.'}
            </p>
          </div>

          <ApprovalAvailabilityCheck
            onVehicleSelectionChange={onVehicleSelectionChange}
            booking={booking}
            effectivePaxCount={isShortOrder ? 0 : (booking.pax_count || 0) + (data.extraPax || 0)}
            onEquipmentStatusChange={isShortOrder ? undefined : setEquipment}
          />

          <div className="space-y-4">
            {isShortOrder ? (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Extra Quantity Fee (additional trays / items)</label>
                  <input type="number" name="extraQuantity" min="0" step="0.01" value={data.extraQuantity} onChange={onInputChange} className={INPUT} placeholder="e.g. 1000" />
                </div>
                {/* No delivery fee on a pickup order — withhold the field rather
                    than flag the mistake later. */}
                {getServiceMethod(booking)?.mode !== 'Pickup' && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Additional Delivery Fee</label>
                    <input type="number" name="extraDeliveryFee" min="0" step="0.01" value={data.extraDeliveryFee} onChange={onInputChange} className={INPUT} placeholder="e.g. 500" />
                  </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Other Fees (add-ons)</label>
                  <input type="number" name="additionalFee" min="0" step="0.01" value={data.additionalFee} onChange={onInputChange} className={INPUT} placeholder="e.g. 2000" />
                </div>
              </>
            ) : (
              <>
                {/* Hidden on a fixed package: extra guests cannot change its
                    total, so the field should not ask for a number. */}
                {!isFixed && (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Extra Pax (additional guests)</label>
                    <input type="number" name="extraPax" min="0" value={data.extraPax} onChange={onInputChange} className={INPUT} />
                    <p className="text-xs text-slate-400 mt-1">
                      Each extra guest costs ₱{extraPaxRate(pkg).toLocaleString()}
                      {pkg?.pricing_type === 'per_pax' ? ' (this package is priced per guest).' : ' (the extra-guest rate for this fixed-price package).'}
                    </p>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Other Fees (add-ons, extra services)</label>
                  <input type="number" name="additionalFee" min="0" step="0.01" value={data.additionalFee} onChange={onInputChange} className={INPUT} placeholder="e.g. 2000" />
                </div>
              </>
            )}
          </div>

          <div className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-lg p-4 flex justify-between items-center">
            <span className="font-bold text-slate-800">New Total:</span>
            <span className="text-xl font-extrabold text-[#008A45]">{money(data.newTotal)}</span>
          </div>
          <div className="text-sm text-slate-500">
            <p>Deposit (50%): <span className="font-bold">{money(data.newTotal * 0.5)}</span></p>
            <p className="text-xs mt-1">
              {isShortOrder
                ? 'A deposit may be required for large orders.'
                : 'A deposit is required to secure the booking. Non-refundable within 3 days of the event.'}
            </p>
          </div>

          {!isShortOrder && equipment.applicable && !equipment.loading && !equipment.sufficient && (
            <p className="text-xs font-semibold text-red-600 text-right">
              Can't approve — not enough {equipment.shortages.map(s => s.eqm_name).join(', ')} for this date.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
            <button type="button" onClick={onClose} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={approveDisabled}
              title={equipmentBlocked && !submitting ? 'Not enough equipment for this date' : undefined}
              className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Approving...' : 'Confirm Approval & Update Total'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
