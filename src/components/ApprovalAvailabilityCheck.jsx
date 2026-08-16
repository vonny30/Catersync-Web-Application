// src/components/ApprovalAvailabilityCheck.jsx
//
// Shown inside the Approve Booking modal (used identically from the
// Bookings list page and from BookingDetails) so a manager sees the same
// day-schedule and equipment-capacity signal no matter where they approve
// from. Recomputes equipment demand using the pax count as currently
// adjusted in the modal (base pax + extra pax), not the original booking
// value, so it stays accurate while the manager is still editing.
import { useState, useEffect } from 'react';
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

  return (
    <div className="space-y-3">
      {/* Day Availability */}
      <div className={`border rounded-lg p-3 text-xs ${
        loadingDay ? 'bg-slate-50 border-slate-200' :
        dayBookings.length === 0 ? 'bg-green-50 border-green-200' :
        dayBookings.some(b => b.isCloseInTime) ? 'bg-amber-50 border-amber-200' : 'bg-blue-50 border-blue-200'
      }`}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-bold text-slate-900">Day Availability</span>
          {!loadingDay && (
            <span className={`font-bold ${
              dayBookings.length === 0 ? 'text-green-700' :
              dayBookings.some(b => b.isCloseInTime) ? 'text-amber-700' : 'text-blue-700'
            }`}>
              {dayBookings.length === 0 ? '✅ Clear' : `📅 ${dayBookings.length} other event(s)${dayBookings.some(b => b.isCloseInTime) ? ' — check the time' : ''}`}
            </span>
          )}
        </div>
        {loadingDay ? (
          <p className="text-slate-500">Checking the schedule for this date...</p>
        ) : dayBookings.length === 0 ? (
          <p className="text-slate-500">Nothing else is approved for this day.</p>
        ) : (
          <ul className="space-y-1">
            {dayBookings.map(b => (
              <li key={b.booking_id} className={`flex justify-between gap-2 ${b.isCloseInTime ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
                <span className="truncate">{b.customerName} ({b.booking_type === 'Short Order' ? 'Short Order' : 'Package'})</span>
                <span className="shrink-0">{b.event_datetime ? new Date(b.event_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Equipment Availability — package bookings only */}
      {booking.package_id && (
        <div className={`border rounded-lg p-3 text-xs ${
          loadingEquipment ? 'bg-slate-50 border-slate-200' :
          equipmentAvailability.length === 0 ? 'bg-slate-50 border-slate-200' :
          equipmentAvailability.every(e => e.sufficient) ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-bold text-slate-900">Equipment Availability</span>
            {!loadingEquipment && equipmentAvailability.length > 0 && (
              <span className={`font-bold ${equipmentAvailability.every(e => e.sufficient) ? 'text-green-700' : 'text-amber-700'}`}>
                {equipmentAvailability.every(e => e.sufficient) ? '✅ Sufficient' : `⚠️ ${equipmentAvailability.filter(e => !e.sufficient).length} item(s) short`}
              </span>
            )}
          </div>
          {loadingEquipment ? (
            <p className="text-slate-500">Checking equipment availability...</p>
          ) : equipmentAvailability.length === 0 ? (
            <p className="text-slate-500">This package doesn't require any tracked equipment.</p>
          ) : (
            <ul className="space-y-1">
              {equipmentAvailability.map(item => (
                <li key={item.equipment_id} className={`flex justify-between gap-2 ${!item.sufficient ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>
                  <span className="truncate">{item.eqm_name}</span>
                  <span className="shrink-0">{item.freeBeforeThis} free of {item.totalStock} · needs {item.needed}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
