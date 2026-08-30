// Assign a vehicle to a booking, from the booking's own page.
//
// Previously the detail pages' "Assign vehicle" button navigated to the
// Vehicles page and opened its modal there, carrying the booking id in router
// state. That threw away the manager's place on the page they were reading,
// and left them on a different page once they were done — a detour for a
// decision that belongs to the booking in front of them.
//
// This is the same job with the booking already known, so there is no booking
// picker. The rules it enforces are NOT reimplemented: conflict detection and
// the dispatch window come from utils/vehicle, which is also what the Vehicles
// page calls.
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Truck, X, Search, Clock, AlertTriangle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../supabase';
import { fetchAllRows } from '../utils/fetchAllRows';
import { ACTIVE_BOOKING_STATUSES } from '../utils/bookingStatus';
import {
  defaultSetupDispatch, findConflictingAssignment, describeAssignment, needsTransport,
} from '../utils/vehicle';

export default function AssignVehicleModal({ booking, isOpen, onClose, onAssigned }) {
  const [vehicles, setVehicles] = useState([]);
  const [assignments, setAssignments] = useState([]);
  // Starts true: the fleet is always being fetched on mount, and flipping it
  // on inside the effect would be a synchronous setState during render.
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState([]);
  const [search, setSearch] = useState('');
  // Suggested departure: travel plus setup, so setup finishes as the event
  // starts. Clamped to now, because a suggestion in the past is not one.
  // Computed at mount, which is exactly when the modal opens.
  const [dispatchValue, setDispatchValue] = useState(() => {
    const suggested = defaultSetupDispatch(booking);
    if (!suggested) return '';
    if (suggested < new Date()) suggested.setTime(Date.now());
    const offsetMs = suggested.getTime() - suggested.getTimezoneOffset() * 60 * 1000;
    return new Date(offsetMs).toISOString().slice(0, 16);
  });

  // The fleet and every live assignment: the second is what makes a conflict
  // answerable at all, so it is fetched even though nothing displays it.
  //
  // Declared inside the effect rather than as a useCallback so the async
  // boundary is explicit — the setState calls happen after an await, never
  // synchronously during the effect — and so the cancellation guard has
  // somewhere to live. Closing the modal mid-fetch must not write state into
  // an unmounted component.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [vehicleData, assignData] = await Promise.all([
          fetchAllRows(
            () => supabase
              .from('vehicle')
              .select('vehicle_id, plate_number, vehicle_type, vehicle_status')
              .order('plate_number').order('vehicle_id'),
            'fleet for assign modal'
          ),
          fetchAllRows(
            () => supabase
              .from('vehicle_assign')
              .select(`
                assignment_id, vehicle_id, booking_id, assignment_status, dispatch_datetime,
                booking:booking_id (booking_id, booking_number, booking_type, event_datetime, booking_status)
              `)
              .order('assignment_id'),
            'assignments for assign modal'
          ),
        ]);
        if (cancelled) return;
        setVehicles(vehicleData);
        setAssignments(assignData);
      } catch (error) {
        if (cancelled) return;
        console.error('Assign modal load failed:', error);
        toast.error('Could not load the fleet. Close and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!isOpen) return null;

  const eventAt = booking?.event_datetime ? new Date(booking.event_datetime) : null;
  const chosen = dispatchValue ? new Date(dispatchValue) : null;
  const suggested = defaultSetupDispatch(booking);
  const isSuggested = !!(chosen && suggested) && Math.abs(chosen - suggested) < 60 * 1000;

  const describeGap = (from, to) => {
    const mins = Math.round(Math.abs(to - from) / 60000);
    const h = Math.floor(mins / 60), m = mins % 60;
    const parts = [h ? `${h} hour${h === 1 ? '' : 's'}` : null, m ? `${m} min` : null].filter(Boolean);
    return parts.length ? parts.join(' ') : 'less than a minute';
  };

  const visible = vehicles.filter(v =>
    v.plate_number?.toLowerCase().includes(search.trim().toLowerCase())
  );

  const toggle = (vehicleId) => {
    setSelectedVehicleIds(prev =>
      prev.includes(vehicleId) ? prev.filter(x => x !== vehicleId) : [...prev, vehicleId]
    );
  };

  const handleAssign = async () => {
    // The button that opens this is gated, but state can change under a page
    // that is already open — approval auto-allocates, so an assignment made
    // just before it would be duplicated rather than honoured.
    if (!ACTIVE_BOOKING_STATUSES.includes(booking?.booking_status)) {
      toast.error(`This booking is ${booking?.booking_status || 'not active'}, so it cannot be dispatched. Vehicles are assigned once a booking is approved.`);
      return;
    }
    if (selectedVehicleIds.length === 0) { toast.error('Please select at least one vehicle.'); return; }
    if (!dispatchValue) { toast.error('Please set a dispatch date/time.'); return; }
    if (!eventAt) { toast.error('This booking has no event date.'); return; }

    // Same guard the Vehicles page applies, via the same helper: an
    // overlapping RUN blocks the assignment, another booking on the same day
    // does not.
    const conflicts = [];
    for (const vehicleId of selectedVehicleIds) {
      const clash = findConflictingAssignment(assignments, vehicleId, booking, dispatchValue);
      if (clash) {
        const v = vehicles.find(x => x.vehicle_id === vehicleId);
        conflicts.push(`${v?.plate_number || vehicleId} - ${describeAssignment(clash)}`);
      }
    }
    if (conflicts.length > 0) {
      toast.error(`This run overlaps work already booked: ${conflicts.join('; ')}. Move the dispatch time or pick another vehicle.`, { duration: 8000 });
      return;
    }

    setIsSubmitting(true);
    try {
      const inserts = selectedVehicleIds.map(vehicleId => ({
        vehicle_id: vehicleId,
        booking_id: booking.booking_id,
        // An instant, not a wall-clock string: the column is timestamptz, and
        // a zoneless value would be read as UTC and land eight hours out.
        dispatch_datetime: new Date(dispatchValue).toISOString(),
        assignment_status: 'Scheduled',
      }));
      const { error } = await supabase.from('vehicle_assign').insert(inserts);
      if (error) throw error;
      toast.success(`Assigned ${inserts.length} vehicle${inserts.length === 1 ? '' : 's'}.`);
      onClose?.();
      onAssigned?.();
    } catch (error) {
      console.error('Assign failed:', error);
      toast.error('Failed to assign vehicles: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden">
        <div className="flex justify-between items-start px-6 py-5 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Truck size={18} className="text-[#008A45]" /> Assign Vehicle
            </h2>
            <p className="text-[13px] text-slate-600 mt-0.5">
              {booking?.booking_number || 'This booking'}
              {eventAt && ` · ${eventAt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* A customer pickup should never have reached this modal — the
              button that opens it is hidden — but state can change under a
              page that is already open, so it is said rather than assumed. */}
          {booking && !needsTransport(booking) && (
            <p className="flex items-start gap-1.5 text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>This is a customer pickup, so it needs no vehicle. Change the Service Method to Delivery if that is wrong.</span>
            </p>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Select Vehicles</label>
            <div className="relative mb-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search plate number..."
                className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
              />
            </div>

            {loading ? (
              <p className="text-sm text-slate-500 flex items-center gap-1.5 py-4 justify-center">
                <Loader2 size={14} className="animate-spin" /> Checking which vehicles are free...
              </p>
            ) : visible.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No vehicles found.</p>
            ) : (
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
                {visible.map(v => {
                  const outOfService = v.vehicle_status !== 'Available';
                  const clash = outOfService ? null : findConflictingAssignment(assignments, v.vehicle_id, booking, dispatchValue);
                  const disabled = outOfService || !!clash;
                  const checked = selectedVehicleIds.includes(v.vehicle_id);
                  return (
                    <label
                      key={v.vehicle_id}
                      className={`flex items-start gap-2.5 px-3 py-2.5 text-sm transition-colors ${
                        disabled ? 'bg-slate-50 opacity-70 cursor-not-allowed'
                          : checked ? 'bg-[#EAF3F2] cursor-pointer' : 'bg-white hover:bg-slate-50 cursor-pointer'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(v.vehicle_id)}
                        className="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-slate-800">{v.plate_number}</span>
                        <span className="text-xs text-slate-500 ml-2">({v.vehicle_type})</span>
                        {outOfService && (
                          <span className="block text-[11px] text-slate-500 mt-0.5">{v.vehicle_status} — not available to dispatch</span>
                        )}
                        {clash && (
                          <span className="block text-[11px] text-amber-800 mt-0.5">Already out on {describeAssignment(clash)}</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-slate-500 mt-1.5">Selected: <span className="font-bold text-slate-700">{selectedVehicleIds.length}</span> vehicle{selectedVehicleIds.length === 1 ? '' : 's'}</p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Dispatch Date/Time (for all selected vehicles)</label>
            <input
              type="datetime-local"
              value={dispatchValue}
              onChange={(e) => setDispatchValue(e.target.value)}
              className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
            />
            {eventAt && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-slate-500">
                <Clock size={12} className="text-slate-400 shrink-0" />
                <span>Event starts at: <span className="font-semibold text-slate-700">{eventAt.toLocaleString()}</span></span>
                {chosen && !isNaN(chosen) && (
                  <>
                    <span>•</span>
                    <span className={isSuggested ? 'text-[#008A45] font-medium' : 'text-slate-600 font-medium'}>
                      {chosen <= eventAt
                        ? `Leaves ${describeGap(chosen, eventAt)} before the event`
                        : `Leaves ${describeGap(eventAt, chosen)} after the event starts`}
                      {isSuggested && ' (suggested)'}
                    </span>
                  </>
                )}
              </div>
            )}
            <p className="text-xs text-slate-400 mt-1">
              All selected vehicles will have the same dispatch time. The suggestion allows travel plus setup, so setup finishes as the event starts.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-200 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleAssign}
            disabled={isSubmitting || selectedVehicleIds.length === 0}
            className="px-4 py-2.5 bg-[#008A45] hover:bg-[#007038] disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
          >
            {isSubmitting && <Loader2 size={14} className="animate-spin" />}
            Assign {selectedVehicleIds.length} Vehicle{selectedVehicleIds.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
