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
import { getCurrentManagerId } from '../utils/currentManager';
import {
  findConflictingAssignment, describeClash, needsTransport,
  recheckConflictsBeforeInsert, DUPLICATE_ASSIGNMENT_CODE, duplicateAssignmentMessage,
  TRIP_LEG, legLabelFor, getTripType, getDispatchWindow,
  getDispatchBounds, defaultDispatchFor, isDispatchInBounds, describeDispatchBounds,
  toDateTimeLocalValue,
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
  // WHICH RUN this is. An explicit choice, not something inferred afterwards.
  //
  // Nothing new is stored: `vehicle_assign` has no run_type column and the
  // schema is shared with the customer mobile app. The leg is still derived on
  // read from `dispatch >= event`. What this selector buys is that the manager
  // says which run they mean BEFORE picking a time, and getDispatchBounds then
  // constrains the time so it can only derive back to that same leg — see the
  // note on getDispatchBounds. Selector and derivation cannot disagree.
  const [leg, setLeg] = useState(TRIP_LEG.setup);

  // Departure for the chosen leg, already clamped into that leg's bounds.
  // Computed at mount, which is exactly when the modal opens.
  const [dispatchValue, setDispatchValue] = useState(
    () => toDateTimeLocalValue(defaultDispatchFor(booking, TRIP_LEG.setup))
  );

  const chooseLeg = (nextLeg) => {
    setLeg(nextLeg);
    setDispatchValue(toDateTimeLocalValue(defaultDispatchFor(booking, nextLeg)));
  };

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
  const suggested = defaultDispatchFor(booking, leg);
  const isSuggested = !!(chosen && suggested) && Math.abs(chosen - suggested) < 60 * 1000;

  const tripType = getTripType(booking);
  // legLabelFor, never a hardcoded word: a short order's outbound leg is a
  // Delivery, not a Setup run, and hardcoding makes every short order read
  // wrong.
  const legChoices = [TRIP_LEG.setup, TRIP_LEG.pickup].map(key => ({
    key,
    label: legLabelFor(tripType, key),
  }));

  const bounds = getDispatchBounds(booking, leg);
  const inBounds = !chosen || isNaN(chosen) || isDispatchInBounds(chosen, booking, leg);
  const boundsSentence = describeDispatchBounds(booking, leg);
  // The window this dispatch time actually produces, in the same words the
  // Dispatch card uses.
  const previewWindow = chosen && !isNaN(chosen)
    ? getDispatchWindow({ dispatch_datetime: chosen.toISOString() }, booking)
    : null;

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

    // An input's min/max is advisory: it is bypassable by typing and ignored
    // outright by some browsers. The real refusal is here.
    if (!isDispatchInBounds(new Date(dispatchValue), booking, leg)) {
      toast.error(boundsSentence, { duration: 9000 });
      return;
    }

    // Same guard the Vehicles page applies, via the same helper: an
    // overlapping RUN blocks the assignment, another booking on the same day
    // does not.
    const conflicts = [];
    for (const vehicleId of selectedVehicleIds) {
      const clash = findConflictingAssignment(assignments, vehicleId, booking, dispatchValue, leg);
      if (clash) {
        const v = vehicles.find(x => x.vehicle_id === vehicleId);
        conflicts.push(`${v?.plate_number || vehicleId} - ${describeClash(clash, booking)}`);
      }
    }
    if (conflicts.length > 0) {
      toast.error(`This run overlaps work already booked: ${conflicts.join('; ')}. Move the dispatch time or pick another vehicle.`, { duration: 8000 });
      return;
    }

    setIsSubmitting(true);
    try {
      // The list above was loaded when the modal opened. Ask again, against
      // fresh rows, before writing — nothing in the database enforces this.
      const late = await recheckConflictsBeforeInsert(selectedVehicleIds, booking, dispatchValue, leg);
      if (late.length > 0) {
        const names = late.map(({ vehicle_id, conflict }) => {
          const v = vehicles.find(x => x.vehicle_id === vehicle_id);
          return `${v?.plate_number || vehicle_id} - ${describeClash(conflict, booking)}`;
        });
        toast.error(`Booked elsewhere while this was open: ${names.join('; ')}. Nothing was assigned — pick another vehicle or time.`, { duration: 9000 });
        setIsSubmitting(false);
        return;
      }

      // Who dispatched this. Resolved once here rather than per row, and null
      // if it cannot be resolved — the column is nullable, and losing the
      // attribution is better than refusing to assign the vehicle.
      const managerId = await getCurrentManagerId();

      const inserts = selectedVehicleIds.map(vehicleId => ({
        vehicle_id: vehicleId,
        booking_id: booking.booking_id,
        manager_id: managerId,
        // An instant, not a wall-clock string: the column is timestamptz, and
        // a zoneless value would be read as UTC and land eight hours out.
        dispatch_datetime: new Date(dispatchValue).toISOString(),
        assignment_status: 'Scheduled',
      }));
      const { error } = await supabase.from('vehicle_assign').insert(inserts);
      if (error?.code === DUPLICATE_ASSIGNMENT_CODE) {
        toast.error(duplicateAssignmentMessage, { duration: 8000 });
        return;
      }
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

        <div className="p-6 overflow-y-auto flex-1 space-y-4 bg-[#fbfcfd]">
          {/* A customer pickup should never have reached this modal — the
              button that opens it is hidden — but state can change under a
              page that is already open, so it is said rather than assumed. */}
          {booking && !needsTransport(booking) && (
            <p className="flex items-start gap-1.5 text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>This is a customer pickup, so it needs no vehicle. Change the Service Method to Delivery if that is wrong.</span>
            </p>
          )}

          {/* WHICH RUN — first, because it changes the suggested time, the
              allowed range, and which vehicles are already taken. Asking it
              after the vehicle list would mean answering it twice. */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Which run is this?</label>
            <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 border border-slate-200 rounded-[10px]">
              {legChoices.map(choice => (
                <button
                  key={choice.key}
                  type="button"
                  onClick={() => chooseLeg(choice.key)}
                  className={`px-3 py-2 rounded-[7px] text-[13.5px] font-semibold transition-colors cursor-pointer ${
                    leg === choice.key
                      ? 'bg-white text-[#007038] shadow-sm border border-[#c2dccf]'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {choice.label}
                </button>
              ))}
            </div>
            {previewWindow && (
              <p className="text-xs text-slate-600 mt-1.5 tabular-nums">
                Leaves {previewWindow.start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                {' → back '}
                {previewWindow.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                {previewWindow.start.toDateString() !== previewWindow.end.toDateString() && ' the next day'}
              </p>
            )}
          </div>

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
                  const clash = outOfService ? null : findConflictingAssignment(assignments, v.vehicle_id, booking, dispatchValue, leg);
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
                        {/* A clash on THIS booking reads differently from one
                            on another booking — describeClash picks the right
                            sentence, and a same-leg duplicate now lands here
                            rather than looking selectable until submit. */}
                        {clash && (
                          <span className="block text-[11px] text-amber-800 mt-0.5">{describeClash(clash, booking)}</span>
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
            {/* min/max are LOCAL wall-clock strings. An ISO/UTC value here
                would shift the allowed range by the timezone offset — the same
                eight-hour trap the insert path warns about, in reverse. */}
            <input
              type="datetime-local"
              value={dispatchValue}
              min={bounds ? toDateTimeLocalValue(bounds.min) : undefined}
              max={bounds ? toDateTimeLocalValue(bounds.max) : undefined}
              onChange={(e) => setDispatchValue(e.target.value)}
              className={`w-full border rounded-lg p-2.5 text-sm outline-none ${
                inBounds ? 'border-slate-300 focus:border-[#008A45]' : 'border-amber-400 bg-amber-50/50 focus:border-amber-500'
              }`}
            />
            {eventAt && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-slate-500">
                <Clock size={12} className="text-slate-400 shrink-0" />
                <span>Event starts at: <span className="font-semibold text-slate-700">{eventAt.toLocaleString()}</span></span>
                {chosen && !isNaN(chosen) && (
                  <>
                    <span>•</span>
                    {/* This line was the ONLY feedback, and it read exactly the
                        same whether the time made sense or not — it described
                        BKG-110's +68h as placidly as a correct +4h. It now
                        changes colour and names the breach. */}
                    <span className={
                      !inBounds ? 'text-amber-700 font-semibold'
                        : isSuggested ? 'text-[#008A45] font-medium'
                        : 'text-slate-600 font-medium'
                    }>
                      {chosen <= eventAt
                        ? `Leaves ${describeGap(chosen, eventAt)} before the event`
                        : `Leaves ${describeGap(eventAt, chosen)} after the event starts`}
                      {isSuggested && ' (suggested)'}
                      {!inBounds && ' — outside the allowed window'}
                    </span>
                  </>
                )}
              </div>
            )}
            {!inBounds && boundsSentence && (
              <p className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{boundsSentence}</span>
              </p>
            )}
            <p className="text-xs text-slate-400 mt-1">
              All selected vehicles will have the same dispatch time. {boundsSentence}
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
