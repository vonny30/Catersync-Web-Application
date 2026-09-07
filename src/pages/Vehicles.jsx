// src/pages/Vehicles.jsx
import { useState, useEffect, useRef, useMemo } from 'react';
import Select from '../components/Select';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Plus, Edit, Trash2, X, ClipboardList, RefreshCw, Undo2,
  Calendar, MapPin, Users, Search, LayoutGrid, AlertTriangle,
  Info, ChevronLeft,
  ChevronRight, Wrench, CheckCircle2, History, ExternalLink, Lock,
  Car, Truck, Bike, Clock, Package as PackageIcon,
} from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePasswordConfirm } from '../contexts/PasswordConfirmContext';
import { ACTIVE_BOOKING_STATUSES } from '../utils/bookingStatus';
import { errorInputClass } from '../utils/formErrors';
import {
  getDailyVehicleSnapshot, getDispatchWindow, TRIP_LEG,
  PICKUP_GRACE_HOURS, needsTransport, findConflictingAssignment, describeAssignment,
  recheckConflictsBeforeInsert, DUPLICATE_ASSIGNMENT_CODE, duplicateAssignmentMessage,
  getTripState, TRIP_STATE, openWindowsBetween, OPEN_WINDOW_MIN_HOURS,
  vehicleTypeOptions, normaliseVehicleType, VEHICLE_TYPE_MAX_LENGTH,
  isAssignmentOutsideBounds, getDispatchBounds, defaultDispatchFor,
  isDispatchInBounds, describeDispatchBounds, toDateTimeLocalValue,
  legLabelFor, getTripType,
} from '../utils/vehicle';
import { fetchAllRows } from '../utils/fetchAllRows';
import { getAssignmentStatus, RESOURCE_STATE } from '../utils/statusLabels';
import DateRangeFilter from './Reports/DateRangeFilter';
import { getRangeBounds, isWithinRange, DEFAULT_DATE_PRESET } from './Reports/helpers';
import { getCurrentManagerId } from '../utils/currentManager';

const toDateInputValue = (d) => {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
};
const todayISO = () => toDateInputValue(new Date());
const tomorrowISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDateInputValue(d);
};

// A vehicle can't physically come back until the event it's dispatched for
// is actually happening or over — same 3-hour-past-the-event grace period
// as Equipment's Return trap, for the same reason (covers events running
// long) and the same consistency. No event_datetime at all is treated as
// returnable rather than permanently locked out.
// A dispatch window rendered as the vehicle's actual hours. Times only: on a
// day view the date is already the column heading, and a trip that runs past
// midnight reads correctly as e.g. 22:00 - 04:00.
const formatTripWindow = (window) => {
  if (!window) return 'Time not set';
  const at = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${at(window.start)} - ${at(window.end)}`;
};

const RETURN_GRACE_MS = PICKUP_GRACE_HOURS * 60 * 60 * 1000;
const getReturnAvailability = (eventDatetimeStr) => {
  if (!eventDatetimeStr) return { canReturn: true, opensAt: null };
  const opensAt = new Date(new Date(eventDatetimeStr).getTime() + RETURN_GRACE_MS);
  return { canReturn: Date.now() >= opensAt.getTime(), opensAt };
};
const formatReturnOpensAt = (opensAt) =>
  opensAt ? opensAt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

const fmtClock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
const fmtHourTick = (h) => {
  const ampm = h >= 12 && h < 24 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ' ' + ampm;
};
// A window that runs past midnight has to say so. Times alone would render a
// 10 PM collection run ending at 1 AM as "10:00 PM - 1:00 AM", which reads as a
// trip that finished fifteen hours before it started.
const fmtSpan = (w) =>
  !w ? 'Time not set'
    : w.start.toDateString() === w.end.toDateString()
      ? fmtClock(w.start) + ' - ' + fmtClock(w.end)
      : fmtClock(w.start) + ' - ' + fmtDay(w.end) + ', ' + fmtClock(w.end);

// ---------------------------------------------------------------------------
// COLOUR
//
// Three legs need telling apart on the timeline, but every block already
// carries its leg NAME, so hue is the second cue and never the first. These
// tints are deliberately near-grey: the only saturated colours on this page are
// the ones that mean something - brand green for what is ours and running,
// amber for a vehicle out of service, red for a return that is late. A leg is
// not a status and must not compete with them.
// ---------------------------------------------------------------------------
const LEG_TONE = {
  'Setup run':      { bg: '#eef3f9', bd: '#cfdcea', fg: '#33506e' },
  'Collection run': { bg: '#faf5ec', bd: '#e6dabf', fg: '#6a5426' },
  Delivery:         { bg: '#f2f0f8', bd: '#d7d2e8', fg: '#474070' },
};
const BACK_TONE = { bg: '#f1f4f7', bd: '#dde3ea', fg: '#64748b' };
const toneFor = (legLabel, completed) =>
  completed ? BACK_TONE : (LEG_TONE[legLabel] || LEG_TONE['Setup run']);

// Diagonal hatching, not a flat fill. An open window is the ABSENCE of a
// commitment; a solid band beside the solid trip blocks reads as one more thing
// booked into the day.
const OPEN_FILL = 'repeating-linear-gradient(135deg, #f8fafc 0px, #f8fafc 5px, #eef2f7 5px, #eef2f7 10px)';

const TRIP_STATE_CHIP = {
  back:        'bg-white border-slate-200 text-slate-500',
  on_road:     'bg-[#EAF3F2] border-[#c2dccf] text-[#00703a]',
  committed:   'bg-slate-100 border-slate-200 text-slate-600',
  overdue:     'bg-red-50 border-red-200 text-red-700',
  cancelled:   'bg-slate-50 border-slate-200 text-slate-500 line-through decoration-slate-300',
  unscheduled: 'bg-amber-50 border-amber-200 text-amber-700',
};

function StateChip({ state, children }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-[12.5px] font-semibold whitespace-nowrap ${TRIP_STATE_CHIP[state.key] || TRIP_STATE_CHIP.committed}`}>
      {state.key === 'back' && <CheckCircle2 size={12} />}
      {state.key === 'overdue' && <AlertTriangle size={12} />}
      {children || state.label}
    </span>
  );
}

// The leg is the one fact a dispatch row cannot do without: the same van on the
// same booking twice in a day is normal, and only the leg says which run this
// is. Tinted to match its block on the timeline so the two read as one thing.
function LegChip({ legLabel, completed }) {
  const t = toneFor(legLabel, completed);
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full border text-[12.5px] font-semibold whitespace-nowrap"
      style={{ background: t.bg, borderColor: t.bd, color: t.fg }}
    >
      {legLabel}
    </span>
  );
}

// Vehicle types are free text now, so the icon is matched on the word rather
// than switched on a closed pair. Truck is the fallback because an unknown type
// is far more likely to be something van-shaped than something car-shaped, and
// because it is the neutral "a vehicle" glyph here.
// Returns the element rather than the component. Picking a component into a
// capitalised local and rendering <Icon /> reads as creating a component during
// render, which the React Compiler rejects outright.
function VehicleTypeIcon({ type, size = 13 }) {
  const t = (type || '').toLowerCase();
  if (t.includes('motor') || t.includes('bike') || t.includes('scooter')) return <Bike size={size} />;
  if (t.includes('car') || t.includes('sedan')) return <Car size={size} />;
  return <Truck size={size} />;
}

// The same flag the Dispatch card carries, for the same reason: a run stored
// outside the bounds for its own leg is wrong, and drawing it as an ordinary
// run is how it stays wrong. Display only.
function OutOfBoundsChip() {
  return (
    <span
      title="This dispatch time is outside the window its leg allows. Reassign it to correct it."
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800 text-[11.5px] font-semibold whitespace-nowrap"
    >
      <AlertTriangle size={10} /> Outside the expected window
    </span>
  );
}

function TypeTag({ type }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-500 whitespace-nowrap">
      <VehicleTypeIcon type={type} /> {type}
    </span>
  );
}

// A dropdown of every type the fleet already uses, plus a way to name a new
// one. The list is not a closed set - see DEFAULT_VEHICLE_TYPES - so the form
// must let a manager add "Van" or "Tricycle" without a code change, while still
// steering them to reuse an existing spelling rather than inventing a second
// one that splits every type filter on the page.
const OTHER_TYPE = '__other__';

function VehicleTypeField({ value, options, isCustom, onSelect, onCustomChange, error, required }) {
  return (
    <div>
      <label className="block text-xs font-bold text-slate-700 mb-1.5">Vehicle Type{required ? ' *' : ''}</label>
      <Select
        value={isCustom ? OTHER_TYPE : value}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
      >
        {options.map(t => <option key={t} value={t}>{t}</option>)}
        <option value={OTHER_TYPE}>Other — add a new type…</option>
      </Select>
      {isCustom && (
        <div className="mt-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onCustomChange(e.target.value)}
            placeholder="e.g. Van, Tricycle, Truck"
            maxLength={VEHICLE_TYPE_MAX_LENGTH}
            autoFocus
            className={errorInputClass(!!error, 'w-full border rounded-lg p-2.5 text-sm bg-white focus:ring-2 outline-none')}
          />
          {error ? (
            <p className="text-xs text-red-600 font-semibold mt-1">{error}</p>
          ) : (
            <p className="text-xs text-slate-400 mt-1">
              Used across the fleet from now on. If it already exists under a different capitalisation, the existing spelling is kept.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Row actions, neutral until hover - the same control Equipment uses. A red
// trash and a blue pencil on every row read as a column of warnings running
// down the page.
function IconBtn({ label, onClick, Icon, hover }) {
  const hoverCls = hover === 'red' ? 'hover:bg-red-50 hover:text-red-700'
    : hover === 'amber' ? 'hover:bg-amber-50 hover:text-amber-700'
    : 'hover:bg-slate-100 hover:text-slate-700';
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-[9px] text-slate-400 transition-colors cursor-pointer ${hoverCls}`}
    >
      <Icon size={15} />
    </button>
  );
}

// Shared column tracks, declared once so the zone grids cannot drift out of
// alignment with one another - the same reason Equipment has ROW_COLS.
const FLEET_COLS = 'grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,2.2fr)_minmax(0,1.3fr)] gap-5';
const HIST_COLS = 'grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2.2fr)_minmax(0,1fr)] gap-5';
const ZONE_HEAD = 'text-[12.5px] font-bold tracking-[0.05em] uppercase text-slate-700';


export default function Vehicles() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();

  // --- STATE ---
  const [vehicles, setVehicles] = useState([]);
  const [assignments, setAssignments] = useState([]); // ALL vehicle_assign rows (Scheduled + Completed) — feeds Usage history, Active Assignments, and History tab
  const [bookings, setBookings] = useState([]); // Active bookings (Package + Short Order), for the Assign modal's booking picker
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addFieldErrors, setAddFieldErrors] = useState({});
  const [editFieldErrors, setEditFieldErrors] = useState({});

  // --- Date context — drives the whole "what's actually free" view ---
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [snapshot, setSnapshot] = useState({ vehicles: [], eventsOnDate: [] });
  const [snapshotLoading, setSnapshotLoading] = useState(true);

  // --- Tab control. PLAN is date-scoped (Day schedule, Find a window),
  // FLEET is not (Vehicles, Trips, History). ---
  const [activeTableTab, setActiveTableTab] = useState('day'); // 'day' | 'window' | 'fleet' | 'trips' | 'history'

  // --- Find a window: the planning inverse of the day schedule. Deliberately
  // NO date of its own - it reads the same selectedDate the timeline does.
  // Two date pickers inside one PLAN cluster is exactly the confusion the
  // cluster labels were added to remove, and it would need a second snapshot
  // fetch to answer a question the first one already has the data for. ---
  const [windowMinHours, setWindowMinHours] = useState(4); // 2 | 4 | 6 | 'day'
  const [windowTypeFilter, setWindowTypeFilter] = useState('All'); // 'All' or any vehicle_type in the fleet

  // --- Vehicles tab search/filter ---
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryTypeFilter, setInventoryTypeFilter] = useState('All');

  // --- Active Assignments search/filter/sort — spans every active event
  // regardless of the date picker above, so it can grow long. ---
  const [assignmentSearchTerm, setAssignmentSearchTerm] = useState('');
  const [assignmentSectionFilter, setAssignmentSectionFilter] = useState('All'); // 'All' | 'Overdue' | 'Today' | 'Upcoming'
  const [assignmentDatePreset, setAssignmentDatePreset] = useState(DEFAULT_DATE_PRESET);
  const [assignmentDateCustomStart, setAssignmentDateCustomStart] = useState('');
  const [assignmentDateCustomEnd, setAssignmentDateCustomEnd] = useState('');
  const [assignmentSort, setAssignmentSort] = useState({ field: 'priority', direction: 'asc' }); // 'priority' | 'date' | 'customer'

  // --- History tab — full assignment log (Scheduled + Completed) ---
  const [historySearch, setHistorySearch] = useState('');
  // 'All' or a KEY from getTripState (committed | on_road | back | overdue).
  // Never a stored vehicle_assign.assignment_status value: those are
  // 'Scheduled' / 'Completed' and match none of these, which silently empties
  // the table. That regression has happened once already.
  const [historyStatusFilter, setHistoryStatusFilter] = useState('All');
  const [historyDatePreset, setHistoryDatePreset] = useState(DEFAULT_DATE_PRESET);
  const [historyDateCustomStart, setHistoryDateCustomStart] = useState('');
  const [historyDateCustomEnd, setHistoryDateCustomEnd] = useState('');

  // --- Events-on-date modal ---
  const [isEventsModalOpen, setIsEventsModalOpen] = useState(false);
  const [isNeedsVehicleModalOpen, setIsNeedsVehicleModalOpen] = useState(false);

  // --- Availability row detail modal ---
  const [isAvailabilityDetailOpen, setIsAvailabilityDetailOpen] = useState(false);
  const [availabilityDetailVehicle, setAvailabilityDetailVehicle] = useState(null);

  // --- "Flag Issue" quick modal — a focused shortcut to mark a vehicle
  // Maintenance/Unavailable without going through the full Edit form. ---
  const [isFlagIssueModalOpen, setIsFlagIssueModalOpen] = useState(false);
  const [flagIssueVehicle, setFlagIssueVehicle] = useState(null);
  const [flagIssueStatus, setFlagIssueStatus] = useState('Maintenance');
  const [flagIssueError, setFlagIssueError] = useState('');

  const [isUsageModalOpen, setIsUsageModalOpen] = useState(false);
  const [selectedVehicleForUsage, setSelectedVehicleForUsage] = useState(null);
  const [vehicleUsageAssignments, setVehicleUsageAssignments] = useState([]);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);

  const [newVehicleForm, setNewVehicleForm] = useState({ plate_number: '', vehicle_type: 'Car' });
  // Whether the type field is showing its free-text box. Held explicitly rather
  // than derived from "is the value a known type", because while a new type is
  // being typed the half-finished word matches nothing, and the moment it did
  // match the field would snap back to the dropdown mid-keystroke.
  const [addTypeIsCustom, setAddTypeIsCustom] = useState(false);
  const [editTypeIsCustom, setEditTypeIsCustom] = useState(false);
  const [editVehicleForm, setEditVehicleForm] = useState({ vehicle_id: '', plate_number: '', vehicle_type: 'Car', vehicle_status: 'Available' });
  const [assignForm, setAssignForm] = useState({ booking_id: '', dispatch_datetime: '' });
  // Which run is being created. Same explicit choice the detail pages' modal
  // asks for — this page has its OWN insert path, and bounding only the other
  // one would leave the door BKG-110 came through wide open.
  const [assignLeg, setAssignLeg] = useState(TRIP_LEG.setup);
  const [selectedVehicleIds, setSelectedVehicleIds] = useState([]);
  const [vehiclePickerSearch, setVehiclePickerSearch] = useState('');

  // --- Booking Search State for Assign Modal ---
  const [bookingSearchTerm, setBookingSearchTerm] = useState('');
  const [showBookingDropdown, setShowBookingDropdown] = useState(false);

  // --- Helper: generate structured booking reference ---
  const getBookingRef = (booking) => {
    if (booking.booking_number) return booking.booking_number;
    const prefix = booking.booking_type === 'Short Order' ? 'SO' : 'BKG';
    return `${prefix}-${booking.booking_id.slice(0, 8)}`;
  };

  // --- Jump to the full booking/short order detail page ---
  const goToBookingDetails = (bookingIdOrBooking, bookingType) => {
    const id = typeof bookingIdOrBooking === 'object' ? bookingIdOrBooking.booking_id : bookingIdOrBooking;
    const type = typeof bookingIdOrBooking === 'object' ? bookingIdOrBooking.booking_type : bookingType;
    if (!id) return;
    navigate(`/app/${type === 'Short Order' ? 'orders' : 'bookings'}/${id}`);
  };

  // --- Error handler ---
  const handleError = (error, userMessage = 'Something went wrong. Please try again.') => {
    console.error('Error:', error);
    toast.error(userMessage);
  };

  // --- FETCH DATA (fleet, bookings, all assignments) ---
  const fetchData = async () => {
    setIsLoading(true);
    try {
      // All three are paged. vehicle_assign in particular grows without bound -
      // three vehicles doing a few trips a day crosses PostgREST's 1000-row cap
      // inside a year, and past that History silently loses its oldest rows
      // with nothing thrown and nothing warned. Each .order() ends on a primary
      // key so the paging is stable. See utils/fetchAllRows.js.
      const vehicleData = await fetchAllRows(
        () => supabase
          .from('vehicle')
          .select('*')
          .order('plate_number')
          .order('vehicle_id'),
        'vehicles'
      );
      setVehicles(vehicleData);

      const bookingData = await fetchAllRows(
        () => supabase
          .from('booking')
          .select(`
            booking_id, booking_number, booking_type, booking_status, event_datetime, venue, pax_count, notes,
            customer:customer_id (first_name, last_name, contact_no, cus_address)
          `)
          .in('booking_status', ACTIVE_BOOKING_STATUSES)
          .order('event_datetime', { ascending: true })
          .order('booking_id'),
        'active bookings'
      );
      setBookings(bookingData);

      const assignData = await fetchAllRows(
        () => supabase
          .from('vehicle_assign')
          .select(`
            *,
            booking:booking_id (
              booking_id, booking_number, booking_type, venue, event_datetime, booking_status,
              customer:customer_id (first_name, last_name)
            ),
            vehicle:vehicle_id (plate_number, vehicle_type)
          `)
          .order('dispatch_datetime', { ascending: false })
          .order('assignment_id'),
        'vehicle assignments'
      );
      setAssignments(assignData);
    } catch (error) {
      handleError(error, 'Unable to load vehicle data. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Same exposure as Equipment: the fleet is shared, so one manager
  // dispatching a vehicle changes what everyone else can dispatch.
  useRealtimeRefresh(
    'vehicles-page',
    ['vehicle', 'vehicle_assign', 'booking'],
    fetchData
  );

  // --- Recompute the date snapshot whenever the selected date (or the
  // underlying data) changes ---
  const fetchSnapshot = async () => {
    setSnapshotLoading(true);
    try {
      const data = await getDailyVehicleSnapshot(selectedDate);
      setSnapshot(data);
    } catch (error) {
      handleError(error, 'Unable to load availability for this date.');
      setSnapshot({ vehicles: [], eventsOnDate: [] });
    } finally {
      setSnapshotLoading(false);
    }
  };

  useEffect(() => {
    fetchSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, vehicles, assignments]);

  // --- Filter bookings when search term changes ---
  // Customer pickups are excluded outright: nothing is driven anywhere, so
  // they are not candidates for a vehicle. `hiddenPickupCount` keeps the
  // omission visible instead of leaving a manager hunting for an order the
  // list has quietly swallowed.
  // Both derived in one pass — the hidden count is the difference between what
  // the search matched and what is dispatchable, so computing them apart would
  // let them disagree.
  const { filteredBookings, hiddenPickupCount } = useMemo(() => {
    const term = bookingSearchTerm.trim().toLowerCase();
    const matching = !term ? bookings : bookings.filter(b => {
      const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}`.toLowerCase() : '';
      const ref = getBookingRef(b).toLowerCase();
      return customerName.includes(term) || ref.includes(term);
    });
    const assignable = matching.filter(b => needsTransport(b));
    return { filteredBookings: assignable, hiddenPickupCount: matching.length - assignable.length };
  }, [bookingSearchTerm, bookings]);

  const selectedBooking = bookings.find(b => b.booking_id === assignForm.booking_id);

  // --- When a booking is selected in the Assign modal ---
  // `leg` is a parameter, not read from state: setAssignLeg is asynchronous, so
  // a caller that sets the leg and then calls this would compute the default
  // departure from the PREVIOUS leg while the selector already showed the new
  // one — a collection-run time filed under a setup run.
  const handleBookingSelect = (bookingId, leg = assignLeg) => {
    const selected = bookings.find(b => b.booking_id === bookingId);
    if (!selected) return;
    setAssignForm(prev => ({ ...prev, booking_id: bookingId }));
    setBookingSearchTerm(`${getBookingRef(selected)} - ${selected.customer?.first_name || ''} ${selected.customer?.last_name || ''}`);
    setShowBookingDropdown(false);

    // Departure for the chosen leg, already clamped inside that leg's bounds.
    // It used to be clamped to "now" instead, which is what let a collection run
    // be filed three days after its event: nothing downstream had an opinion
    // about the result.
    setAssignForm(prev => ({
      ...prev,
      dispatch_datetime: toDateTimeLocalValue(defaultDispatchFor(selected, leg)),
    }));
    setSelectedVehicleIds([]);
  };

  const chooseAssignLeg = (nextLeg) => {
    setAssignLeg(nextLeg);
    if (selectedBooking) {
      setAssignForm(prev => ({
        ...prev,
        dispatch_datetime: toDateTimeLocalValue(defaultDispatchFor(selectedBooking, nextLeg)),
      }));
    }
  };

  const toggleVehicleSelection = (vehicleId) => {
    setSelectedVehicleIds(prev =>
      prev.includes(vehicleId) ? prev.filter(id => id !== vehicleId) : [...prev, vehicleId]
    );
  };

  // --- FETCH USAGE (full history, any date, for the Inventory tab) ---
  const fetchVehicleUsage = async (vehicleId) => {
    try {
      const data = await fetchAllRows(
        () => supabase
          .from('vehicle_assign')
          .select(`
            *,
            booking:booking_id (
              booking_id, booking_number, booking_type, venue, event_datetime,
              customer:customer_id (first_name, last_name)
            )
          `)
          .eq('vehicle_id', vehicleId)
          .order('dispatch_datetime', { ascending: false })
          .order('assignment_id'),
        'vehicle usage history'
      );
      setVehicleUsageAssignments(data);
    } catch (error) {
      console.error('Error fetching usage:', error);
      setVehicleUsageAssignments([]);
      toast.error('Unable to load usage history.');
    }
  };

  const handleViewUsage = async (vehicle) => {
    setSelectedVehicleForUsage(vehicle);
    await fetchVehicleUsage(vehicle.vehicle_id);
    setIsUsageModalOpen(true);
  };

  // --- HANDLERS ---
  const handleNewVehicleChange = (e) => {
    const { name, value } = e.target;
    setNewVehicleForm(prev => ({ ...prev, [name]: value }));
    setAddFieldErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  // Type pickers. Choosing "Other" empties the value on purpose: the field is
  // required, so an empty box fails validation rather than silently saving
  // whatever type happened to be selected before.
  const makeTypeSelectHandler = (setForm, setIsCustom, setErrors) => (val) => {
    if (val === OTHER_TYPE) {
      setIsCustom(true);
      setForm(prev => ({ ...prev, vehicle_type: '' }));
    } else {
      setIsCustom(false);
      setForm(prev => ({ ...prev, vehicle_type: val }));
    }
    setErrors(prev => ({ ...prev, vehicle_type: undefined }));
  };
  const makeTypeTextHandler = (setForm, setErrors) => (val) => {
    setForm(prev => ({ ...prev, vehicle_type: val }));
    setErrors(prev => ({ ...prev, vehicle_type: undefined }));
  };
  const handleAddTypeSelect = makeTypeSelectHandler(setNewVehicleForm, setAddTypeIsCustom, setAddFieldErrors);
  const handleAddTypeText = makeTypeTextHandler(setNewVehicleForm, setAddFieldErrors);
  const handleEditTypeSelect = makeTypeSelectHandler(setEditVehicleForm, setEditTypeIsCustom, setEditFieldErrors);
  const handleEditTypeText = makeTypeTextHandler(setEditVehicleForm, setEditFieldErrors);

  const handleEditVehicleChange = (e) => {
    const { name, value } = e.target;
    setEditVehicleForm(prev => ({ ...prev, [name]: value }));
    setEditFieldErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  const handleAssignChange = (e) => {
    const { name, value } = e.target;
    setAssignForm(prev => ({ ...prev, [name]: value }));
  };

  // --- ADD VEHICLE ---
  const handleAddVehicle = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setAddFieldErrors({});

    const plate = newVehicleForm.plate_number.trim();
    if (!plate) {
      toast.error('Plate number is required.');
      setAddFieldErrors({ plate_number: 'Plate number is required.' });
      setIsSubmitting(false);
      return;
    }
    if (plate.length < 3) {
      toast.error('Plate number must be at least 3 characters.');
      setAddFieldErrors({ plate_number: 'Must be at least 3 characters.' });
      setIsSubmitting(false);
      return;
    }
    // Reuses an existing spelling when one matches case-insensitively, so
    // typing "van" next to an existing "Van" does not create a second type that
    // splits every type filter on this page.
    const vehicleType = normaliseVehicleType(newVehicleForm.vehicle_type, fleetTypeOptions);
    if (!vehicleType) {
      toast.error('Please choose or name a vehicle type.');
      setAddFieldErrors({ vehicle_type: 'Name the vehicle type.' });
      setIsSubmitting(false);
      return;
    }

    try {
      const { error } = await supabase
        .from('vehicle')
        .insert([{
          plate_number: plate,
          vehicle_type: vehicleType,
          vehicle_status: 'Available',
        }]);
      if (error) throw error;

      setIsAddModalOpen(false);
      setNewVehicleForm({ plate_number: '', vehicle_type: 'Car' });
      setAddTypeIsCustom(false);
      toast.success('Vehicle added.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to add vehicle.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- EDIT VEHICLE ---
  const handleEditClick = (vehicle) => {
    setEditTypeIsCustom(false);
    setEditVehicleForm({
      vehicle_id: vehicle.vehicle_id,
      plate_number: vehicle.plate_number,
      vehicle_type: vehicle.vehicle_type,
      vehicle_status: vehicle.vehicle_status,
    });
    setEditFieldErrors({});
    setIsEditModalOpen(true);
  };

  // A vehicle is a single physical unit, so ANY non-completed assignment
  // to it is a real, unambiguous conflict with taking it out of service —
  // unlike equipment (a shared stock pool where two non-overlapping dates
  // can reuse the same units), there's no "it's actually fine" case here.
  // The one exception: an assignment whose event date has already passed
  // is an overdue-return bookkeeping issue (already surfaced separately
  // in the sidebar), not a real scheduling conflict — it shouldn't block
  // an unrelated status change today.
  // D1, both halves. A vehicle is exclusive for the length of a TRIP, not for
  // the calendar day - that is what lets three vehicles serve more than three
  // events. This single helper answers "is this van free for that run", and
  // both the Assign submit guard and the picker's disabled state call it, so
  // the checkbox the manager sees can never disagree with what submit accepts.
  const conflictingTripFor = (vehicleId, booking, dispatchValue, leg = null) =>
    findConflictingAssignment(assignments, vehicleId, booking, dispatchValue, leg);

  const describeTrip = describeAssignment;

  const activeAssignmentsFor = (vehicleId) => assignments.filter(a => {
    if (a.vehicle_id !== vehicleId) return false;
    if (a.assignment_status === 'Completed') return false;
    if (a.booking?.booking_status === 'Rejected' || a.booking?.booking_status === 'Cancelled') return false;
    if (!a.booking?.event_datetime) return true;
    const eventDay = new Date(a.booking.event_datetime);
    eventDay.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return eventDay >= today;
  });

  // Builds the specific, accurate reason a status change is blocked —
  // naming the actual event(s) so the manager knows exactly what to
  // reassign, instead of a vague "N active event(s)" count.
  // A booking now holds up to two rows on one vehicle — a setup run and a
  // pickup run — so anything counting "events" or "vehicles" has to count
  // DISTINCT ones, or a single wedding reads as two.
  const countDistinct = (rows, key) => new Set(rows.map(r => r[key])).size;

  const describeActiveAssignments = (activeAssigns, newStatus) => {
    const eventCount = countDistinct(activeAssigns, 'booking_id');
    const seen = new Set();
    const preview = activeAssigns
      .filter(a => (seen.has(a.booking_id) ? false : seen.add(a.booking_id)))
      .slice(0, 3)
      .map(a => {
        const ref = a.booking?.booking_number || 'a booking';
        const when = a.booking?.event_datetime ? new Date(a.booking.event_datetime).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'an unscheduled date';
        return `${ref} (${when})`;
      })
      .join(', ');
    const more = eventCount > 3 ? `, and ${eventCount - 3} more` : '';
    return `Can't mark this vehicle ${newStatus} — it's still dispatched to ${eventCount} upcoming event(s): ${preview}${more}. Reassign or complete those first.`;
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setEditFieldErrors({});

    if (!editVehicleForm.plate_number.trim()) {
      toast.error('Plate number is required.');
      setEditFieldErrors({ plate_number: 'Plate number is required.' });
      return;
    }

    const goingOutOfService = editVehicleForm.vehicle_status === 'Maintenance' || editVehicleForm.vehicle_status === 'Unavailable';
    if (goingOutOfService) {
      const activeAssigns = activeAssignmentsFor(editVehicleForm.vehicle_id);
      if (activeAssigns.length > 0) {
        const message = describeActiveAssignments(activeAssigns, editVehicleForm.vehicle_status);
        toast.error(message, { duration: 7000 });
        setEditFieldErrors({ vehicle_status: `Still dispatched to ${countDistinct(activeAssigns, 'booking_id')} upcoming event(s).` });
        return;
      }
    }

    const editedType = normaliseVehicleType(editVehicleForm.vehicle_type, fleetTypeOptions);
    if (!editedType) {
      toast.error('Please choose or name a vehicle type.');
      setEditFieldErrors({ vehicle_type: 'Name the vehicle type.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('vehicle')
        .update({
          plate_number: editVehicleForm.plate_number.trim(),
          vehicle_type: editedType,
          vehicle_status: editVehicleForm.vehicle_status,
        })
        .eq('vehicle_id', editVehicleForm.vehicle_id);
      if (error) throw error;

      setIsEditModalOpen(false);
      toast.success('Vehicle saved.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to update vehicle.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- FLAG ISSUE (quick Maintenance/Unavailable shortcut) ---
  const handleFlagIssueClick = (vehicle) => {
    setFlagIssueVehicle(vehicle);
    setFlagIssueStatus(vehicle.vehicle_status === 'Available' ? 'Maintenance' : vehicle.vehicle_status);
    setFlagIssueError('');
    setIsFlagIssueModalOpen(true);
  };

  const handleFlagIssueSubmit = async (e) => {
    e.preventDefault();
    if (!flagIssueVehicle) return;
    setFlagIssueError('');

    const goingOutOfService = flagIssueStatus === 'Maintenance' || flagIssueStatus === 'Unavailable';
    if (goingOutOfService) {
      const activeAssigns = activeAssignmentsFor(flagIssueVehicle.vehicle_id);
      if (activeAssigns.length > 0) {
        const message = describeActiveAssignments(activeAssigns, flagIssueStatus);
        toast.error(message, { duration: 7000 });
        setFlagIssueError(message);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('vehicle')
        .update({ vehicle_status: flagIssueStatus })
        .eq('vehicle_id', flagIssueVehicle.vehicle_id);
      if (error) throw error;

      setIsFlagIssueModalOpen(false);
      toast.success('Vehicle status updated.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to update vehicle status.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- DELETE VEHICLE ---
  // Both blocking checks run BEFORE the confirm and the password prompt.
  // Asking a manager to type their password and only then telling them the
  // deletion was never possible wastes the one interaction we ask most of -
  // the same fix Equipment got on 21 Aug.
  const handleDeleteVehicle = async (vehicleId) => {
    let assignmentRows;
    try {
      assignmentRows = await fetchAllRows(
        () => supabase
          .from('vehicle_assign')
          .select('assignment_id, assignment_status, booking:booking_id (booking_status)')
          .eq('vehicle_id', vehicleId)
          .order('assignment_id'),
        'assignments for vehicle delete check'
      );
    } catch (error) {
      handleError(error, 'Unable to check this vehicle before deleting.');
      return;
    }

    const committedCount = assignmentRows.filter(
      a => a.assignment_status !== 'Completed'
        && a.booking?.booking_status
        && ACTIVE_BOOKING_STATUSES.includes(a.booking.booking_status)
    ).length;
    if (committedCount > 0) {
      toast.error(`This vehicle can't be deleted — it's dispatched to ${committedCount} active booking(s). Reassign or complete those first.`, { duration: 7000 });
      return;
    }

    // Deleting the vehicle would take its dispatch history with it, and that
    // history is what the utilization reports are built from. A vehicle that
    // has ever made a trip is retired, not deleted: Flag issue -> Unavailable
    // takes it out of service and keeps the record. Same rule as Equipment.
    if (assignmentRows.length > 0) {
      toast.error(`This vehicle can't be deleted — it has ${assignmentRows.length} past dispatch(es) that the reports read from. Use Flag issue to mark it Unavailable instead, which retires it without losing the history.`, { duration: 8000 });
      return;
    }

    const confirmed = await showConfirm({
      title: 'Delete Vehicle?',
      message: 'This vehicle has never been dispatched, so nothing else refers to it. Delete it permanently?',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: 'Deleting this vehicle is permanent. Re-enter your password to continue.',
    });
    if (!passwordOk) return;

    try {
      const { error } = await supabase
        .from('vehicle')
        .delete()
        .eq('vehicle_id', vehicleId);
      if (error) throw error;

      toast.success('Vehicle deleted.');
      await fetchData();
    } catch (error) {
      if (error?.code === '23503') {
        handleError(error, 'Cannot delete this vehicle because other records still reference it.');
        return;
      }
      handleError(error, 'Failed to delete vehicle.');
    }
  };

  // --- ASSIGN VEHICLES (Multiple) ---
  const handleAssignSubmit = async (e) => {
    e.preventDefault();
    if (selectedVehicleIds.length === 0) {
      toast.error('Please select at least one vehicle.');
      return;
    }
    if (!assignForm.booking_id) {
      toast.error('Please select a booking.');
      return;
    }
    if (!assignForm.dispatch_datetime) {
      toast.error('Please set a dispatch date/time.');
      return;
    }

    const eventDate = selectedBooking?.event_datetime ? new Date(selectedBooking.event_datetime) : null;
    if (!eventDate) {
      toast.error('Selected booking has no event date.');
      return;
    }

    // The input's min/max only steers; it is bypassable by typing and ignored
    // by some browsers. This is the refusal that actually holds.
    if (!isDispatchInBounds(new Date(assignForm.dispatch_datetime), selectedBooking, assignLeg)) {
      toast.error(describeDispatchBounds(selectedBooking, assignLeg), { duration: 9000 });
      return;
    }

    // Overlapping RUNS block an assignment; another booking on the same day
    // does not. Same helper the picker uses.
    const conflicts = [];
    for (const vehicleId of selectedVehicleIds) {
      const clash = conflictingTripFor(vehicleId, selectedBooking, assignForm.dispatch_datetime, assignLeg);
      if (clash) {
        const vehicle = vehicles.find(v => v.vehicle_id === vehicleId);
        conflicts.push(`${vehicle?.plate_number || vehicleId} - ${describeTrip(clash)}`);
      }
    }
    if (conflicts.length > 0) {
      toast.error(`This run overlaps work already booked: ${conflicts.join('; ')}. Move the dispatch time or pick another vehicle.`, { duration: 8000 });
      return;
    }

    setIsSubmitting(true);
    try {
      // Same re-check as the detail pages' modal, for the same reason: the
      // conflict list is only as fresh as the last fetch.
      const late = await recheckConflictsBeforeInsert(selectedVehicleIds, selectedBooking, assignForm.dispatch_datetime, assignLeg);
      if (late.length > 0) {
        const names = late.map(({ vehicle_id, conflict }) => {
          const v = vehicles.find(x => x.vehicle_id === vehicle_id);
          return `${v?.plate_number || vehicle_id} - ${describeAssignment(conflict)}`;
        });
        toast.error(`Booked elsewhere while this was open: ${names.join('; ')}. Nothing was assigned — pick another vehicle or time.`, { duration: 9000 });
        setIsSubmitting(false);
        return;
      }

      const managerId = await getCurrentManagerId();

      const inserts = selectedVehicleIds.map(vehicleId => ({
        vehicle_id: vehicleId,
        booking_id: assignForm.booking_id,
        manager_id: managerId,
        dispatch_datetime: new Date(assignForm.dispatch_datetime).toISOString(),
        assignment_status: 'Scheduled',
      }));

      const { error } = await supabase.from('vehicle_assign').insert(inserts);
      if (error?.code === DUPLICATE_ASSIGNMENT_CODE) {
        toast.error(duplicateAssignmentMessage, { duration: 8000 });
        return;
      }
      if (error) throw error;

      setIsAssignModalOpen(false);
      setAssignForm({ booking_id: '', dispatch_datetime: '' });
      setSelectedVehicleIds([]);
      setBookingSearchTerm('');
      setShowBookingDropdown(false);
      setVehiclePickerSearch('');
      toast.success(`Assigned ${inserts.length} vehicle(s).`);
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to assign vehicles.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- RETURN VEHICLE (single) ---
  const handleReturnVehicle = async (assignmentId) => {
    const assignment = assignments.find(a => a.assignment_id === assignmentId);
    const { canReturn, opensAt } = getReturnAvailability(assignment?.booking?.event_datetime);
    if (!canReturn) {
      toast.error(`Can't return this yet — available starting ${PICKUP_GRACE_HOURS} hours after the event, at ${formatReturnOpensAt(opensAt)}.`);
      return;
    }

    const confirmed = await showConfirm({
      title: 'Return Vehicle?',
      message: 'Mark this assignment as completed. The vehicle will be available for future events.',
      confirmLabel: 'Return',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('vehicle_assign')
        .update({ assignment_status: 'Completed' })
        .eq('assignment_id', assignmentId);
      if (error) throw error;

      toast.success('Vehicle returned.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to return vehicle.');
    }
  };

  // --- RETURN ALL VEHICLES FOR ONE EVENT ---
  const handleReturnAllForBooking = async (bookingId, itemCount) => {
    const sampleAssignment = assignments.find(a => a.booking_id === bookingId);
    const { canReturn, opensAt } = getReturnAvailability(sampleAssignment?.booking?.event_datetime);
    if (!canReturn) {
      toast.error(`Can't return these yet — available starting ${PICKUP_GRACE_HOURS} hours after the event, at ${formatReturnOpensAt(opensAt)}.`);
      return;
    }

    const confirmed = await showConfirm({
      title: 'Return All Vehicles?',
      message: `Mark all ${itemCount} vehicle(s) for this event as returned?`,
      confirmLabel: 'Return All',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('vehicle_assign')
        .update({ assignment_status: 'Completed' })
        .eq('booking_id', bookingId)
        .neq('assignment_status', 'Completed');
      if (error) throw error;

      toast.success('All vehicles for this event returned.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to return vehicles.');
    }
  };

  // Events that are promised but have nothing carrying them.
  //
  // This is the thread missing between approving a booking and dispatching for
  // it: approval and dispatch are one decision the system splits in two, and
  // nothing anywhere said "this event still has no van". Auto-allocation at
  // approval normally keeps this at zero — the day it is not zero is the day
  // it earns its place, which is why it only appears when there is something
  // in it.
  //
  // Past events are excluded on purpose: an event that has already happened
  // without a recorded vehicle is history, not a task. A Completed assignment
  // does not count as cover for a future event either — nothing is scheduled
  // to carry it.
  const needsVehicleBookings = (() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return bookings
      .filter(b => {
        if (!b.event_datetime) return false;
        if (new Date(b.event_datetime) < startOfToday) return false;
        // A customer collecting their own trays needs no van, so it is not a
        // gap in the schedule. Read from the venue the app writes, not from
        // the delivery fee — PG's delivers free inside Bayawan, Santa Catalina
        // and Basay, so plenty of real deliveries carry no fee at all.
        if (!needsTransport(b)) return false;
        return !assignments.some(a => a.booking_id === b.booking_id && a.assignment_status !== 'Completed');
      })
      .sort((a, b) => new Date(a.event_datetime) - new Date(b.event_datetime));
  })();

  const planDispatchFor = (bookingId) => {
    setIsNeedsVehicleModalOpen(false);
    // Setup first, always. A reopened modal inheriting "Collection run" from
    // last time would quietly file the next run as the wrong leg.
    setAssignLeg(TRIP_LEG.setup);
    handleBookingSelect(bookingId, TRIP_LEG.setup);
    setSelectedVehicleIds([]);
    setVehiclePickerSearch('');
    setIsAssignModalOpen(true);
  };

  const panelRef = useRef(null);
  // Switching tab alone is invisible when the target tab is already the active
  // one, which is why the cards used to read as "not clickable".
  const goToTab = (key) => {
    setActiveTableTab(key);
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const now = new Date();
  const totalFleet = vehicles.length;
  // Every type the fleet actually contains, plus the two seeds. Drives the
  // Add/Edit dropdowns AND both type filters, so a newly added type is
  // filterable the moment it exists.
  const fleetTypeOptions = vehicleTypeOptions(vehicles);

  // ============================================================
  // --- THE THREE CARDS: live figures, no date scope ---
  // ============================================================
  // These used to be date-scoped (events on date / committed / available) and
  // sat above a date picker, with a caption underneath explaining that the date
  // drove them and the Availability tab but not Active Assignments or History.
  // A layout needing a caption to say which of its own regions a control
  // reaches is the problem, not a caption that is too long. Equipment fixed the
  // same overload the same way: one scope per region. Everything date-scoped
  // now lives inside the PLAN tabs, next to the date picker that drives it, and
  // these three answer only "what is true right now".
  const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now); endOfToday.setHours(23, 59, 59, 999);

  // Trips, not vehicles: a van doing a setup run and a collection run for the
  // same wedding is one vehicle and two trips, and the card says trips.
  // Cancelled and rejected bookings are not commitments and never count - the
  // same trap the Equipment page's live-commitment guard was fixed for.
  const tripsToday = assignments
    .filter(a => a.booking?.booking_status !== 'Rejected' && a.booking?.booking_status !== 'Cancelled')
    .map(a => ({ a, w: getDispatchWindow(a, a.booking) }))
    .filter(({ w }) => w && w.start <= endOfToday && w.end >= startOfToday)
    .sort((x, y) => x.w.start - y.w.start);

  const nextDepartureToday = tripsToday.find(({ a, w }) => w.start >= now && a.assignment_status !== 'Completed');
  const vehiclesCommittedToday = new Set(tripsToday.map(({ a }) => a.vehicle_id)).size;

  const outOfServiceVehicles = vehicles
    .filter(v => v.vehicle_status === 'Maintenance' || v.vehicle_status === 'Unavailable')
    .sort((a, b) => a.plate_number.localeCompare(b.plate_number));

  // Unchanged rule, deliberately: overdue is measured from the EVENT, because a
  // return cannot be recorded until PICKUP_GRACE_HOURS after it. See getTripState.
  const overdueAssignments = assignments.filter(a =>
    a.assignment_status !== 'Completed' &&
    a.booking?.event_datetime && new Date(a.booking.event_datetime) < now &&
    a.booking?.booking_status !== 'Rejected' && a.booking?.booking_status !== 'Cancelled'
  );

  // ============================================================
  // --- SELECTED DATE (the PLAN cluster) ---
  // ============================================================
  const selectedDateObj = new Date(`${selectedDate}T00:00:00`);
  const isSelectedToday = selectedDate === todayISO();
  const isSelectedTomorrow = selectedDate === tomorrowISO();
  const selectedDateLabel = selectedDateObj.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    + (isSelectedToday ? ' (Today)' : isSelectedTomorrow ? ' (Tomorrow)' : '');
  const selectedDateShort = selectedDateObj.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  const shiftSelectedDate = (delta) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    setSelectedDate(toDateInputValue(new Date(y, m - 1, d + delta)));
  };

  // Full vehicle list per event on the selected date, including returned
  // ones — powers the "Events on this date" modal.
  const eventVehicleMap = {};
  snapshot.eventsOnDate.forEach(ev => {
    eventVehicleMap[ev.booking_id] = assignments
      .filter(a => a.booking_id === ev.booking_id)
      .map(a => ({
        assignment_id: a.assignment_id,
        plate_number: a.vehicle?.plate_number || 'Unknown',
        dispatch_datetime: a.dispatch_datetime,
        completed: a.assignment_status === 'Completed',
      }));
  });

  // Kept for the vehicle detail modal: the date-scoped reading of one vehicle.
  const getVehicleAvailabilityStatus = (v) => {
    if (v.vehicle_status === 'Maintenance') return { key: 'maintenance', label: RESOURCE_STATE.underMaintenance, pillClass: 'bg-amber-50 border-amber-200 text-amber-700' };
    if (v.vehicle_status === 'Unavailable') return { key: 'unavailable', label: RESOURCE_STATE.unavailable, pillClass: 'bg-slate-100 border-slate-300 text-slate-600' };
    if (v.assignments.length > 0) return { key: 'deployed', label: RESOURCE_STATE.committed, pillClass: 'bg-slate-100 border-slate-200 text-slate-600' };
    return { key: 'free', label: RESOURCE_STATE.available, pillClass: 'bg-[#EAF3F2] border-[#c2dccf] text-[#00703a]' };
  };

  // ============================================================
  // --- DAY SCHEDULE ---
  // ============================================================
  // The table this replaced could express exactly ONE trip per vehicle, which
  // is the shape the window model breaks: a van that runs a 06:00 wedding setup
  // is back by early afternoon and can still take a 14:00 delivery. Drawn as
  // blocks on a fixed day scale that reads at a glance - busy twice, open in
  // between - instead of leaving the manager to do the arithmetic.
  //
  // The scale is a fixed working window, not the widest trip of the day, so
  // blocks sit in the same place from one date to the next. A bar that rescales
  // itself cannot be compared against yesterday's. It runs to 23:00 because
  // real collection runs finish late - a 22:00 run is normal here.
  const TIMELINE_START_HOUR = 4;
  const TIMELINE_END_HOUR = 23;
  const AXIS_SPAN_HOURS = TIMELINE_END_HOUR - TIMELINE_START_HOUR;
  const timelineTicks = [];
  for (let h = TIMELINE_START_HOUR; h <= TIMELINE_END_HOUR; h += 3) {
    timelineTicks.push({ hour: h, label: fmtHourTick(h), pct: ((h - TIMELINE_START_HOUR) / AXIS_SPAN_HOURS) * 100 });
  }

  const axisStart = new Date(selectedDateObj.getTime() + TIMELINE_START_HOUR * 3600 * 1000);
  const axisEnd = new Date(selectedDateObj.getTime() + TIMELINE_END_HOUR * 3600 * 1000);
  const axisMs = axisEnd - axisStart;
  const pctOf = (ms) => ((ms - axisStart.getTime()) / axisMs) * 100;

  const timelineRows = snapshot.vehicles
    .map(v => {
      const outOfService = v.vehicle_status !== 'Available';

      const trips = (v.assignments || []).map(a => {
        // Clamp, never drop. A collection run finishing after the scale must
        // still render - a trip that silently vanishes off the axis is worse
        // than one drawn short.
        const from = Math.max(a.window.start.getTime(), axisStart.getTime());
        const to = Math.min(a.window.end.getTime(), axisEnd.getTime());
        if (to <= from) return null;
        const left = pctOf(from);
        // A floor, so a 90-minute delivery is not an invisible sliver that
        // reads as an open day; never allowed to run past the axis.
        const width = Math.min(100 - left, Math.max(6, pctOf(to) - left));
        return {
          ...a,
          // Always the window's own label. A hardcoded leg name makes every
          // short order read "Setup run"; legLabelFor already resolves
          // Delivery vs Setup run per trip type.
          legLabel: a.window.legLabel,
          left,
          width,
          span: fmtSpan(a.window),
          clippedEnd: a.window.end.getTime() > axisEnd.getTime(),
          tone: toneFor(a.window.legLabel, a.completed),
        };
      }).filter(Boolean).sort((x, y) => x.window.start - y.window.start);

      // Overlap on ONE vehicle is a double-booking, not a layout problem.
      // Measured on the real times, never on the rendered widths - the width
      // floor above would report two short back-to-back runs as a clash.
      trips.forEach((t, i) => {
        const prev = trips[i - 1];
        if (prev && t.window.start < prev.window.end) { t.clash = true; prev.clash = true; }
      });

      // An out-of-service vehicle gets NO open windows. Its empty hours are
      // real but nobody may book them - the same error as counting damaged
      // stock as available on the Equipment page.
      const openWindows = outOfService ? [] : openWindowsBetween(trips.map(t => t.window), axisStart, axisEnd)
        .map(g => {
          const left = pctOf(+g.start);
          return {
            left,
            width: pctOf(+g.end) - left,
            label: `${fmtClock(g.start)} – ${fmtClock(g.end)}`,
            hours: (g.end - g.start) / 3600 / 1000,
          };
        });

      return {
        raw: v,
        vehicle_id: v.vehicle_id,
        plate_number: v.plate_number,
        vehicle_type: v.vehicle_type,
        vehicle_status: v.vehicle_status,
        outOfService,
        trips,
        openWindows,
        hasClash: trips.some(t => t.clash),
      };
    })
    // Vehicles with work first, then open ones, then anything out of service —
    // the order a manager reads the day in.
    .sort((a, b) => {
      const rank = (r) => r.outOfService ? 2 : r.trips.length ? 0 : 1;
      return rank(a) - rank(b) || a.plate_number.localeCompare(b.plate_number);
    });

  // Assign modal: the bounds for the leg being created, and the window the
  // chosen time actually produces.
  const assignBounds = selectedBooking ? getDispatchBounds(selectedBooking, assignLeg) : null;
  const assignChosenAt = assignForm.dispatch_datetime ? new Date(assignForm.dispatch_datetime) : null;
  const assignInBounds = !selectedBooking || !assignChosenAt || isNaN(assignChosenAt)
    || isDispatchInBounds(assignChosenAt, selectedBooking, assignLeg);
  const assignPreviewWindow = selectedBooking && assignChosenAt && !isNaN(assignChosenAt)
    ? getDispatchWindow({ dispatch_datetime: assignChosenAt.toISOString() }, selectedBooking)
    : null;

  const dayTripCount = timelineRows.reduce((n, r) => n + r.trips.length, 0);
  const dayCommittedVehicles = timelineRows.filter(r => r.trips.length > 0).length;
  const dayClashRows = timelineRows.filter(r => r.hasClash);
  const nowPct = isSelectedToday && now >= axisStart && now <= axisEnd ? pctOf(now.getTime()) : null;

  // Assignments with no event date produce no window at all. Reported, never
  // drawn as a zero-width block at the axis origin.
  const unscheduledTrips = assignments.filter(a =>
    a.assignment_status !== 'Completed' &&
    a.booking?.booking_status !== 'Rejected' && a.booking?.booking_status !== 'Cancelled' &&
    !getDispatchWindow(a, a.booking)
  );

  const needsVehicleOnDate = needsVehicleBookings.filter(b =>
    new Date(b.event_datetime).toDateString() === selectedDateObj.toDateString()
  );

  // ============================================================
  // --- FIND A WINDOW: the planning inverse ---
  // ============================================================
  // The day schedule answers "what is this vehicle doing"; this answers "which
  // vehicle could take a four-hour job on Friday". Same date, same derivation -
  // openWindowsBetween with a longer minimum - so the two tabs can never
  // disagree about whether a gap exists.
  const windowMinHoursValue = windowMinHours === 'day' ? AXIS_SPAN_HOURS : windowMinHours;
  const windowResults = timelineRows
    .filter(r => windowTypeFilter === 'All' || r.vehicle_type === windowTypeFilter)
    .map(r => {
      const gaps = r.outOfService ? [] : openWindowsBetween(
        r.trips.map(t => t.window), axisStart, axisEnd, windowMinHoursValue
      );
      const busyFrom = r.trips.length ? r.trips[0].window.start : null;
      const busyTo = r.trips.length ? new Date(Math.max(...r.trips.map(t => +t.window.end))) : null;
      return {
        ...r,
        gaps: gaps.map(g => ({
          label: g.end - g.start >= axisMs ? 'Open all day' : `${fmtClock(g.start)} – ${fmtClock(g.end)}`,
        })),
        busyFrom,
        busyTo,
      };
    })
    .sort((a, b) => (b.gaps.length > 0) - (a.gaps.length > 0) || a.plate_number.localeCompare(b.plate_number));

  const windowMatchCount = windowResults.filter(r => r.gaps.length > 0).length;
  const windowLengthLabel = windowMinHours === 'day' ? 'the whole day' : `${windowMinHours} hours`;

  // ============================================================
  // --- VEHICLES TAB: the fleet itself, no date scope ---
  // ============================================================
  const filteredInventory = vehicles.filter(v => {
    if (inventoryTypeFilter !== 'All' && v.vehicle_type !== inventoryTypeFilter) return false;
    if (inventorySearch && !v.plate_number.toLowerCase().includes(inventorySearch.toLowerCase())) return false;
    return true;
  });
  const activeInventoryFilterCount = (inventorySearch.trim() ? 1 : 0) + (inventoryTypeFilter !== 'All' ? 1 : 0);

  const fleetRows = filteredInventory.map(v => {
    // "Committed" counted every open assignment and called it "in use", so a
    // van booked for a wedding three weeks out read as being on the road right
    // now. Committed and on the road are different states, and they are counted
    // and labelled separately.
    const openTrips = assignments.filter(a =>
      a.vehicle_id === v.vehicle_id &&
      a.assignment_status !== 'Completed' &&
      a.booking?.booking_status !== 'Rejected' && a.booking?.booking_status !== 'Cancelled'
    );
    const scheduled = openTrips
      .map(a => ({ a, w: getDispatchWindow(a, a.booking) }))
      .filter(x => x.w)
      .sort((x, y) => x.w.start - y.w.start);
    const onRoad = scheduled.find(x => x.w.start <= now && now <= x.w.end) || null;
    const next = scheduled.find(x => x.w.start > now) || null;
    return { v, committedCount: openTrips.length, onRoad, next };
  });

  // ============================================================
  // --- TRIPS TAB: open dispatches, grouped by event ---
  // ============================================================
  const activeAssignmentRows = assignments.filter(a =>
    a.assignment_status !== 'Completed' &&
    a.booking?.booking_status !== 'Rejected' && a.booking?.booking_status !== 'Cancelled'
  );
  const assignmentGroupsMap = {};
  activeAssignmentRows.forEach(a => {
    const bId = a.booking_id;
    if (!assignmentGroupsMap[bId]) {
      assignmentGroupsMap[bId] = { booking_id: bId, booking: a.booking, items: [] };
    }
    assignmentGroupsMap[bId].items.push(a);
  });

  const assignmentGroups = Object.values(assignmentGroupsMap).map(g => {
    const eventDate = g.booking?.event_datetime ? new Date(g.booking.event_datetime) : null;
    const isOverdue = eventDate ? eventDate < now : false;
    const isToday = eventDate ? eventDate.toDateString() === now.toDateString() : false;
    const { canReturn, opensAt: returnOpensAt } = getReturnAvailability(g.booking?.event_datetime);
    return { ...g, eventDate, isOverdue, isToday, canReturn, returnOpensAt };
  }).sort((a, b) => {
    const rank = (g) => g.isOverdue ? 0 : g.isToday ? 1 : 2;
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    if (!a.eventDate || !b.eventDate) return 0;
    return a.eventDate - b.eventDate;
  });

  const assignmentSectionCounts = {
    Overdue: assignmentGroups.filter(g => g.isOverdue).length,
    Today: assignmentGroups.filter(g => !g.isOverdue && g.isToday).length,
    Upcoming: assignmentGroups.filter(g => !g.isOverdue && !g.isToday).length,
  };

  const overdueGroups = assignmentGroups.filter(g => g.isOverdue);
  const daysOverdue = (eventDate) => Math.max(0, Math.floor((now - eventDate) / (1000 * 60 * 60 * 24)));

  const { start: assignmentRangeStart, end: assignmentRangeEnd } = getRangeBounds(assignmentDatePreset, assignmentDateCustomStart, assignmentDateCustomEnd);

  const filteredAssignmentGroups = assignmentGroups.filter(g => {
    if (assignmentSectionFilter === 'Overdue' && !g.isOverdue) return false;
    if (assignmentSectionFilter === 'Today' && !(g.isToday && !g.isOverdue)) return false;
    if (assignmentSectionFilter === 'Upcoming' && (g.isOverdue || g.isToday)) return false;
    if (assignmentDatePreset !== 'All Time' && !isWithinRange(g.eventDate, assignmentRangeStart, assignmentRangeEnd)) return false;
    if (assignmentSearchTerm.trim()) {
      const term = assignmentSearchTerm.toLowerCase();
      const ref = (g.booking ? getBookingRef(g.booking) : '').toLowerCase();
      const customerName = (g.booking?.customer ? `${g.booking.customer.first_name} ${g.booking.customer.last_name}` : '').toLowerCase();
      const venue = (g.booking?.venue || '').toLowerCase();
      const plateNames = g.items.map(i => (i.vehicle?.plate_number || '').toLowerCase()).join(' ');
      if (!ref.includes(term) && !customerName.includes(term) && !venue.includes(term) && !plateNames.includes(term)) return false;
    }
    return true;
  });

  const activeAssignmentFilterCount = (assignmentSearchTerm.trim() ? 1 : 0) + (assignmentSectionFilter !== 'All' ? 1 : 0) + (assignmentDatePreset !== DEFAULT_DATE_PRESET ? 1 : 0);

  const sortedFilteredAssignmentGroups = assignmentSort.field === 'date'
    ? [...filteredAssignmentGroups].sort((a, b) => {
        const result = (a.eventDate?.getTime() || 0) - (b.eventDate?.getTime() || 0);
        return assignmentSort.direction === 'asc' ? result : -result;
      })
    : assignmentSort.field === 'customer'
    ? [...filteredAssignmentGroups].sort((a, b) => {
        const nameA = a.booking?.customer ? `${a.booking.customer.first_name} ${a.booking.customer.last_name}` : '';
        const nameB = b.booking?.customer ? `${b.booking.customer.first_name} ${b.booking.customer.last_name}` : '';
        const result = nameA.localeCompare(nameB);
        return assignmentSort.direction === 'asc' ? result : -result;
      })
    : filteredAssignmentGroups;

  const filteredTripCount = filteredAssignmentGroups.reduce((n, g) => n + g.items.length, 0);

  // ============================================================
  // --- HISTORY TAB: every dispatch ever recorded ---
  // ============================================================
  // One row per DISPATCH, not per booking. These rows were grouped by booking
  // because a two-vehicle dispatch produced two rows carrying the same
  // reference, customer and date, and read as a duplicate. Naming the leg is
  // what actually fixes that: a setup run and a collection run on one booking
  // are two different facts, and a log that hides one of them behind a
  // disclosure triangle is not a log. Equipment still groups, correctly - there
  // a group is one booking's many item types, which is a different shape.
  const { start: historyRangeStart, end: historyRangeEnd } = getRangeBounds(historyDatePreset, historyDateCustomStart, historyDateCustomEnd);

  const historyRows = assignments
    .map(a => ({ a, w: getDispatchWindow(a, a.booking), state: getTripState(a, a.booking, now) }))
    .filter(({ a, state }) => {
      if (historyStatusFilter !== 'All' && state.key !== historyStatusFilter) return false;
      if (historyDatePreset !== 'All Time' && !isWithinRange(a.booking?.event_datetime, historyRangeStart, historyRangeEnd)) return false;
      if (historySearch.trim()) {
        const term = historySearch.toLowerCase();
        const plate = (a.vehicle?.plate_number || '').toLowerCase();
        const ref = (a.booking ? getBookingRef(a.booking) : '').toLowerCase();
        const customerName = (a.booking?.customer ? `${a.booking.customer.first_name} ${a.booking.customer.last_name}` : '').toLowerCase();
        const venue = (a.booking?.venue || '').toLowerCase();
        if (!plate.includes(term) && !ref.includes(term) && !customerName.includes(term) && !venue.includes(term)) return false;
      }
      return true;
    })
    .sort((x, y) => new Date(y.a.dispatch_datetime || 0) - new Date(x.a.dispatch_datetime || 0));

  const activeHistoryFilterCount = (historySearch.trim() ? 1 : 0) + (historyStatusFilter !== 'All' ? 1 : 0) + (historyDatePreset !== DEFAULT_DATE_PRESET ? 1 : 0);

  // --- RENDER ---
  // The PLAN cluster's date control. One definition, rendered by both plan
  // tabs, so Day schedule and Find a window can never drift into showing
  // different dates for the same selection.
  const dateNav = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center rounded-[10px] border border-slate-300 bg-white overflow-hidden">
        <button
          onClick={() => shiftSelectedDate(-1)}
          aria-label="Previous day"
          className="px-2 py-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors cursor-pointer"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="px-3 text-[14.5px] font-bold text-slate-900 whitespace-nowrap tabular-nums">{selectedDateShort}</span>
        <button
          onClick={() => shiftSelectedDate(1)}
          aria-label="Next day"
          className="px-2 py-[7px] text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors cursor-pointer"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <button
        onClick={() => setSelectedDate(todayISO())}
        className={`px-3 py-[7px] rounded-[10px] text-[13px] font-semibold border transition-colors cursor-pointer ${isSelectedToday ? 'bg-[#EAF3F2] border-[#c2dccf] text-[#00703a]' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
      >
        Today
      </button>
      <button
        onClick={() => setSelectedDate(tomorrowISO())}
        className={`px-3 py-[7px] rounded-[10px] text-[13px] font-semibold border transition-colors cursor-pointer ${isSelectedTomorrow ? 'bg-[#EAF3F2] border-[#c2dccf] text-[#00703a]' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'}`}
      >
        Tomorrow
      </button>
      <input
        type="date"
        value={selectedDate}
        onChange={(e) => setSelectedDate(e.target.value)}
        aria-label="Pick a date"
        className="border border-slate-300 rounded-[10px] px-3 py-[6px] text-[13px] font-semibold text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
      />
      {snapshotLoading && <span className="text-[12.5px] text-slate-400">recalculating…</span>}
    </div>
  );

  return (
    <div className="space-y-[18px] relative pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-[25px] font-bold tracking-[-0.02em] text-slate-900">Vehicles</h1>
          <p className="text-[14.5px] text-slate-600 mt-1.5 max-w-[540px] [text-wrap:pretty]">
            The fleet, the trips it is committed to, and what is on the road.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {needsVehicleBookings.length > 0 && (
            <button
              onClick={() => setIsNeedsVehicleModalOpen(true)}
              className="bg-[#fef4f4] border border-[#f3c9c9] text-red-700 px-4 py-2.5 rounded-[10px] font-semibold transition-colors flex items-center gap-2 text-sm whitespace-nowrap cursor-pointer hover:bg-[#fdeaea] focus:outline-none focus:ring-2 focus:ring-red-400/40"
            >
              <AlertTriangle size={16} /> Awaiting vehicle ({needsVehicleBookings.length})
            </button>
          )}
          <button
            onClick={() => { setAddFieldErrors({}); setAddTypeIsCustom(false); setNewVehicleForm({ plate_number: '', vehicle_type: 'Car' }); setIsAddModalOpen(true); }}
            className="bg-white border border-slate-300 text-slate-700 px-4 py-2.5 rounded-[10px] font-semibold transition-colors flex items-center gap-2 text-sm whitespace-nowrap shadow-sm cursor-pointer hover:bg-[#f4f9f6] hover:border-[#c9dfd4] hover:text-[#007038] focus:outline-none focus:ring-2 focus:ring-[#008A45]/40"
          >
            <Plus size={16} /> Add vehicle
          </button>
          <button
            onClick={() => { setSelectedVehicleIds([]); setBookingSearchTerm(''); setShowBookingDropdown(false); setVehiclePickerSearch(''); setAssignLeg(TRIP_LEG.setup); setIsAssignModalOpen(true); }}
            className="bg-[#008A45] hover:bg-[#007038] text-white px-[17px] py-2.5 rounded-[10px] font-bold transition-all flex items-center gap-2 text-sm whitespace-nowrap shadow-sm hover:shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 focus:ring-offset-1"
          >
            <ClipboardList size={16} /> Assign vehicles
          </button>
          <button
            onClick={fetchData}
            aria-label="Refresh"
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-3 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs cursor-pointer"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* --- AT A GLANCE — live figures only.
      The date-scoped cards that used to sit here (events on date / committed /
      available) moved into the PLAN tabs, next to the date picker that drives
      them, and the two alert panels from the 320px sidebar are folded in as the
      second and third cards. That rail's "View all" buttons went to exactly the
      places these cards now go to, so nothing is lost and the page is one
      column instead of two competing for attention. Same fix Equipment had:
      one scope per region, which is what removes the three captions that used
      to explain the layout to the reader. --- */}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
        <button
          onClick={() => { setSelectedDate(todayISO()); goToTab('day'); }}
          className="relative overflow-hidden rounded-[15px] border border-slate-200/70 bg-white px-5 py-[18px] text-left cursor-pointer transition-all hover:border-[#c9dfd4] hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)] focus:outline-none focus:ring-2 focus:ring-[#008A45]/40"
        >
          <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#008A45]" />
          {/* Trips, not vehicles. One van doing a setup run and a collection
              run is one vehicle and two trips, and the label says trips. */}
          <span className="block text-[13px] font-semibold text-slate-600 mb-2 whitespace-nowrap">Trips today</span>
          <span className={`block text-[30px] font-semibold tracking-[-0.03em] leading-none tabular-nums ${tripsToday.length > 0 ? 'text-slate-900' : 'text-slate-400'}`}>{tripsToday.length}</span>
          <span className="block text-[13px] text-slate-600 mt-2.5">
            {tripsToday.length === 0
              ? 'Nothing dispatched today'
              : `${nextDepartureToday ? `Next leaves ${fmtClock(nextDepartureToday.w.start)}` : 'All of today’s trips have left'} · ${vehiclesCommittedToday} of ${totalFleet} vehicles committed`}
          </span>
        </button>

        <button
          onClick={() => goToTab('fleet')}
          className="relative overflow-hidden rounded-[15px] border border-slate-200/70 bg-white px-5 py-[18px] text-left cursor-pointer transition-all hover:border-[#c9dfd4] hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)] focus:outline-none focus:ring-2 focus:ring-[#008A45]/40"
        >
          <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${outOfServiceVehicles.length > 0 ? 'bg-amber-500' : 'bg-slate-400'}`} />
          <span className="block text-[13px] font-semibold text-slate-600 mb-2 whitespace-nowrap">Out of service</span>
          <span className={`block text-[30px] font-semibold tracking-[-0.03em] leading-none tabular-nums ${outOfServiceVehicles.length > 0 ? 'text-slate-900' : 'text-slate-400'}`}>{outOfServiceVehicles.length}</span>
          <span className="block text-[13px] text-slate-600 mt-2.5 truncate">
            {outOfServiceVehicles.length === 0
              ? `All ${totalFleet} vehicle${totalFleet === 1 ? '' : 's'} in service`
              : `${outOfServiceVehicles.slice(0, 3).map(v => v.plate_number).join(', ')}${outOfServiceVehicles.length > 3 ? ` +${outOfServiceVehicles.length - 3}` : ''} · never offered a window`}
          </span>
        </button>

        <button
          onClick={() => { setAssignmentSectionFilter('Overdue'); goToTab('trips'); }}
          className="relative overflow-hidden rounded-[15px] border border-slate-200/70 bg-white px-5 py-[18px] text-left cursor-pointer transition-all hover:border-[#c9dfd4] hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)] focus:outline-none focus:ring-2 focus:ring-[#008A45]/40"
        >
          <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${overdueGroups.length > 0 ? 'bg-red-500' : 'bg-slate-400'}`} />
          <span className="block text-[13px] font-semibold text-slate-600 mb-2 whitespace-nowrap">Overdue returns</span>
          <span className={`block text-[30px] font-semibold tracking-[-0.03em] leading-none tabular-nums ${overdueGroups.length > 0 ? 'text-red-700' : 'text-slate-400'}`}>{overdueGroups.length}</span>
          <span className="block text-[13px] text-slate-600 mt-2.5">
            {overdueGroups.length > 0
              ? `${overdueAssignments.length} trip${overdueAssignments.length === 1 ? '' : 's'} past the event with no return recorded`
              : 'All returns up to date'}
          </span>
        </button>
      </div>

      {/* --- ONE FULL-WIDTH TABBED PANEL --- */}
      <div ref={panelRef} className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
        {/* Two labelled clusters, the shape Equipment uses, so the sibling
            pages read as one system.

            PLAN is date-scoped; FLEET is not. That was this page's core
            confusion — its tabs carried three different time scopes, and the
            Assignments blurb said outright that it ignored the date picker the
            other tabs obeyed. The clusters say which is which BEFORE you click,
            which a per-tab sentence can only do afterwards.

            Plan carries no badge: a count there would have to mean "on the
            selected date", and beside Fleet's fleet-wide totals it reads as
            one. */}
        <div className="flex items-stretch border-b border-slate-100 overflow-x-auto">
          {[
            {
              cluster: 'Plan',
              tabs: [
                { key: 'day', label: 'Day schedule', Icon: Calendar },
                { key: 'window', label: 'Find a window', Icon: Clock },
              ],
            },
            {
              cluster: 'Fleet',
              tabs: [
                { key: 'fleet', label: 'Vehicles', Icon: LayoutGrid, count: totalFleet },
                { key: 'trips', label: 'Trips', Icon: ClipboardList, count: activeAssignmentRows.length, alert: overdueGroups.length > 0 },
                { key: 'history', label: 'History', Icon: History },
              ],
            },
          ].map((group, gi) => (
            <div key={group.cluster} className="flex items-center shrink-0">
              {gi > 0 && <span className="shrink-0 w-px self-stretch my-2 mx-4 bg-slate-200" />}
              <span className={`${gi === 0 ? 'ml-[18px]' : ''} mr-2.5 shrink-0 inline-flex items-center gap-1.5 self-center px-2.5 py-[5px] rounded-md bg-slate-100 border border-slate-200 text-[10.5px] font-bold tracking-[0.14em] uppercase text-slate-600 whitespace-nowrap`}>
                <span className="w-1 h-1 rounded-full bg-slate-400" aria-hidden="true" />
                {group.cluster}
              </span>
              {group.tabs.map(t => {
                const isActive = activeTableTab === t.key;
                return (
                  <button
                    key={t.key}
                    onClick={() => setActiveTableTab(t.key)}
                    className={`shrink-0 flex items-center gap-[7px] whitespace-nowrap px-[15px] py-[13px] -mb-px border-b-2 text-[14.5px] transition-colors cursor-pointer ${
                      isActive
                        ? 'border-[#008A45] text-[#007038] font-bold'
                        : 'border-transparent text-slate-600 font-semibold hover:text-slate-900'
                    }`}
                  >
                    <t.Icon size={15} /> {t.label}
                    {t.count !== undefined && t.count > 0 && (
                      <span className={`inline-flex items-center justify-center min-w-[21px] h-[21px] px-1.5 rounded-full text-[12.5px] font-bold tabular-nums ${
                        t.alert ? 'bg-red-100 text-red-700' : isActive ? 'bg-[#EAF3F2] text-[#00703a]' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {t.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* The Day line states the trip-window rule outright — it is the idea
            the whole page rests on and the one a reader cannot infer from a
            schedule. */}
        <div className="flex items-start gap-2.5 px-5 py-3.5 border-b border-slate-100 bg-[#fbfcfd]">
          <Info size={15} className="shrink-0 mt-0.5 text-slate-400" />
          <p className="text-[13.5px] leading-[1.5] text-slate-600 [text-wrap:pretty]">
            {activeTableTab === 'day' && <>Every trip on the selected date, laid on a time axis. A vehicle is only committed for its trip window, so one van can serve two events in a day as long as the windows do not overlap.</>}
            {activeTableTab === 'window' && <>The planning inverse of the day schedule: pick how long the job takes and see which vehicles still have a gap that long on the selected date.</>}
            {activeTableTab === 'fleet' && <>The vehicles we own, their service status, and how many trips each is committed to. This tab is about the vehicles, not the schedule.</>}
            {activeTableTab === 'trips' && <>Every trip not yet marked back at base, grouped by event. Overdue means the event has passed with no return recorded.</>}
            {activeTableTab === 'history' && <>Every dispatch ever recorded, one row per run, over the chosen date range.</>}
          </p>
        </div>

        {/* ================= DAY SCHEDULE ================= */}
        {activeTableTab === 'day' && (
          <>
            <div className="px-5 py-4 border-b border-slate-100">
              <div className="flex flex-wrap items-center justify-between gap-3">
                {dateNav}
                <button
                  onClick={() => setIsEventsModalOpen(true)}
                  className="text-[13px] font-semibold text-[#007038] hover:underline cursor-pointer whitespace-nowrap"
                >
                  See the events on this date
                </button>
              </div>
              <p className="text-[13px] text-slate-600 mt-2.5 tabular-nums">
                {snapshot.eventsOnDate.length} event{snapshot.eventsOnDate.length === 1 ? '' : 's'} · {dayTripCount} trip{dayTripCount === 1 ? '' : 's'} · {dayCommittedVehicles} of {totalFleet} vehicle{totalFleet === 1 ? '' : 's'} committed
              </p>
            </div>

            {/* Double-booking is a correctness problem, not a drawing problem,
                so it is stated in words above the chart rather than left to be
                spotted in the overlap. */}
            {dayClashRows.length > 0 && (
              <div className="flex items-start gap-2.5 px-5 py-3 border-b border-red-100 bg-red-50/50">
                <AlertTriangle size={15} className="shrink-0 mt-0.5 text-red-500" />
                <p className="text-[13.5px] text-red-800 [text-wrap:pretty]">
                  <span className="font-bold">Double-booked:</span>{' '}
                  {dayClashRows.map(r => r.plate_number).join(', ')} {dayClashRows.length === 1 ? 'has' : 'have'} overlapping trip windows on this date. One vehicle cannot be in two places, so one of these has to move.
                </p>
              </div>
            )}

            {snapshotLoading ? (
              <div className="px-5 py-10 text-center text-slate-500 text-sm">Working out the day…</div>
            ) : timelineRows.length === 0 ? (
              <div className="px-5 py-10 text-center text-slate-500 text-sm">No vehicles in the fleet yet.</div>
            ) : (
              <div className="px-5 py-4">
                {/* hour ruler */}
                <div className="flex items-end gap-3 pb-1.5 border-b border-slate-100">
                  <span className="w-[132px] shrink-0 text-[11px] font-bold tracking-[0.08em] uppercase text-slate-500">Vehicle</span>
                  <div className="relative flex-1 h-4">
                    {timelineTicks.map(t => (
                      <span
                        key={t.hour}
                        className="absolute bottom-0 -translate-x-1/2 text-[11px] text-slate-400 tabular-nums whitespace-nowrap"
                        style={{ left: `${t.pct}%` }}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="divide-y divide-slate-100">
                  {timelineRows.map(row => {
                    const onRoadNow = isSelectedToday && row.trips.some(t => !t.completed && t.window.start <= now && now <= t.window.end);
                    const dot = row.outOfService ? '#f59e0b' : onRoadNow ? '#008A45' : row.trips.length ? '#475569' : '#cbd5e1';
                    return (
                      <div key={row.vehicle_id} className="flex items-center gap-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => { setAvailabilityDetailVehicle(row.raw); setIsAvailabilityDetailOpen(true); }}
                          title="See this vehicle's day in full"
                          className="w-[132px] shrink-0 min-w-0 text-left cursor-pointer group"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="w-[7px] h-[7px] rounded-full shrink-0" style={{ background: dot }} aria-hidden="true" />
                            <span className="text-[14px] font-bold text-slate-900 truncate group-hover:text-[#007038] transition-colors">{row.plate_number}</span>
                          </span>
                          <span className="block pl-[15px]">
                            {row.outOfService
                              ? <span className="text-[12.5px] font-semibold text-amber-700">{row.vehicle_status}</span>
                              : <TypeTag type={row.vehicle_type} />}
                          </span>
                        </button>

                        <div className={`relative flex-1 h-[52px] rounded-[9px] border ${row.hasClash ? 'border-red-200 bg-red-50/40' : row.outOfService ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                          {timelineTicks.map(t => (
                            <span key={t.hour} className="absolute top-0 bottom-0 w-px bg-slate-100" style={{ left: `${t.pct}%` }} aria-hidden="true" />
                          ))}

                          {row.outOfService ? (
                            <span className="absolute inset-0 flex items-center justify-center text-[12.5px] font-semibold text-amber-700">
                              Out of service — no windows offered
                            </span>
                          ) : (
                            <>
                              {row.openWindows.map((w, i) => (
                                <span
                                  key={`open-${i}`}
                                  title={`Open window · ${w.label} · ${w.hours.toFixed(1)} h`}
                                  className="absolute top-[7px] bottom-[7px] rounded-[6px] border border-[#e7edf3] flex items-center justify-center overflow-hidden"
                                  style={{ left: `${w.left}%`, width: `${w.width}%`, background: OPEN_FILL }}
                                >
                                  {/* Suppressed when the vehicle has no trips
                                      at all: the hatch then spans the whole
                                      row and its label would print underneath
                                      the "open all day" line below. */}
                                  {w.width > 11 && row.trips.length > 0 && (
                                    <span className="text-[11px] text-slate-400 tabular-nums whitespace-nowrap px-1">{w.label}</span>
                                  )}
                                </span>
                              ))}

                              {row.trips.length === 0 && (
                                <span className="absolute inset-0 flex items-center justify-center text-[12.5px] font-semibold text-slate-500 pointer-events-none">
                                  No trips — open all day
                                </span>
                              )}

                              {row.trips.map(t => (
                                <button
                                  key={t.assignment_id}
                                  type="button"
                                  onClick={() => goToBookingDetails(t.booking_id, t.booking_type)}
                                  title={`${t.legLabel} · ${t.ref} · ${t.customerName} · ${t.span}${t.completed ? ' · back at base' : ''}${t.clash ? ' · OVERLAPS another trip on this vehicle' : ''}`}
                                  className={`absolute top-[5px] bottom-[5px] rounded-[6px] border px-2 flex flex-col justify-center items-start overflow-hidden text-left cursor-pointer transition-shadow hover:shadow-[0_2px_8px_rgba(15,23,42,0.12)] ${t.clash ? 'ring-1 ring-red-400' : ''}`}
                                  style={{ left: `${t.left}%`, width: `${t.width}%`, background: t.tone.bg, borderColor: t.tone.bd, color: t.tone.fg }}
                                >
                                  <span className="text-[11.5px] font-bold leading-tight truncate w-full">
                                    {t.legLabel}{t.completed && ' ✓'}
                                  </span>
                                  <span className="text-[10.5px] leading-tight truncate w-full opacity-80 tabular-nums">
                                    {t.span}{t.clippedEnd ? '→' : ''} · {t.ref}
                                  </span>
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* now line, only on today — a marker on a date the reader is
                    only browsing would point at nothing. */}
                {nowPct !== null && (
                  <div className="flex items-center gap-3 mt-1">
                    <span className="w-[132px] shrink-0 text-[11.5px] font-semibold text-slate-500 text-right pr-1 tabular-nums">Now {fmtClock(now)}</span>
                    <div className="relative flex-1 h-3">
                      <span className="absolute top-0 bottom-0 w-px bg-slate-800" style={{ left: `${nowPct}%` }} />
                      <span className="absolute top-0 w-[7px] h-[7px] rounded-full bg-slate-800 -translate-x-1/2" style={{ left: `${nowPct}%` }} />
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3.5 pt-3 border-t border-slate-100">
                  {['Setup run', 'Collection run', 'Delivery'].map(leg => (
                    <span key={leg} className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-600 whitespace-nowrap">
                      <span className="w-3 h-3 rounded-[3px] border" style={{ background: LEG_TONE[leg].bg, borderColor: LEG_TONE[leg].bd }} />
                      {leg}
                    </span>
                  ))}
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-600 whitespace-nowrap">
                    <span className="w-3 h-3 rounded-[3px] border border-[#e7edf3]" style={{ background: OPEN_FILL }} />
                    Open window ({OPEN_WINDOW_MIN_HOURS} h or more)
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-600 whitespace-nowrap">
                    <span className="w-3 h-3 rounded-[3px] border" style={{ background: BACK_TONE.bg, borderColor: BACK_TONE.bd }} />
                    Back at base
                  </span>
                </div>

                {unscheduledTrips.length > 0 && (
                  <p className="text-[12.5px] text-amber-700 mt-3">
                    {unscheduledTrips.length} open trip{unscheduledTrips.length === 1 ? ' has' : 's have'} no event date and cannot be placed on any day. Nothing is drawn for {unscheduledTrips.length === 1 ? 'it' : 'them'}.
                  </p>
                )}
              </div>
            )}

            {/* The thread that used to be missing between approving a booking
                and dispatching for it. Only appears when there is something in
                it — a permanently empty panel teaches a reader to skip it. */}
            {needsVehicleOnDate.length > 0 && (
              <div className="px-5 py-4 border-t border-slate-100 bg-[#fffaf7]">
                <p className="text-[14.5px] font-bold text-slate-900">Events on this date still needing a vehicle</p>
                <p className="text-[13px] text-slate-600 mt-0.5 mb-3">
                  {needsVehicleOnDate.length} approved event{needsVehicleOnDate.length === 1 ? '' : 's'} on {fmtDay(selectedDateObj)} with nothing dispatched to carry {needsVehicleOnDate.length === 1 ? 'it' : 'them'}
                </p>
                <div className="space-y-2">
                  {needsVehicleOnDate.map(b => (
                    <div key={b.booking_id} className="flex flex-wrap items-center justify-between gap-3 bg-white border border-[#f0dfd2] rounded-[11px] px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[14.5px] font-bold text-slate-900">{b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown'}</p>
                        <p className="text-[13px] text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-2 tabular-nums">
                          <span>{fmtClock(new Date(b.event_datetime))}</span>
                          {b.pax_count ? <span>· {b.pax_count} pax</span> : null}
                          {b.venue && <span className="flex items-center gap-1">· <MapPin size={11} /> {b.venue}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[13px] font-semibold text-[#007038] tabular-nums">{getBookingRef(b)}</span>
                        <button
                          onClick={() => planDispatchFor(b.booking_id)}
                          className="bg-[#008A45] hover:bg-[#007038] text-white text-[13px] font-semibold px-3.5 py-2 rounded-[9px] transition-colors cursor-pointer"
                        >
                          Assign
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ================= FIND A WINDOW ================= */}
        {activeTableTab === 'window' && (
          <>
            <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-3">
              {dateNav}
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-slate-500 whitespace-nowrap">Trip length</span>
                <div className="flex items-center gap-1">
                  {[{ v: 2, l: '2 h' }, { v: 4, l: '4 h' }, { v: 6, l: '6 h' }, { v: 'day', l: 'All day' }].map(opt => (
                    <button
                      key={opt.l}
                      onClick={() => setWindowMinHours(opt.v)}
                      className={`px-2.5 py-1.5 rounded-lg text-[13px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                        windowMinHours === opt.v ? 'bg-[#EAF3F2] border-[#c2dccf] text-[#00703a]' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-slate-500 whitespace-nowrap">Vehicle</span>
                {/* Wraps: the type list is open-ended now, so this row cannot
                    assume it fits on one line. */}
                <div className="flex flex-wrap items-center gap-1">
                  {['All', ...fleetTypeOptions].map(opt => (
                    <button
                      key={opt}
                      onClick={() => setWindowTypeFilter(opt)}
                      className={`px-2.5 py-1.5 rounded-lg text-[13px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                        windowTypeFilter === opt ? 'bg-[#EAF3F2] border-[#c2dccf] text-[#00703a]' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {snapshotLoading ? (
              <div className="px-5 py-10 text-center text-slate-500 text-sm">Working out the day…</div>
            ) : (
              <div className="px-5 py-4">
                <p className="text-[13px] text-slate-600 mb-3 tabular-nums">
                  {windowMatchCount} of {windowResults.length} vehicle{windowResults.length === 1 ? '' : 's'} {windowMatchCount === 1 ? 'has' : 'have'} an open window of at least {windowLengthLabel} on {selectedDateShort}
                </p>
                <div className="divide-y divide-slate-100 border border-slate-200 rounded-[12px] overflow-hidden">
                  {windowResults.length === 0 ? (
                    <p className="px-4 py-6 text-center text-slate-500 text-sm">No vehicles of this type.</p>
                  ) : windowResults.map(r => (
                    <div key={r.vehicle_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
                      <div className="min-w-0">
                        <p className="text-[14.5px] font-bold text-slate-900">{r.plate_number}</p>
                        <TypeTag type={r.vehicle_type} />
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2 min-w-0">
                        {r.outOfService ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-[12.5px] font-semibold">
                            <Wrench size={12} /> {r.vehicle_status} — not bookable
                          </span>
                        ) : r.gaps.length > 0 ? (
                          r.gaps.map((g, i) => (
                            <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#c2dccf] bg-[#EAF3F2] text-[#00703a] text-[12.5px] font-semibold tabular-nums whitespace-nowrap">
                              <CheckCircle2 size={12} /> {g.label}
                            </span>
                          ))
                        ) : (
                          // Says WHY, not just "no". A row that only reports a
                          // negative leaves the manager to open another tab to
                          // find out what is in the way.
                          <span className="text-[13px] text-slate-600 text-right [text-wrap:pretty]">
                            Committed {r.busyFrom ? fmtClock(r.busyFrom) : ''} – {r.busyTo ? fmtClock(r.busyTo) : ''} across {r.trips.length} trip{r.trips.length === 1 ? '' : 's'} — no gap of {windowLengthLabel}.
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ================= VEHICLES (FLEET) ================= */}
        {activeTableTab === 'fleet' && (
          <>
            <div className={`px-5 py-3.5 border-b flex flex-wrap items-center gap-3 ${activeInventoryFilterCount > 0 ? 'bg-emerald-50/40 border-emerald-100' : 'border-slate-100'}`}>
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Search plate number..."
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${inventorySearch.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
                />
              </div>
              <Select
                value={inventoryTypeFilter}
                onChange={(e) => setInventoryTypeFilter(e.target.value)}
                className={`border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${inventoryTypeFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
              >
                <option value="All">All types</option>
                {fleetTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
              {activeInventoryFilterCount > 0 && (
                <button
                  onClick={() => { setInventorySearch(''); setInventoryTypeFilter('All'); }}
                  className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                >
                  Clear filters
                </button>
              )}
            </div>

            <div className="px-5 pb-2">
              <div className={`${FLEET_COLS} hidden min-[940px]:grid px-1 pt-3.5 pb-2.5 border-b border-[#eef2f6]`}>
                <span className={ZONE_HEAD}>Vehicle</span>
                <span className={ZONE_HEAD}>Status</span>
                <span className={ZONE_HEAD}>Next trip</span>
                <span className={`${ZONE_HEAD} text-right`}>Committed trips</span>
              </div>

              {isLoading ? (
                <p className="py-8 text-center text-slate-500 text-sm">Loading fleet…</p>
              ) : fleetRows.length === 0 ? (
                <p className="py-8 text-center text-slate-500 text-sm">No vehicles match your search or filter.</p>
              ) : fleetRows.map(({ v, committedCount, onRoad, next }) => {
                const outOfService = v.vehicle_status !== 'Available';
                return (
                  <div key={v.vehicle_id} className={`${FLEET_COLS} items-center px-1 py-3.5 border-b border-[#f6f8fa] transition-colors hover:bg-[#fbfcfd] max-[940px]:grid-cols-1 max-[940px]:gap-3`}>
                    {/* ZONE A — which vehicle */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px] bg-slate-100 text-slate-500 shrink-0">
                        <VehicleTypeIcon type={v.vehicle_type} size={15} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[15px] font-bold text-slate-900 truncate">{v.plate_number}</p>
                        <TypeTag type={v.vehicle_type} />
                      </div>
                    </div>

                    {/* ZONE B — is it in service, and is it out right now */}
                    <div className="min-w-0">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-[12.5px] font-semibold whitespace-nowrap ${
                        outOfService
                          ? (v.vehicle_status === 'Maintenance' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-100 border-slate-300 text-slate-600')
                          : 'bg-[#EAF3F2] border-[#c2dccf] text-[#00703a]'
                      }`}>
                        {v.vehicle_status === 'Maintenance' ? RESOURCE_STATE.underMaintenance : v.vehicle_status}
                      </span>
                      {onRoad && (
                        <p className="text-[12.5px] font-semibold text-slate-600 mt-1">On the road now</p>
                      )}
                    </div>

                    {/* ZONE C — what it is doing next */}
                    <div className="min-w-0">
                      {onRoad ? (
                        <>
                          <p className="text-[13.5px] text-slate-800 truncate">
                            {onRoad.w.legLabel} · {onRoad.a.booking?.customer ? `${onRoad.a.booking.customer.first_name} ${onRoad.a.booking.customer.last_name}` : 'Unknown'}
                          </p>
                          <p className="text-[12.5px] text-slate-500 mt-0.5 tabular-nums">Out now · back {fmtClock(onRoad.w.end)}</p>
                        </>
                      ) : next ? (
                        <>
                          <p className="text-[13.5px] text-slate-800 truncate">
                            {next.w.legLabel} · {next.a.booking?.customer ? `${next.a.booking.customer.first_name} ${next.a.booking.customer.last_name}` : 'Unknown'}
                          </p>
                          <p className="text-[12.5px] text-slate-500 mt-0.5 tabular-nums">
                            Leaves {next.w.start.toDateString() === now.toDateString() ? 'today' : fmtDay(next.w.start)} {fmtClock(next.w.start)}
                          </p>
                        </>
                      ) : (
                        <p className="text-[13.5px] text-slate-500">Nothing scheduled</p>
                      )}
                    </div>

                    {/* ZONE D — how much is on it, and the row's actions */}
                    <div className="flex items-center justify-end gap-3 min-w-0 max-[940px]:justify-start">
                      <button
                        onClick={() => handleViewUsage(v)}
                        title="See every trip this vehicle has made"
                        className="text-right cursor-pointer group max-[940px]:text-left"
                      >
                        <span className={`block text-[19px] font-semibold leading-none tabular-nums ${committedCount > 0 ? 'text-slate-900' : 'text-slate-400'} group-hover:text-[#007038] transition-colors`}>{committedCount}</span>
                        <span className="block text-[11px] font-bold tracking-[0.06em] uppercase text-slate-500 mt-1">Committed</span>
                      </button>
                      <span className="flex items-center gap-0.5 shrink-0">
                        <IconBtn label="Edit plate, type or status" onClick={() => handleEditClick(v)} Icon={Edit} />
                        <IconBtn label="Flag as under maintenance or unavailable" onClick={() => handleFlagIssueClick(v)} Icon={Wrench} hover="amber" />
                        <IconBtn label="Delete vehicle" onClick={() => handleDeleteVehicle(v.vehicle_id)} Icon={Trash2} hover="red" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ================= TRIPS ================= */}
        {activeTableTab === 'trips' && (
          <>
            <div className={`px-5 py-3.5 border-b space-y-3 ${activeAssignmentFilterCount > 0 ? 'bg-emerald-50/40 border-emerald-100' : 'border-slate-100'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    placeholder="Search by customer, booking ref, venue, or plate..."
                    value={assignmentSearchTerm}
                    onChange={(e) => setAssignmentSearchTerm(e.target.value)}
                    className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${assignmentSearchTerm.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
                  />
                </div>
                <div className="flex items-center gap-1">
                  {['All', 'Overdue', 'Today', 'Upcoming'].map(section => (
                    <button
                      key={section}
                      onClick={() => setAssignmentSectionFilter(section)}
                      className={`px-2.5 py-1.5 rounded-lg text-[13px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                        assignmentSectionFilter === section
                          ? (section === 'Overdue' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-[#EAF3F2] border-[#c2dccf] text-[#00703a]')
                          : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {section}{section !== 'All' && ` (${assignmentSectionCounts[section]})`}
                    </button>
                  ))}
                </div>
                <span className="text-[13px] font-semibold text-slate-500 shrink-0 tabular-nums">
                  {filteredTripCount} of {activeAssignmentRows.length} trip{activeAssignmentRows.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <DateRangeFilter
                  preset={assignmentDatePreset}
                  customStart={assignmentDateCustomStart}
                  customEnd={assignmentDateCustomEnd}
                  rangeStart={assignmentRangeStart}
                  rangeEnd={assignmentRangeEnd}
                  onPresetChange={setAssignmentDatePreset}
                  onCustomStartChange={setAssignmentDateCustomStart}
                  onCustomEndChange={setAssignmentDateCustomEnd}
                  onClear={() => { setAssignmentDatePreset(DEFAULT_DATE_PRESET); setAssignmentDateCustomStart(''); setAssignmentDateCustomEnd(''); }}
                />
                <div className="flex items-center gap-2">
                  <Select
                    value={`${assignmentSort.field}:${assignmentSort.direction}`}
                    onChange={(e) => { const [field, direction] = e.target.value.split(':'); setAssignmentSort({ field, direction }); }}
                    className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    title="Sort order"
                  >
                    <option value="priority:asc">Sort: Overdue first (default)</option>
                    <option value="date:asc">Sort: Event date, oldest first</option>
                    <option value="date:desc">Sort: Event date, newest first</option>
                    <option value="customer:asc">Sort: Customer, A-Z</option>
                    <option value="customer:desc">Sort: Customer, Z-A</option>
                  </Select>
                  {activeAssignmentFilterCount > 0 && (
                    <button
                      onClick={() => { setAssignmentSearchTerm(''); setAssignmentSectionFilter('All'); setAssignmentDatePreset(DEFAULT_DATE_PRESET); setAssignmentDateCustomStart(''); setAssignmentDateCustomEnd(''); }}
                      className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 space-y-3 max-h-[36rem] overflow-y-auto">
              {isLoading ? (
                <p className="py-6 text-center text-slate-500 text-sm">Loading trips…</p>
              ) : assignmentGroups.length === 0 ? (
                <p className="py-6 text-center text-slate-500 text-sm">Nothing is out. Every trip has been marked back at base.</p>
              ) : sortedFilteredAssignmentGroups.length === 0 ? (
                <p className="py-6 text-center text-slate-500 text-sm">No trips match your search or filter.</p>
              ) : sortedFilteredAssignmentGroups.map(group => {
                const ref = group.booking ? getBookingRef(group.booking) : 'Unknown';
                const customerName = group.booking?.customer ? `${group.booking.customer.first_name} ${group.booking.customer.last_name}` : 'Unknown';
                const vehicleCount = countDistinct(group.items, 'vehicle_id');
                return (
                  <div key={group.booking_id} className={`rounded-[12px] border overflow-hidden ${group.isOverdue ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
                      <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                        <span className="text-[15px] font-bold text-slate-900">{customerName}</span>
                        {group.isOverdue ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-red-200 bg-red-50 text-red-700 text-[12.5px] font-semibold">
                            <AlertTriangle size={12} /> Overdue
                          </span>
                        ) : group.isToday ? (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-[#c2dccf] bg-[#EAF3F2] text-[#00703a] text-[12.5px] font-semibold">Today</span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-slate-200 bg-slate-100 text-slate-600 text-[12.5px] font-semibold">Upcoming</span>
                        )}
                        <span className="text-[12.5px] text-slate-500">{group.booking?.booking_type === 'Short Order' ? 'Short order' : 'Package'}</span>
                        {group.booking?.venue && (
                          <span className="text-[12.5px] text-slate-500 flex items-center gap-1 min-w-0"><MapPin size={11} className="shrink-0" /> <span className="truncate">{group.booking.venue}</span></span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-[13px] text-slate-500 tabular-nums whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => goToBookingDetails(group.booking_id, group.booking?.booking_type)}
                            className="font-semibold text-[#007038] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                            title="View full booking details"
                          >
                            {ref} <ExternalLink size={11} />
                          </button>
                          {group.eventDate && ` · event ${fmtDay(group.eventDate)}, ${fmtClock(group.eventDate)}`}
                        </span>
                        {vehicleCount > 1 && (
                          <button
                            type="button"
                            onClick={() => handleReturnAllForBooking(group.booking_id, group.items.length)}
                            className={group.canReturn
                              ? 'text-[13px] font-semibold text-slate-600 hover:text-[#007038] flex items-center gap-1.5 border border-slate-300 hover:border-[#c9dfd4] rounded-[9px] px-3 py-1.5 transition-colors cursor-pointer'
                              : 'text-[13px] font-semibold text-slate-400 flex items-center gap-1.5 border border-slate-200 rounded-[9px] px-3 py-1.5 cursor-not-allowed'}
                            title={group.canReturn ? undefined : `Locked — returns open ${PICKUP_GRACE_HOURS} hours after the event, at ${formatReturnOpensAt(group.returnOpensAt)}`}
                          >
                            {group.canReturn ? <Undo2 size={13} /> : <Lock size={13} />} All back at base
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Sorted ascending on purpose. The query orders
                        dispatch_datetime DESCENDING, which listed the
                        collection run above the setup run that has to happen
                        first. */}
                    <div className="divide-y divide-slate-100">
                      {[...group.items]
                        .sort((x, y) => new Date(x.dispatch_datetime || 0) - new Date(y.dispatch_datetime || 0))
                        .map(a => {
                          const win = getDispatchWindow(a, group.booking);
                          const state = getTripState(a, group.booking, now);
                          return (
                            <div key={a.assignment_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                              <div className="flex flex-wrap items-center gap-2.5 min-w-0">
                                {win ? <LegChip legLabel={win.legLabel} /> : (
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-[12.5px] font-semibold">No event date</span>
                                )}
                                <span className="text-[14px] font-bold text-slate-900">{a.vehicle?.plate_number || 'Unknown'}</span>
                                <span className="text-[13px] text-slate-600 tabular-nums">
                                  {win ? `${fmtDay(win.start)}, ${fmtSpan(win)}` : (a.dispatch_datetime ? `Leaves ${fmtDay(new Date(a.dispatch_datetime))}, ${fmtClock(new Date(a.dispatch_datetime))}` : 'Not scheduled')}
                                </span>
                                {isAssignmentOutsideBounds(a, group.booking) && <OutOfBoundsChip />}
                              </div>
                              <div className="flex items-center gap-2.5 shrink-0">
                                <StateChip state={state}>
                                  {state.key === 'overdue' && group.eventDate
                                    ? `Overdue ${daysOverdue(group.eventDate) === 0 ? 'today' : `${daysOverdue(group.eventDate)} day${daysOverdue(group.eventDate) === 1 ? '' : 's'}`}`
                                    : null}
                                </StateChip>
                                <button
                                  onClick={() => handleReturnVehicle(a.assignment_id)}
                                  className={group.canReturn
                                    ? 'text-[13px] font-semibold text-slate-600 hover:text-[#007038] flex items-center gap-1.5 border border-slate-300 hover:border-[#c9dfd4] rounded-[9px] px-3 py-1.5 transition-colors cursor-pointer'
                                    : 'text-[13px] font-semibold text-slate-400 flex items-center gap-1.5 border border-slate-200 rounded-[9px] px-3 py-1.5 cursor-not-allowed'}
                                  title={group.canReturn ? 'Mark this vehicle back at base' : `Locked — returns open ${PICKUP_GRACE_HOURS} hours after the event, at ${formatReturnOpensAt(group.returnOpensAt)}`}
                                >
                                  {group.canReturn ? <Undo2 size={13} /> : <Lock size={13} />} Back at base
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ================= HISTORY ================= */}
        {activeTableTab === 'history' && (
          <>
            <div className={`px-5 py-3.5 border-b space-y-3 ${activeHistoryFilterCount > 0 ? 'bg-emerald-50/40 border-emerald-100' : 'border-slate-100'}`}>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    placeholder="Search by plate, customer, booking ref, or venue..."
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${historySearch.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
                  />
                </div>
                <div className="flex items-center gap-1">
                  {[
                    { key: 'All', label: 'All' },
                    { key: 'committed', label: TRIP_STATE.committed },
                    { key: 'on_road', label: TRIP_STATE.onRoad },
                    { key: 'overdue', label: TRIP_STATE.overdue },
                    { key: 'back', label: TRIP_STATE.back },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setHistoryStatusFilter(opt.key)}
                      className={`px-2.5 py-1.5 rounded-lg text-[13px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                        historyStatusFilter === opt.key
                          ? (opt.key === 'overdue' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-[#EAF3F2] border-[#c2dccf] text-[#00703a]')
                          : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <DateRangeFilter
                  preset={historyDatePreset}
                  customStart={historyDateCustomStart}
                  customEnd={historyDateCustomEnd}
                  rangeStart={historyRangeStart}
                  rangeEnd={historyRangeEnd}
                  onPresetChange={setHistoryDatePreset}
                  onCustomStartChange={setHistoryDateCustomStart}
                  onCustomEndChange={setHistoryDateCustomEnd}
                  onClear={() => { setHistoryDatePreset(DEFAULT_DATE_PRESET); setHistoryDateCustomStart(''); setHistoryDateCustomEnd(''); }}
                />
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-semibold text-slate-500 tabular-nums whitespace-nowrap">
                    {historyRows.length} of {assignments.length} dispatch record{assignments.length === 1 ? '' : 's'}
                  </span>
                  {activeHistoryFilterCount > 0 && (
                    <button
                      onClick={() => { setHistorySearch(''); setHistoryStatusFilter('All'); setHistoryDatePreset(DEFAULT_DATE_PRESET); setHistoryDateCustomStart(''); setHistoryDateCustomEnd(''); }}
                      className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="px-5 pb-2 max-h-[36rem] overflow-y-auto">
              <div className={`${HIST_COLS} hidden min-[940px]:grid px-1 pt-3.5 pb-2.5 border-b border-[#eef2f6] sticky top-0 bg-white z-10`}>
                <span className={ZONE_HEAD}>Booking</span>
                <span className={ZONE_HEAD}>Vehicle</span>
                <span className={ZONE_HEAD}>Leg &amp; window</span>
                <span className={`${ZONE_HEAD} text-right`}>State</span>
              </div>

              {isLoading ? (
                <p className="py-8 text-center text-slate-500 text-sm">Loading history…</p>
              ) : historyRows.length === 0 ? (
                <p className="py-8 text-center text-slate-500 text-sm">No dispatch records match your search or filter.</p>
              ) : historyRows.map(({ a, w, state }) => {
                const ref = a.booking ? getBookingRef(a.booking) : 'Unknown';
                const customerName = a.booking?.customer ? `${a.booking.customer.first_name} ${a.booking.customer.last_name}` : 'Unknown';
                return (
                  <div key={a.assignment_id} className={`${HIST_COLS} items-start px-1 py-3.5 border-b border-[#f6f8fa] transition-colors hover:bg-[#fbfcfd] max-[940px]:grid-cols-1 max-[940px]:gap-3`}>
                    {/* ZONE A — whose booking */}
                    <div className="min-w-0">
                      <p className="text-[14.5px] font-bold text-slate-900 [text-wrap:pretty]">{customerName}</p>
                      <p className="text-[13px] text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-2 tabular-nums">
                        {a.booking ? (
                          <button
                            onClick={() => goToBookingDetails(a.booking.booking_id, a.booking.booking_type)}
                            className="font-semibold text-[#007038] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                            title="View full booking details"
                          >
                            {ref} <ExternalLink size={11} />
                          </button>
                        ) : (
                          <span className="font-semibold">{ref}</span>
                        )}
                        {a.booking?.event_datetime && <span>· event {fmtDay(new Date(a.booking.event_datetime))}</span>}
                      </p>
                    </div>

                    {/* ZONE B — which vehicle */}
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-slate-800 truncate">{a.vehicle?.plate_number || 'Unknown'}</p>
                      {a.vehicle?.vehicle_type && <TypeTag type={a.vehicle.vehicle_type} />}
                    </div>

                    {/* ZONE C — which run, and when. The leg is what stops
                        two rows on one booking reading as a duplicate. */}
                    <div className="min-w-0">
                      {w ? (
                        <>
                          <LegChip legLabel={w.legLabel} completed={a.assignment_status === 'Completed'} />
                          <p className="text-[13px] text-slate-600 mt-1.5 tabular-nums">{fmtDay(w.start)}, {fmtSpan(w)}</p>
                          {isAssignmentOutsideBounds(a, a.booking) && (
                            <p className="mt-1.5"><OutOfBoundsChip /></p>
                          )}
                        </>
                      ) : (
                        <p className="text-[13px] text-slate-500">
                          No event date{a.dispatch_datetime ? ` · dispatched ${fmtDay(new Date(a.dispatch_datetime))}` : ''}
                        </p>
                      )}
                    </div>

                    {/* ZONE D — where it ended up */}
                    <div className="flex justify-end max-[940px]:justify-start">
                      <StateChip state={state} />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* ========================================================= */}
      {/* MODALS */}
      {/* ========================================================= */}

      {/* EVENTS ON DATE MODAL */}
      {/* AWAITING VEHICLE — the work queue behind the header counter. Date
          order, because the nearest event is the one that runs out of time
          first, and one click from each row into the assign modal. */}
      {isNeedsVehicleModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Awaiting Vehicle</h2>
                <p className="text-[13px] text-slate-600 mt-0.5">
                  {needsVehicleBookings.length} upcoming event{needsVehicleBookings.length === 1 ? '' : 's'} with nothing dispatched to carry {needsVehicleBookings.length === 1 ? 'it' : 'them'}
                </p>
              </div>
              <button onClick={() => setIsNeedsVehicleModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"><X size={18} /></button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
              {needsVehicleBookings.map(b => {
                const when = new Date(b.event_datetime);
                const days = Math.ceil((when - new Date()) / (24 * 60 * 60 * 1000));
                return (
                  <div key={b.booking_id} className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 rounded-lg px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown'}
                        <span className="ml-2 text-[12.5px] font-semibold text-[#007038] tabular-nums">{getBookingRef(b)}</span>
                      </p>
                      <p className="text-[13px] text-slate-600 mt-0.5 flex flex-wrap items-center gap-x-2">
                        <span className="tabular-nums">{when.toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                        <span className={days <= 2 ? 'font-semibold text-red-700' : ''}>
                          {days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`}
                        </span>
                        {b.venue && <span className="flex items-center gap-1"><MapPin size={11} /> {b.venue}</span>}
                      </p>
                    </div>
                    <button
                      onClick={() => planDispatchFor(b.booking_id)}
                      className="shrink-0 bg-[#008A45] hover:bg-[#007038] text-white text-[13px] font-semibold px-3.5 py-2 rounded-[9px] transition-colors cursor-pointer"
                    >
                      Plan dispatch
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      {isEventsModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Events on {selectedDateLabel}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{snapshot.eventsOnDate.length} active booking(s)</p>
              </div>
              <button onClick={() => setIsEventsModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"><X size={18} /></button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-3">
              {snapshot.eventsOnDate.length === 0 ? (
                <p className="text-sm text-slate-500 italic text-center py-8">No events on this date.</p>
              ) : (
                snapshot.eventsOnDate.map(ev => {
                  const eventVehicles = eventVehicleMap[ev.booking_id] || [];
                  return (
                    <div key={ev.booking_id} className="border border-slate-200 rounded-lg overflow-hidden">
                      <div className="p-3 flex items-center justify-between bg-slate-50">
                        <div>
                          <p className="font-bold text-slate-900 text-sm">{ev.customerName}</p>
                          <p className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={11} /> {ev.venue || 'No venue'} · <Users size={11} /> {ev.pax_count || 0} pax</p>
                        </div>
                        <div className="text-right text-xs">
                          <button
                            onClick={() => goToBookingDetails(ev.booking_id, ev.booking_type)}
                            className="font-mono font-bold text-[#008A45] hover:underline flex items-center gap-1 cursor-pointer"
                            title="View full booking details"
                          >
                            {ev.ref} <ExternalLink size={11} />
                          </button>
                          <p className="text-slate-500">{new Date(ev.event_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="text-xs font-bold text-slate-600 mb-1.5">Vehicles for this event</p>
                        {eventVehicles.length === 0 ? (
                          <p className="text-[13px] text-slate-500">No vehicles assigned to this booking yet.</p>
                        ) : (
                          <div className="space-y-1">
                            {eventVehicles.map(vi => {
                              const viStatus = getAssignmentStatus(vi.completed, ev.event_datetime);
                              return (
                                <div key={vi.assignment_id} className="flex items-center justify-between text-xs">
                                  <span className="text-slate-700 font-medium">{vi.plate_number} {vi.dispatch_datetime ? `· dispatch ${new Date(vi.dispatch_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold ${vi.completed ? 'bg-slate-100 text-slate-500' : viStatus.key === 'in_use' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                                    {vi.completed ? <><CheckCircle2 size={11} /> Returned</> : viStatus.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* AVAILABILITY ROW DETAIL MODAL */}
      {isAvailabilityDetailOpen && availabilityDetailVehicle && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{availabilityDetailVehicle.plate_number}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{getVehicleAvailabilityStatus(availabilityDetailVehicle).label} on {selectedDateLabel}</p>
              </div>
              <button onClick={() => setIsAvailabilityDetailOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"><X size={18} /></button>
            </div>
            <div className="p-4">
              {availabilityDetailVehicle.assignments.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-slate-500">
                    {availabilityDetailVehicle.assignments.length} trip{availabilityDetailVehicle.assignments.length !== 1 ? 's' : ''} on this date, in order
                  </p>
                  {availabilityDetailVehicle.assignments.map((trip) => {
                    const { canReturn: detailCanReturn, opensAt: detailOpensAt } = getReturnAvailability(trip.event_datetime);
                    return (
                      <div key={trip.assignment_id} className={`border rounded-lg p-3 space-y-2 ${trip.completed ? 'border-slate-200 bg-slate-50' : 'border-slate-200'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-bold text-slate-900 text-sm">{trip.customerName}</p>
                          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#CBDEDD]/60 border border-[#a3c7c4] text-slate-800">{trip.tripType}</span>
                        </div>
                        <p className="text-xs text-slate-500">{trip.venue || 'No venue'}</p>
                        <button
                          onClick={() => goToBookingDetails(trip.booking_id, trip.booking_type)}
                          className="font-mono text-xs font-bold text-[#008A45] hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          {trip.ref} <ExternalLink size={11} />
                        </button>
                        <p className="text-xs text-slate-500">On the road {formatTripWindow(trip.window)}</p>
                        <div className="pt-1">
                          {trip.completed ? (
                            <span className="text-xs font-semibold text-slate-400 flex items-center gap-1"><CheckCircle2 size={13} /> Returned</span>
                          ) : (
                            <button
                              onClick={async () => { await handleReturnVehicle(trip.assignment_id); setIsAvailabilityDetailOpen(false); }}
                              className={detailCanReturn
                                ? 'text-blue-500 hover:text-blue-700 transition-colors flex items-center gap-1 text-xs font-medium'
                                : 'text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1 text-xs font-medium'}
                              title={detailCanReturn ? undefined : `Locked — returns open ${PICKUP_GRACE_HOURS} hours after the event, at ${formatReturnOpensAt(detailOpensAt)}`}
                            >
                              {detailCanReturn ? <Undo2 size={13} /> : <Lock size={13} />} Return
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-500 italic text-center py-6">
                  {availabilityDetailVehicle.vehicle_status === 'Available' ? 'Open all day — nothing committed.' : `Currently marked ${availabilityDetailVehicle.vehicle_status}.`}
                </p>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ADD VEHICLE MODAL */}
      {isAddModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Add New Vehicle</h2>
                <p className="text-xs text-slate-500">Add a vehicle to your fleet</p>
              </div>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddVehicle} className="p-6 space-y-5 bg-[#fbfcfd] text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Plate Number *</label>
                <input
                  type="text"
                  name="plate_number"
                  placeholder="e.g. ABC 1234"
                  value={newVehicleForm.plate_number}
                  onChange={handleNewVehicleChange}
                  className={errorInputClass(!!addFieldErrors.plate_number, 'w-full border rounded-lg p-2.5 text-sm bg-white focus:ring-2 outline-none')}
                  required
                />
                {addFieldErrors.plate_number ? (
                  <p className="text-xs text-red-600 font-semibold mt-1">{addFieldErrors.plate_number}</p>
                ) : (
                  <p className="text-xs text-slate-400 mt-1">Minimum 3 characters, no leading/trailing spaces.</p>
                )}
              </div>
              <VehicleTypeField
                required
                value={newVehicleForm.vehicle_type}
                options={fleetTypeOptions}
                isCustom={addTypeIsCustom}
                onSelect={handleAddTypeSelect}
                onCustomChange={handleAddTypeText}
                error={addFieldErrors.vehicle_type}
              />
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setIsAddModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50">
                  {isSubmitting ? 'Adding...' : 'Add Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* EDIT VEHICLE MODAL */}
      {isEditModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Edit Vehicle</h2>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"><X size={18} /></button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 space-y-5 bg-[#fbfcfd] text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Plate Number *</label>
                <input type="text" name="plate_number" value={editVehicleForm.plate_number} onChange={handleEditVehicleChange} className={errorInputClass(!!editFieldErrors.plate_number, 'w-full border rounded-lg p-2.5 text-sm bg-white focus:ring-2 outline-none')} required />
                {editFieldErrors.plate_number && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.plate_number}</p>}
              </div>
              <VehicleTypeField
                value={editVehicleForm.vehicle_type}
                options={fleetTypeOptions}
                isCustom={editTypeIsCustom}
                onSelect={handleEditTypeSelect}
                onCustomChange={handleEditTypeText}
                error={editFieldErrors.vehicle_type}
              />
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Base Status</label>
                <Select
                  name="vehicle_status"
                  value={editVehicleForm.vehicle_status}
                  onChange={handleEditVehicleChange}
                  className={errorInputClass(!!editFieldErrors.vehicle_status, 'w-full border rounded-lg p-2.5 text-sm bg-white focus:ring-2 outline-none')}
                >
                  <option value="Available">Available</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Unavailable">Unavailable</option>
                </Select>
                {editFieldErrors.vehicle_status ? (
                  <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.vehicle_status}</p>
                ) : (
                  <p className="text-xs text-slate-400 mt-1">Base status overrides auto-status when set to Maintenance or Unavailable.</p>
                )}
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* FLAG ISSUE MODAL — quick shortcut to mark Maintenance/Unavailable */}
      {isFlagIssueModalOpen && flagIssueVehicle && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                  <Wrench size={15} className="text-amber-700" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Flag an issue</h2>
                  <p className="text-xs text-slate-500">{flagIssueVehicle.plate_number}</p>
                </div>
              </div>
              <button onClick={() => setIsFlagIssueModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"><X size={18} /></button>
            </div>
            <form onSubmit={handleFlagIssueSubmit} className="p-6 space-y-4 bg-[#fbfcfd] text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Status</label>
                <Select
                  value={flagIssueStatus}
                  onChange={(e) => { setFlagIssueStatus(e.target.value); setFlagIssueError(''); }}
                  className={errorInputClass(!!flagIssueError, 'w-full border rounded-lg p-2.5 text-sm bg-white focus:ring-2 outline-none')}
                >
                  <option value="Available">Available</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Unavailable">Unavailable</option>
                </Select>
                {flagIssueError && <p className="text-xs text-red-600 font-semibold mt-1">{flagIssueError}</p>}
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setIsFlagIssueModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50">
                  {isSubmitting ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ASSIGN VEHICLE MODAL - with Searchable Booking Dropdown + vehicle picker */}
      {isAssignModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Assign Vehicles</h2>
                <p className="text-xs text-slate-500">Deploy one or more vehicles to an event</p>
              </div>
              <button
                onClick={() => { setIsAssignModalOpen(false); setSelectedVehicleIds([]); setBookingSearchTerm(''); setShowBookingDropdown(false); setVehiclePickerSearch(''); }}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAssignSubmit} className="p-6 overflow-y-auto space-y-5 bg-[#fbfcfd] text-left">
              {/* Booking Selection - Searchable Dropdown */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Select Booking</label>
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      type="text"
                      placeholder="Search by customer name or booking ref..."
                      value={bookingSearchTerm}
                      onChange={(e) => { setBookingSearchTerm(e.target.value); setShowBookingDropdown(true); }}
                      onFocus={() => setShowBookingDropdown(true)}
                      className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                    />
                  </div>
                  {showBookingDropdown && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {hiddenPickupCount > 0 && (
                        <div className="px-4 py-2 text-[12px] text-amber-800 bg-amber-50 border-b border-amber-200 flex items-start gap-1.5">
                          <PackageIcon size={12} className="mt-0.5 shrink-0" />
                          <span>
                            {hiddenPickupCount} customer pickup{hiddenPickupCount === 1 ? '' : 's'} hidden — nothing is driven anywhere for those.
                            Change the order&apos;s Service Method to Delivery if one needs a vehicle.
                          </span>
                        </div>
                      )}
                      {filteredBookings.length === 0 ? (
                        <div className="p-3 text-sm text-slate-500 text-center">
                          {hiddenPickupCount > 0 ? 'No bookings here need a vehicle.' : 'No bookings found.'}
                        </div>
                      ) : (
                        filteredBookings.map((b) => {
                          const ref = getBookingRef(b);
                          const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
                          const eventDate = b.event_datetime ? new Date(b.event_datetime).toLocaleDateString() : 'No date';
                          const isShortOrder = b.booking_type === 'Short Order';
                          return (
                            <button
                              key={b.booking_id}
                              type="button"
                              onClick={() => handleBookingSelect(b.booking_id)}
                              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-slate-800">{ref}</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isShortOrder ? 'bg-sky-100 text-sky-700 border border-sky-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                                  {isShortOrder ? 'Short Order' : 'Package'}
                                </span>
                              </div>
                              <div className="text-sm font-medium text-slate-900">{customerName}</div>
                              <div className="text-xs text-slate-500">{eventDate} · {b.venue || 'No venue'}</div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">Type to search, then click a booking to select.</p>
              </div>

              {/* Booking Details Preview */}
              {selectedBooking && (
                <div className="bg-[#F8F9FA] border border-slate-200 rounded-lg p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-slate-900 text-sm">Booking Details</h4>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => goToBookingDetails(selectedBooking.booking_id, selectedBooking.booking_type)}
                        className="text-xs font-semibold text-[#008A45] hover:underline inline-flex items-center gap-1 cursor-pointer"
                        title="View full booking details"
                      >
                        View full details <ExternalLink size={11} />
                      </button>
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        selectedBooking.booking_status === 'Approved' ? 'bg-green-100 text-green-700 border border-green-200' :
                        selectedBooking.booking_status === 'Confirmed' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                        'bg-amber-100 text-amber-700 border border-amber-200'
                      }`}>
                        {selectedBooking.booking_status}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-2 col-span-2">
                      <Users size={14} className="text-slate-400" />
                      <span className="text-slate-600">Customer:</span>
                      <span className="font-semibold text-slate-900">
                        {selectedBooking.customer ? `${selectedBooking.customer.first_name} ${selectedBooking.customer.last_name}` : 'Unknown'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 col-span-2">
                      <span className="text-slate-600 font-medium">Reference:</span>
                      <span className="font-mono text-xs font-bold text-slate-800">{getBookingRef(selectedBooking)}</span>
                      <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${selectedBooking.booking_type === 'Short Order' ? 'bg-sky-100 text-sky-700 border border-sky-200' : 'bg-blue-100 text-blue-700 border border-blue-200'}`}>
                        {selectedBooking.booking_type || 'Package'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 col-span-2">
                      <Calendar size={14} className="text-slate-400" />
                      <span className="text-slate-600">Event Date:</span>
                      <span className="font-semibold text-slate-900">
                        {selectedBooking.event_datetime ? new Date(selectedBooking.event_datetime).toLocaleString() : 'N/A'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 col-span-2">
                      <MapPin size={14} className="text-slate-400" />
                      <span className="text-slate-600">Venue:</span>
                      <span className="font-semibold text-slate-900">{selectedBooking.venue || 'N/A'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-slate-400" />
                      <span className="text-slate-600">Pax:</span>
                      <span className="font-semibold text-slate-900">{selectedBooking.pax_count || 0}</span>
                    </div>
                    {selectedBooking.notes && (
                      <div className="col-span-2 text-xs text-slate-500 border-t border-slate-200 pt-2 mt-1">
                        <span className="font-medium text-slate-600">Notes:</span> {selectedBooking.notes}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Vehicle Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Select Vehicles</label>
                <div className="relative mb-2">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                  <input
                    type="text"
                    placeholder="Search plate number..."
                    value={vehiclePickerSearch}
                    onChange={(e) => setVehiclePickerSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                  />
                </div>
                <div className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto p-2 bg-slate-50">
                  {vehicles.filter(v => v.vehicle_status === 'Available' && v.plate_number.toLowerCase().includes(vehiclePickerSearch.toLowerCase())).length === 0 ? (
                    <p className="text-sm text-slate-500 italic p-2">No available vehicles match your search.</p>
                  ) : (
                    vehicles
                      .filter(v => v.vehicle_status === 'Available' && v.plate_number.toLowerCase().includes(vehiclePickerSearch.toLowerCase()))
                      .map((v) => {
                        const clashingTrip = conflictingTripFor(v.vehicle_id, selectedBooking, assignForm.dispatch_datetime, assignLeg);
                        const alreadyAssigned = !!clashingTrip;
                        return (
                          <label key={v.vehicle_id} className={`flex items-center gap-2 p-2 hover:bg-slate-100 rounded cursor-pointer ${alreadyAssigned ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <input
                              type="checkbox"
                              checked={selectedVehicleIds.includes(v.vehicle_id)}
                              onChange={() => toggleVehicleSelection(v.vehicle_id)}
                              disabled={alreadyAssigned}
                              className="w-4 h-4 text-[#008A45] focus:ring-[#008A45]"
                            />
                            <span className="text-sm font-medium text-slate-700">{v.plate_number}</span>
                            <span className="text-xs text-slate-500">({v.vehicle_type})</span>
                            {alreadyAssigned && <span className="text-xs text-red-500 ml-2">busy: {describeTrip(clashingTrip)}</span>}
                          </label>
                        );
                      })
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Selected: <span className="font-bold">{selectedVehicleIds.length}</span> vehicle{selectedVehicleIds.length !== 1 ? 's' : ''}
                </p>
              </div>

              {/* WHICH RUN — asked before the time, because it sets the
                  suggestion, the allowed range, and which vehicles count as
                  already taken. The leg is still DERIVED on read from
                  `dispatch >= event`; nothing new is stored. What this buys is
                  that getDispatchBounds then constrains the time so it can only
                  derive back to the leg that was picked. */}
              {selectedBooking && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Which run is this?</label>
                  <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 border border-slate-200 rounded-[10px]">
                    {[TRIP_LEG.setup, TRIP_LEG.pickup].map(legKey => (
                      <button
                        key={legKey}
                        type="button"
                        onClick={() => chooseAssignLeg(legKey)}
                        className={`px-3 py-2 rounded-[7px] text-[13.5px] font-semibold transition-colors cursor-pointer ${
                          assignLeg === legKey
                            ? 'bg-white text-[#007038] shadow-sm border border-[#c2dccf]'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {/* legLabelFor, never a hardcoded word — a short
                            order's outbound leg is a Delivery, not a setup. */}
                        {legLabelFor(getTripType(selectedBooking), legKey)}
                      </button>
                    ))}
                  </div>
                  {assignPreviewWindow && (
                    <p className="text-xs text-slate-600 mt-1.5 tabular-nums">
                      Leaves {fmtClock(assignPreviewWindow.start)} → back {fmtClock(assignPreviewWindow.end)}
                      {assignPreviewWindow.start.toDateString() !== assignPreviewWindow.end.toDateString() && ' the next day'}
                    </p>
                  )}
                </div>
              )}

              {/* Dispatch Date/Time */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Dispatch Date/Time (for all selected vehicles)</label>
                {/* min/max are LOCAL wall-clock strings, never ISO/UTC: the
                    insert below already warns that a zoneless value is read as
                    UTC and lands eight hours out, and getting the BOUNDS wrong
                    that way is the same bug in reverse. */}
                <input
                  type="datetime-local"
                  name="dispatch_datetime"
                  value={assignForm.dispatch_datetime}
                  min={assignBounds ? toDateTimeLocalValue(assignBounds.min) : undefined}
                  max={assignBounds ? toDateTimeLocalValue(assignBounds.max) : undefined}
                  onChange={handleAssignChange}
                  className={`w-full border rounded-lg p-2.5 text-sm font-medium text-slate-800 focus:ring-2 outline-none ${
                    assignInBounds
                      ? 'border-slate-300 focus:ring-[#008A45]/20 focus:border-[#008A45]'
                      : 'border-amber-400 bg-amber-50/50 focus:ring-amber-400/20 focus:border-amber-500'
                  }`}
                  required
                />
                {!assignInBounds && selectedBooking && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-1.5">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                    <span>{describeDispatchBounds(selectedBooking, assignLeg)}</span>
                  </p>
                )}
                {selectedBooking && selectedBooking.event_datetime && (() => {
                  const eventAt = new Date(selectedBooking.event_datetime);
                  const chosen = assignForm.dispatch_datetime ? new Date(assignForm.dispatch_datetime) : null;
                  const suggested = defaultDispatchFor(selectedBooking, assignLeg);
                  // Same minute as the suggestion (the field is minute-precision).
                  const isSuggested = !!(chosen && suggested)
                    && Math.abs(chosen.getTime() - suggested.getTime()) < 60 * 1000;
                  const describeGap = (from, to) => {
                    const mins = Math.round(Math.abs(to - from) / 60000);
                    const h = Math.floor(mins / 60), m = mins % 60;
                    const parts = [h ? `${h} hour${h === 1 ? '' : 's'}` : null, m ? `${m} min` : null].filter(Boolean);
                    return parts.length ? parts.join(' ') : 'less than a minute';
                  };
                  return (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs text-slate-500">
                      <Clock size={12} className="text-slate-400 shrink-0" />
                      <span>Event starts at: <span className="font-semibold text-slate-700">{eventAt.toLocaleString()}</span></span>
                      {chosen && !isNaN(chosen) && (
                        <>
                          <span>•</span>
                          {/* Was identical whether the time made sense or not:
                              it described BKG-110's +68h as placidly as a
                              correct +4h. */}
                          <span className={
                            !assignInBounds ? 'text-amber-700 font-semibold'
                              : isSuggested ? 'text-[#008A45] font-medium'
                              : 'text-slate-600 font-medium'
                          }>
                            {chosen <= eventAt
                              ? `Leaves ${describeGap(chosen, eventAt)} before the event`
                              : `Leaves ${describeGap(eventAt, chosen)} after the event starts`}
                            {isSuggested && ' (suggested)'}
                            {!assignInBounds && ' — outside the allowed window'}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })()}
                <p className="text-xs text-slate-400 mt-1">
                  All selected vehicles will have the same dispatch time. The suggestion allows travel plus setup, so setup finishes as the event starts.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => { setIsAssignModalOpen(false); setSelectedVehicleIds([]); setBookingSearchTerm(''); setShowBookingDropdown(false); setVehiclePickerSearch(''); }}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Assigning...' : `Assign ${selectedVehicleIds.length} Vehicle${selectedVehicleIds.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* USAGE MODAL */}
      {isUsageModalOpen && createPortal(
        <div className="fixed inset-0 z-[9999] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 shrink-0">
              <h3 className="text-lg font-bold text-slate-900">
                Vehicle Usage: {selectedVehicleForUsage?.plate_number}
              </h3>
              <button onClick={() => setIsUsageModalOpen(false)} className="text-slate-400 hover:text-slate-600 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {vehicleUsageAssignments.length === 0 ? (
                <p className="text-sm text-slate-500 italic text-center py-8">No usage records found.</p>
              ) : (
                <div className="space-y-3">
                  {vehicleUsageAssignments.map(record => {
                    const booking = record.booking;
                    const customerName = booking?.customer ? `${booking.customer.first_name} ${booking.customer.last_name}` : 'Unknown';
                    const bookingRef = booking?.booking_number ||
                      (booking?.booking_id ? (booking.booking_type === 'Short Order' ? 'SO' : 'BKG') + '-' + booking.booking_id.slice(0, 8) : 'N/A');
                    const isCompleted = record.assignment_status === 'Completed';
                    const status = getAssignmentStatus(isCompleted, booking?.event_datetime);
                    const win = getDispatchWindow(record, booking);
                    return (
                      <div key={record.assignment_id} className={`border rounded-lg p-3 flex justify-between items-center ${isCompleted ? 'bg-slate-50 border-slate-200' : status.key === 'in_use' ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div>
                          <p className="font-bold text-slate-900 text-sm">{customerName}</p>
                          <p className="text-xs text-slate-500">{booking?.venue || 'No venue'} · {booking?.event_datetime ? new Date(booking.event_datetime).toLocaleDateString() : 'N/A'}</p>
                          <p className="text-xs text-slate-500">
                            Booking: {bookingRef}
                            {win && <> · <span className="font-semibold text-slate-600">{win.legLabel}</span></>}
                            {' · '}{record.dispatch_datetime ? new Date(record.dispatch_datetime).toLocaleString() : 'N/A'}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${isCompleted ? 'bg-green-100 text-green-700' : status.key === 'in_use' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {isCompleted ? 'Returned' : status.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
