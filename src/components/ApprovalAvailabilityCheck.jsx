// src/components/ApprovalAvailabilityCheck.jsx
//
// Shown inside the Approve modal (used identically from Bookings/ShortOrders
// list pages and their Details pages) so a manager sees the same day-schedule
// and equipment-capacity signal no matter where they approve from. Day
// Availability applies to every booking type (package or short order both
// compete for the same venue/date); Equipment Availability only renders when
// the booking being approved is a package booking, since short orders don't
// track equipment. Recomputes equipment demand using the pax count as
// currently adjusted in the modal (base pax + extra pax), not the original
// booking value, so it stays accurate while the manager is still editing.
import { useState, useEffect } from 'react';
import { Calendar, Clock, Users, PackageCheck, MapPin, Loader2 } from 'lucide-react';
import { getBookingsOnDate } from '../utils/availability';
import { getEquipmentAvailabilityPreview } from '../utils/equipment';

export default function ApprovalAvailabilityCheck({ booking, effectivePaxCount }) {
  const [dayBookings, setDayBookings] = useState([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [equipmentAvailability, setEquipmentAvailability] = useState([]);
  const [loadingEquipment, setLoadingEquipment] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!booking?.event_datetime) {
        if (!cancelled) setDayBookings([]);
        return;
      }
      if (!cancelled) setLoadingDay(true);
      try {
        const data = await getBookingsOnDate(booking.event_datetime, booking.booking_id, booking.event_datetime);
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
  }, [booking?.booking_id, booking?.event_datetime]);

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

  if (!booking) return null;

  const isConflict = dayBookings.some(b => b.isCloseInTime);
  const dayStatus = loadingDay ? 'loading' : dayBookings.length === 0 ? 'clear' : isConflict ? 'warning' : 'info';

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

  return (
    <div className="space-y-3">
      {/* Day Availability — applies to every booking type */}
      <div className={`relative overflow-hidden border rounded-xl shadow-sm ${dayTheme.wrap}`}>
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${dayTheme.bar}`} />
        <div className="pl-4 pr-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Calendar size={16} className={dayTheme.icon} />
              <span className="font-bold text-slate-900 text-sm">Day Availability</span>
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {booking.booking_type === 'Short Order' ? 'Short Order' : 'Package'}
              </span>
            </div>
            {!loadingDay && (
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${dayTheme.pill}`}>
                {dayBookings.length === 0
                  ? 'Clear day'
                  : `${dayBookings.length} other event${dayBookings.length > 1 ? 's' : ''}${isConflict ? ' — check time' : ''}`}
              </span>
            )}
          </div>

          {booking.event_datetime && (
            <p className="text-[11px] text-slate-500 mb-2 flex items-center gap-1">
              <Clock size={11} />
              {new Date(booking.event_datetime).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </p>
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
                      <span className={`px-1.5 py-0.5 rounded-full font-semibold ${b.booking_type === 'Short Order' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}`}>
                        {b.booking_type === 'Short Order' ? 'Short Order' : 'Package'}
                      </span>
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
    </div>
  );
}
