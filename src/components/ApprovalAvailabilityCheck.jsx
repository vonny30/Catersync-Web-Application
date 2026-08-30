// src/components/ApprovalAvailabilityCheck.jsx
//
// Shown inside the Approve modal (used identically from Bookings/ShortOrders
// list pages and their Details pages) so a manager sees the same day-schedule
// and equipment-capacity signal no matter where they approve from. Day
// Availability is scoped to the booking's own type — a Package booking only
// sees other Package bookings on that date, a Short Order only sees other
// Short Orders — since the two are run as separate lines of business here,
// not competing for the same venue/date. Equipment Availability only renders
// when the booking being approved is a package booking, since short orders
// don't track equipment. Recomputes equipment demand using the pax count as
// currently adjusted in the modal (base pax + extra pax), not the original
// booking value, so it stays accurate while the manager is still editing.
//
// Fleet Availability was added 29 Aug 2026 and applies to BOTH booking types,
// because short orders are delivered too. Three vehicles is the tightest
// constraint the business has, and until this existed a manager could approve
// an event on a day the whole fleet was already committed and only discover it
// at dispatch time. Approving now shows the plan and then commits it, the same
// way equipment already worked.
import { useState, useEffect, useRef } from 'react';
import { Calendar, Clock, Users, PackageCheck, MapPin, Loader2, AlertTriangle, Check, Truck, Package as PackageIcon } from 'lucide-react';
import { getBookingsOnDate } from '../utils/availability';
import { getEquipmentAvailabilityPreview } from '../utils/equipment';
import { getVehicleAvailabilityPreview } from '../utils/vehicle';
import { MAX_SHORT_ORDERS_PER_DAY } from '../utils/bookingStatus';

export default function ApprovalAvailabilityCheck({ booking, effectivePaxCount, onEquipmentStatusChange, onVehicleSelectionChange }) {
  const [dayBookings, setDayBookings] = useState([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [equipmentAvailability, setEquipmentAvailability] = useState([]);
  const [loadingEquipment, setLoadingEquipment] = useState(false);
  const [fleet, setFleet] = useState(null);
  const [loadingFleet, setLoadingFleet] = useState(false);
  // Which vehicles will actually go. Seeded from the suggestion, then the
  // manager's to change — the default is three because that is what a typical
  // package takes, not because three is all there is.
  const [selectedVehicleIds, setSelectedVehicleIds] = useState(null);

  const onVehicleSelectionChangeRef = useRef(onVehicleSelectionChange);
  useEffect(() => { onVehicleSelectionChangeRef.current = onVehicleSelectionChange; });

  // Reseed whenever a fresh plan arrives (a pax change re-runs the preview),
  // but never clobber a choice the manager has already made for this booking.
  const seededForRef = useRef(null);
  useEffect(() => {
    if (!fleet) return;
    const key = `${booking?.booking_id || 'none'}`;
    if (seededForRef.current === key) return;
    seededForRef.current = key;
    setSelectedVehicleIds(fleet.picks.map(pk => pk.vehicle_id));
  }, [fleet, booking?.booking_id]);

  useEffect(() => {
    if (selectedVehicleIds === null) return;
    onVehicleSelectionChangeRef.current?.(selectedVehicleIds);
  }, [selectedVehicleIds]);

  const toggleVehicle = (vehicleId) => {
    setSelectedVehicleIds(prev => {
      const cur = prev || [];
      return cur.includes(vehicleId) ? cur.filter(x => x !== vehicleId) : [...cur, vehicleId];
    });
  };

  // Keep the latest callback in a ref so the notify-effect below doesn't
  // need it as a dependency — parents often pass an inline function that's
  // a new reference every render, which would otherwise re-fire this effect
  // (and re-notify the parent) on every keystroke elsewhere in the modal.
  const onEquipmentStatusChangeRef = useRef(onEquipmentStatusChange);
  useEffect(() => {
    onEquipmentStatusChangeRef.current = onEquipmentStatusChange;
  });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!booking?.event_datetime) {
        if (!cancelled) setDayBookings([]);
        return;
      }
      if (!cancelled) setLoadingDay(true);
      try {
        const data = await getBookingsOnDate(booking.event_datetime, booking.booking_id, booking.event_datetime, booking.booking_type);
        if (!cancelled) setDayBookings(data);
      } catch (err) {
        console.error('Day schedule check failed:', err);
        if (!cancelled) setDayBookings([]);
      } finally {
        if (!cancelled) setLoadingDay(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [booking?.booking_id, booking?.event_datetime, booking?.booking_type]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!booking?.event_datetime || !booking?.package_id) {
        if (!cancelled) setEquipmentAvailability([]);
        return;
      }
      if (!cancelled) setLoadingEquipment(true);
      try {
        const data = await getEquipmentAvailabilityPreview(booking.event_datetime, booking.package_id, effectivePaxCount, booking.booking_id);
        if (!cancelled) setEquipmentAvailability(data);
      } catch (err) {
        console.error('Equipment availability check failed:', err);
        if (!cancelled) setEquipmentAvailability([]);
      } finally {
        if (!cancelled) setLoadingEquipment(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [booking?.booking_id, booking?.package_id, effectivePaxCount, booking?.event_datetime]);

  // Fleet check. Depends on pax because the number of vehicles is sized from
  // it, so it re-runs while the manager adjusts the guest count — same as the
  // equipment preview above.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!booking?.event_datetime) {
        if (!cancelled) setFleet(null);
        return;
      }
      if (!cancelled) setLoadingFleet(true);
      try {
        const data = await getVehicleAvailabilityPreview({ ...booking, pax_count: effectivePaxCount });
        if (!cancelled) setFleet(data);
      } catch (err) {
        console.error('Fleet availability check failed:', err);
        if (!cancelled) setFleet(null);
      } finally {
        if (!cancelled) setLoadingFleet(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [booking?.booking_id, booking?.event_datetime, booking?.booking_type, effectivePaxCount]);

  // Report equipment status up to the parent so it can disable the Approve
  // button instead of letting the manager click through and get blocked
  // afterward.
  useEffect(() => {
    if (!onEquipmentStatusChangeRef.current) return;
    const applicable = !!booking?.package_id;
    const shortages = equipmentAvailability.filter(e => !e.sufficient);
    onEquipmentStatusChangeRef.current({
      applicable,
      loading: applicable && loadingEquipment,
      sufficient: !applicable || shortages.length === 0,
      shortages,
    });
  }, [booking?.package_id, loadingEquipment, equipmentAvailability]);

  if (!booking) return null;

  const isConflict = dayBookings.some(b => b.isCloseInTime);
  const isShortOrder = booking.booking_type === 'Short Order';
  // dayBookings is already scoped to same-type bookings only (bookingType
  // param above), so for a Short Order this is exactly "other Short Orders
  // already Approved/Confirmed on this date" — +1 counts this one too.
  const shortOrdersOnDate = dayBookings.length + 1;
  const atDailyLimit = isShortOrder && shortOrdersOnDate > MAX_SHORT_ORDERS_PER_DAY;
  const slotsLeft = Math.max(0, MAX_SHORT_ORDERS_PER_DAY - dayBookings.length);
  const dayStatus = loadingDay ? 'loading' : atDailyLimit ? 'warning' : dayBookings.length === 0 ? 'clear' : isConflict ? 'warning' : 'info';

  const dayTheme = {
    loading: { wrap: 'border-slate-200 bg-slate-50', bar: 'bg-slate-300', icon: 'text-slate-400', pill: 'bg-slate-200 text-slate-600' },
    clear: { wrap: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white', bar: 'bg-emerald-500', icon: 'text-emerald-600', pill: 'bg-emerald-600 text-white' },
    warning: { wrap: 'border-red-200 bg-gradient-to-br from-red-50 to-white', bar: 'bg-red-500', icon: 'text-red-600', pill: 'bg-red-600 text-white' },
    info: { wrap: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white', bar: 'bg-amber-500', icon: 'text-amber-600', pill: 'bg-amber-500 text-white' },
  }[dayStatus];

  const eqAllSufficient = equipmentAvailability.length > 0 && equipmentAvailability.every(e => e.sufficient);
  const eqShortCount = equipmentAvailability.filter(e => !e.sufficient).length;
  const eqStatus = loadingEquipment ? 'loading' : equipmentAvailability.length === 0 ? 'empty' : eqAllSufficient ? 'clear' : 'warning';
  const eqTheme = {
    loading: { wrap: 'border-slate-200 bg-slate-50', bar: 'bg-slate-300', icon: 'text-slate-400', pill: 'bg-slate-200 text-slate-600' },
    empty: { wrap: 'border-slate-200 bg-slate-50', bar: 'bg-slate-300', icon: 'text-slate-400', pill: 'bg-slate-200 text-slate-600' },
    clear: { wrap: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white', bar: 'bg-emerald-500', icon: 'text-emerald-600', pill: 'bg-emerald-600 text-white' },
    warning: { wrap: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white', bar: 'bg-amber-500', icon: 'text-amber-600', pill: 'bg-amber-500 text-white' },
  }[eqStatus];

  const isPickupOrder = !!fleet?.noTransportNeeded;
  const fleetStatus = loadingFleet ? 'loading'
    : !fleet ? 'empty'
    : isPickupOrder ? 'pickup'
    : fleet.sufficient ? 'clear'
    : 'warning';
  const fleetTheme = {
    loading: { wrap: 'border-slate-200 bg-slate-50', bar: 'bg-slate-300', icon: 'text-slate-400', pill: 'bg-slate-200 text-slate-600' },
    empty: { wrap: 'border-slate-200 bg-slate-50', bar: 'bg-slate-300', icon: 'text-slate-400', pill: 'bg-slate-200 text-slate-600' },
    clear: { wrap: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white', bar: 'bg-emerald-500', icon: 'text-emerald-600', pill: 'bg-emerald-600 text-white' },
    warning: { wrap: 'border-amber-200 bg-gradient-to-br from-amber-50 to-white', bar: 'bg-amber-500', icon: 'text-amber-600', pill: 'bg-amber-500 text-white' },
    pickup: { wrap: 'border-slate-200 bg-gradient-to-br from-slate-50 to-white', bar: 'bg-slate-400', icon: 'text-slate-500', pill: 'bg-slate-600 text-white' },
  }[fleetStatus];

  const atTime = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-3">
      {/* Day Availability — scoped to this booking's own type only */}
      <div className={`relative overflow-hidden border rounded-xl shadow-sm ${dayTheme.wrap}`}>
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${dayTheme.bar}`} />
        <div className="pl-4 pr-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Calendar size={16} className={dayTheme.icon} />
              <span className="font-bold text-slate-900 text-sm">Day Availability</span>
              <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${booking.booking_type === 'Short Order' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}`}>
                {booking.booking_type === 'Short Order' ? 'Short Order' : 'Package'}
              </span>
            </div>
            {!loadingDay && (
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${dayTheme.pill}`}>
                {isShortOrder
                  ? atDailyLimit
                    ? `Full (${dayBookings.length}/${MAX_SHORT_ORDERS_PER_DAY})`
                    : `${dayBookings.length} of ${MAX_SHORT_ORDERS_PER_DAY} booked`
                  : dayBookings.length === 0
                  ? 'Clear day'
                  : `${dayBookings.length} other event${dayBookings.length > 1 ? 's' : ''}${isConflict ? ' — check time' : ''}`}
              </span>
            )}
          </div>

          {booking.event_datetime && (
            <p className="text-[11px] text-slate-500 mb-1 flex items-center gap-1">
              <Clock size={11} />
              {new Date(booking.event_datetime).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
          )}
          <p className="text-[10px] text-slate-400 mb-2">
            Only showing other {booking.booking_type === 'Short Order' ? 'Short Order' : 'Package'} events — {booking.booking_type === 'Short Order' ? 'Package bookings are' : 'Short Orders are'} tracked separately.
          </p>

          {!loadingDay && isShortOrder && (
            atDailyLimit ? (
              <p className="text-red-700 text-xs font-bold flex items-center gap-1.5 mb-2">
                <AlertTriangle size={12} /> Full — only {MAX_SHORT_ORDERS_PER_DAY} Short Orders allowed per day, and this date already has all {MAX_SHORT_ORDERS_PER_DAY}.
              </p>
            ) : (
              <p className="text-emerald-700 text-xs font-bold flex items-center gap-1.5 mb-2">
                <Check size={12} /> Still open — only {MAX_SHORT_ORDERS_PER_DAY} Short Orders allowed per day, {slotsLeft} slot{slotsLeft !== 1 ? 's' : ''} left today.
              </p>
            )
          )}

          {loadingDay ? (
            <p className="text-slate-500 text-xs flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Checking the schedule for this date...</p>
          ) : dayBookings.length === 0 ? (
            <p className="text-emerald-700 text-xs font-medium">Nothing else is booked for this day — the date is fully open.</p>
          ) : (
            <ul className="space-y-1.5">
              {dayBookings.map(b => (
                <li key={b.booking_id} className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-xs bg-white/70 ${b.isCloseInTime ? 'border-red-300' : 'border-slate-200'}`}>
                  <div className="min-w-0">
                    <p className={`truncate font-semibold ${b.isCloseInTime ? 'text-red-700' : 'text-slate-800'}`}>{b.customerName}</p>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                      {b.pax_count ? (
                        <span className="inline-flex items-center gap-0.5"><Users size={10} /> {b.pax_count} pax</span>
                      ) : null}
                      {b.venue ? (
                        <span className="inline-flex items-center gap-0.5 truncate"><MapPin size={10} /> {b.venue}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`font-bold ${b.isCloseInTime ? 'text-red-700' : 'text-slate-600'}`}>
                      {b.event_datetime ? new Date(b.event_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                    </span>
                    {b.isCloseInTime && <p className="text-[10px] text-red-600 font-semibold">~{b.hoursApart.toFixed(1)}h apart</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Equipment Availability — package bookings only */}
      {booking.package_id && (
        <div className={`relative overflow-hidden border rounded-xl shadow-sm ${eqTheme.wrap}`}>
          <div className={`absolute left-0 top-0 bottom-0 w-1 ${eqTheme.bar}`} />
          <div className="pl-4 pr-3 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <PackageCheck size={16} className={eqTheme.icon} />
                <span className="font-bold text-slate-900 text-sm">Equipment Allocation</span>
                {effectivePaxCount ? (
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 inline-flex items-center gap-0.5">
                    <Users size={10} /> {effectivePaxCount} pax
                  </span>
                ) : null}
              </div>
              {!loadingEquipment && equipmentAvailability.length > 0 && (
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${eqTheme.pill}`}>
                  {eqAllSufficient ? 'Sufficient stock' : `${eqShortCount} item${eqShortCount > 1 ? 's' : ''} short`}
                </span>
              )}
            </div>

            {loadingEquipment ? (
              <p className="text-slate-500 text-xs flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Checking equipment availability...</p>
            ) : equipmentAvailability.length === 0 ? (
              <p className="text-slate-500 text-xs">This package doesn't require any tracked equipment.</p>
            ) : (
              <ul className="space-y-1.5">
                {equipmentAvailability.map(item => {
                  const usedRatio = item.totalStock > 0 ? Math.min(1, item.alreadyCommitted / item.totalStock) : 0;
                  const neededRatio = item.totalStock > 0 ? Math.min(1, item.needed / item.totalStock) : 0;
                  return (
                    <li key={item.equipment_id} className={`rounded-lg border px-2.5 py-1.5 text-xs bg-white/70 ${!item.sufficient ? 'border-red-300' : 'border-slate-200'}`}>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={`truncate font-semibold ${!item.sufficient ? 'text-red-700' : 'text-slate-800'}`}>{item.eqm_name}</span>
                        <span className={`shrink-0 font-bold ${!item.sufficient ? 'text-red-700' : 'text-slate-600'}`}>
                          needs {item.needed} · {item.freeBeforeThis} free of {item.totalStock}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden flex">
                        <div className="h-full bg-slate-400" style={{ width: `${usedRatio * 100}%` }} title={`${item.alreadyCommitted} already committed`} />
                        <div className={`h-full ${item.sufficient ? 'bg-emerald-500' : 'bg-red-500'}`} style={{ width: `${neededRatio * 100}%` }} title={`${item.needed} needed for this booking`} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Fleet Availability — both booking types. Three vehicles is the
      tightest constraint the business has. */}
      <div className={`relative overflow-hidden border rounded-xl shadow-sm ${fleetTheme.wrap}`}>
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${fleetTheme.bar}`} />
        <div className="pl-4 pr-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {isPickupOrder
                ? <PackageIcon size={16} className={fleetTheme.icon} />
                : <Truck size={16} className={fleetTheme.icon} />}
              <span className="font-bold text-slate-900 text-sm">
                {isPickupOrder ? 'Service Method' : 'Fleet Availability'}
              </span>
              {fleet && (
                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {isPickupOrder ? 'Pickup' : fleet.tripType}
                </span>
              )}
            </div>
            {!loadingFleet && fleet && (
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${fleetTheme.pill}`}>
                {isPickupOrder
                  ? 'No vehicle needed'
                  : fleet.sufficient
                    ? `${fleet.picks.length} of ${fleet.fleetSize} ready`
                    : `Short by ${fleet.shortfall.needed - fleet.picks.length}`}
              </span>
            )}
          </div>

          {loadingFleet ? (
            <p className="text-slate-500 text-xs flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Checking which vehicles are free...</p>
          ) : !fleet ? (
            <p className="text-slate-500 text-xs">No event date yet, so nothing can be scheduled around it.</p>
          ) : (
            isPickupOrder ? (
            /* Customer pickup: no vans listed at all. There is nothing to
               choose between, and a list of "available" vehicles next to an
               order nobody is driving anywhere is an invitation to assign one
               by mistake. If the customer changes their mind, the Vehicles
               page assigns one directly — that is a deliberate detour, which
               is the right weight for an exception. */
            <div className="flex items-start gap-2">
              <PackageIcon size={14} className="mt-0.5 shrink-0 text-slate-500" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800">The customer is collecting this order.</p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  No vehicle is scheduled and none will be assigned on approval.
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  If this changes, assign a vehicle from the Vehicles page.
                </p>
              </div>
            </div>
            ) : (
            <>
              <p className="text-[11px] text-slate-500 mb-2">
                Suggested {fleet.vehiclesNeeded} vehicle{fleet.vehiclesNeeded !== 1 ? 's' : ''}.
                {fleet.outOfService > 0 && ` ${fleet.outOfService} of ${fleet.fleetSize} out of service.`}
                {' '}Tick or untick below — what is ticked when you approve is what gets dispatched.
              </p>

              {!fleet.sufficient && fleet.shortfall && (
                <p className="text-amber-800 text-xs font-bold flex items-center gap-1.5 mb-2">
                  <AlertTriangle size={12} /> {fleet.shortfall.reason} You can still approve, then reschedule or hire in.
                </p>
              )}

              {(fleet.options || []).length === 0 ? (
                <p className="text-slate-500 text-xs">No vehicle can make this event as scheduled.</p>
              ) : (
                <>
                  <ul className="space-y-1.5">
                    {fleet.options.map(o => {
                      const checked = (selectedVehicleIds || []).includes(o.vehicle_id);
                      return (
                        <li
                          key={o.vehicle_id}
                          className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                            !o.selectable
                              ? 'border-slate-200 bg-slate-50 opacity-70'
                              : checked
                                ? 'border-[#008A45]/40 bg-[#EAF3F2]'
                                : 'border-slate-200 bg-white/70'
                          }`}
                        >
                          <label className={`flex items-start gap-2 ${o.selectable ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!o.selectable}
                              onChange={() => toggleVehicle(o.vehicle_id)}
                              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#008A45] focus:ring-[#008A45]"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <span className="font-semibold text-slate-800">{o.plate_number}</span>
                                <span className="text-slate-500">{o.reason}</span>
                              </span>
                              {o.selectable && (
                                <span className="block text-[11px] text-slate-500 mt-0.5">
                                  Leaves {atTime(o.setupDispatch)}, set up by {atTime(o.setupEnds)}
                                  {o.pickupDispatch && ` · collects from ${atTime(o.pickupDispatch)}`}
                                </span>
                              )}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="text-[11px] text-slate-500 mt-2">
                    {(selectedVehicleIds || []).length === 0
                      ? 'No vehicle selected — approving will leave this booking without transport.'
                      : `${(selectedVehicleIds || []).length} vehicle${(selectedVehicleIds || []).length === 1 ? '' : 's'} will be dispatched.`}
                  </p>
                </>
              )}
            </>
          ))}
        </div>
      </div>
    </div>
  );
}
