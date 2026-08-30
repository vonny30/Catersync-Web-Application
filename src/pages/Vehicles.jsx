// src/pages/Vehicles.jsx
import { useState, useEffect, useRef, Fragment } from 'react';
import Select from '../components/Select';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Plus, Edit, Trash2, X, ClipboardList, RefreshCw, Undo2,
  Calendar, MapPin, Users, Search, CalendarClock, LayoutGrid, AlertTriangle,
  ChevronRight, Wrench, CheckCircle2, History, ExternalLink, Lock,
  ArrowUpDown, ArrowUp, ArrowDown, Car, Truck, Clock,
} from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePasswordConfirm } from '../contexts/PasswordConfirmContext';
import { ACTIVE_BOOKING_STATUSES } from '../utils/bookingStatus';
import { errorInputClass } from '../utils/formErrors';
import {
  getDailyVehicleSnapshot, getDispatchWindow, tripsConflict, defaultSetupDispatch,
} from '../utils/vehicle';
import { fetchAllRows } from '../utils/fetchAllRows';
import { getAssignmentStatus, RESOURCE_STATE } from '../utils/statusLabels';
import DateRangeFilter from './Reports/DateRangeFilter';
import { getRangeBounds, isWithinRange } from './Reports/helpers';

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

const RETURN_GRACE_MS = 3 * 60 * 60 * 1000;
const getReturnAvailability = (eventDatetimeStr) => {
  if (!eventDatetimeStr) return { canReturn: true, opensAt: null };
  const opensAt = new Date(new Date(eventDatetimeStr).getTime() + RETURN_GRACE_MS);
  return { canReturn: Date.now() >= opensAt.getTime(), opensAt };
};
const formatReturnOpensAt = (opensAt) =>
  opensAt ? opensAt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';


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

  // --- Availability/Inventory/Assignments/History tab control ---
  const [activeTableTab, setActiveTableTab] = useState('availability'); // 'availability' | 'inventory' | 'assignments' | 'history'

  // --- Availability tab search/filter/sort ---
  const [availabilitySearch, setAvailabilitySearch] = useState('');
  const [availabilityTypeFilter, setAvailabilityTypeFilter] = useState('All'); // 'All' | 'Car' | 'Motorcycle'
  const [availabilityStatusFilter, setAvailabilityStatusFilter] = useState('All'); // 'All' | 'free' | 'deployed' | 'outofservice'
  const [availabilitySort, setAvailabilitySort] = useState({ field: null, direction: 'asc' });

  // --- Inventory tab search/filter/sort ---
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryTypeFilter, setInventoryTypeFilter] = useState('All');
  const [inventorySort, setInventorySort] = useState({ field: null, direction: 'asc' });

  // --- Active Assignments search/filter/sort — spans every active event
  // regardless of the date picker above, so it can grow long. ---
  const [assignmentSearchTerm, setAssignmentSearchTerm] = useState('');
  const [assignmentSectionFilter, setAssignmentSectionFilter] = useState('All'); // 'All' | 'Overdue' | 'Today' | 'Upcoming'
  const [assignmentDatePreset, setAssignmentDatePreset] = useState('All Time');
  const [assignmentDateCustomStart, setAssignmentDateCustomStart] = useState('');
  const [assignmentDateCustomEnd, setAssignmentDateCustomEnd] = useState('');
  const [assignmentSort, setAssignmentSort] = useState({ field: 'priority', direction: 'asc' }); // 'priority' | 'date' | 'customer'

  // --- History tab — full assignment log (Scheduled + Completed) ---
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('All'); // 'All' | 'Scheduled' | 'In Use' | 'Completed'
  const [historyDatePreset, setHistoryDatePreset] = useState('All Time');
  const [historyDateCustomStart, setHistoryDateCustomStart] = useState('');
  const [historyDateCustomEnd, setHistoryDateCustomEnd] = useState('');
  const [historySort, setHistorySort] = useState({ field: null, direction: 'desc' });
  // Which grouped history rows are expanded. A Set of booking ids.
  const [expandedHistoryGroups, setExpandedHistoryGroups] = useState(() => new Set());

  const makeToggleSort = (setter, defaultDirection = 'asc') => (field) => {
    setter(prev => prev.field === field
      ? { field, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { field, direction: defaultDirection });
  };
  const toggleAvailabilitySort = makeToggleSort(setAvailabilitySort);
  const toggleInventorySort = makeToggleSort(setInventorySort);
  const toggleHistorySort = makeToggleSort(setHistorySort, 'desc');

  // --- Events-on-date modal ---
  const [isEventsModalOpen, setIsEventsModalOpen] = useState(false);

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
  const [editVehicleForm, setEditVehicleForm] = useState({ vehicle_id: '', plate_number: '', vehicle_type: 'Car', vehicle_status: 'Available' });
  const [assignForm, setAssignForm] = useState({ booking_id: '', dispatch_datetime: '' });
  const [selectedVehicleIds, setSelectedVehicleIds] = useState([]);
  const [vehiclePickerSearch, setVehiclePickerSearch] = useState('');

  // --- Booking Search State for Assign Modal ---
  const [bookingSearchTerm, setBookingSearchTerm] = useState('');
  const [filteredBookings, setFilteredBookings] = useState([]);
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

  // --- Shared sortable-column-header renderer ---
  const renderSortHeader = (sortState, toggleFn, field, label, extraClass = '') => (
    <button
      onClick={() => toggleFn(field)}
      className={`flex items-center gap-1 font-bold hover:text-[#008A45] transition-colors cursor-pointer ${extraClass}`}
    >
      {label}
      {sortState.field === field ? (
        sortState.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
      ) : (
        <ArrowUpDown size={12} className="text-slate-400" />
      )}
    </button>
  );

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
      setFilteredBookings(bookingData);

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
  useEffect(() => {
    if (!bookingSearchTerm.trim()) {
      setFilteredBookings(bookings);
      return;
    }
    const term = bookingSearchTerm.toLowerCase();
    const filtered = bookings.filter(b => {
      const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}`.toLowerCase() : '';
      const ref = getBookingRef(b).toLowerCase();
      return customerName.includes(term) || ref.includes(term);
    });
    setFilteredBookings(filtered);
  }, [bookingSearchTerm, bookings]);

  const selectedBooking = bookings.find(b => b.booking_id === assignForm.booking_id);

  // --- When a booking is selected in the Assign modal ---
  const handleBookingSelect = (bookingId) => {
    const selected = bookings.find(b => b.booking_id === bookingId);
    if (!selected) return;
    setAssignForm(prev => ({ ...prev, booking_id: bookingId }));
    setBookingSearchTerm(`${getBookingRef(selected)} - ${selected.customer?.first_name || ''} ${selected.customer?.last_name || ''}`);
    setShowBookingDropdown(false);

    // Auto-suggest dispatch time: 2 hours before the event, clamped to now
    // if that would already be in the past.
    // Leave late enough to be efficient, early enough that the setup FINISHES
    // as the event starts - travel plus setup, from the trip profile. A flat
    // two hours was the same guess for a 40-minute delivery and a wedding.
    const suggested = defaultSetupDispatch(selected);
    if (suggested) {
      if (suggested < new Date()) suggested.setTime(Date.now());
      const offsetMs = suggested.getTime() - suggested.getTimezoneOffset() * 60 * 1000;
      setAssignForm(prev => ({ ...prev, dispatch_datetime: new Date(offsetMs).toISOString().slice(0, 16) }));
    }
    setSelectedVehicleIds([]);
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
    if (!newVehicleForm.vehicle_type) {
      toast.error('Please select a vehicle type.');
      setIsSubmitting(false);
      return;
    }

    try {
      const { error } = await supabase
        .from('vehicle')
        .insert([{
          plate_number: plate,
          vehicle_type: newVehicleForm.vehicle_type,
          vehicle_status: 'Available',
        }]);
      if (error) throw error;

      setIsAddModalOpen(false);
      setNewVehicleForm({ plate_number: '', vehicle_type: 'Car' });
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
  const conflictingTripFor = (vehicleId, booking, dispatchValue) => {
    if (!booking?.event_datetime) return null;
    const proposed = getDispatchWindow(
      { dispatch_datetime: dispatchValue || defaultSetupDispatch(booking)?.toISOString() },
      booking
    );
    if (!proposed) return null;
    return assignments.find(a => {
      if (a.vehicle_id !== vehicleId) return false;
      if (a.assignment_status === 'Completed') return false;
      if (a.booking?.booking_status === 'Rejected' || a.booking?.booking_status === 'Cancelled') return false;
      if (a.booking_id === booking.booking_id) return false; // its own other leg
      return tripsConflict(getDispatchWindow(a, a.booking), proposed);
    }) || null;
  };

  const describeTrip = (a) => {
    const ref = a.booking?.booking_number || 'another booking';
    const w = getDispatchWindow(a, a.booking);
    if (!w) return ref;
    const at = (d) => d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `${ref} (${w.leg.toLowerCase()} run, ${at(w.start)} to ${at(w.end)})`;
  };

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

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('vehicle')
        .update({
          plate_number: editVehicleForm.plate_number.trim(),
          vehicle_type: editVehicleForm.vehicle_type,
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

    // Overlapping RUNS block an assignment; another booking on the same day
    // does not. Same helper the picker uses.
    const conflicts = [];
    for (const vehicleId of selectedVehicleIds) {
      const clash = conflictingTripFor(vehicleId, selectedBooking, assignForm.dispatch_datetime);
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
      const inserts = selectedVehicleIds.map(vehicleId => ({
        vehicle_id: vehicleId,
        booking_id: assignForm.booking_id,
        dispatch_datetime: assignForm.dispatch_datetime,
        assignment_status: 'Scheduled',
      }));

      const { error } = await supabase.from('vehicle_assign').insert(inserts);
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
      toast.error(`Can't return this yet — available starting 3 hours after the event, at ${formatReturnOpensAt(opensAt)}.`);
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
      toast.error(`Can't return these yet — available starting 3 hours after the event, at ${formatReturnOpensAt(opensAt)}.`);
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

  const scrollToAssignments = () => {
    setActiveTableTab('assignments');
  };

  // --- Jump to the Availability tab (Vehicles deployed / free stat cards) —
  // switching the tab alone is invisible when it's already the active tab
  // (the default), which is why those cards read as "not clickable"; the
  // scroll + a status filter give a visible reaction every time. ---
  const availabilityPanelRef = useRef(null);
  const scrollToAvailability = (statusFilter) => {
    setActiveTableTab('availability');
    setAvailabilityStatusFilter(statusFilter);
    availabilityPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ============================================================
  // --- DATE-SCOPED STATS ---
  // ============================================================
  const totalFleet = vehicles.length;
  const eventsOnDateCount = snapshot.eventsOnDate.length;
  // A vehicle counts once however many trips it makes that day - these are
  // vehicle counts, not trip counts, and the card says "vehicles".
  const deployedCount = snapshot.vehicles.filter(v => v.assignments.length > 0).length;
  const freeCount = snapshot.vehicles.filter(v => v.vehicle_status === 'Available' && v.assignments.length === 0).length;

  // Live/always-current — not scoped to the date picker.
  const needsAttentionVehicles = vehicles
    .filter(v => v.vehicle_status === 'Maintenance' || v.vehicle_status === 'Unavailable')
    .sort((a, b) => a.plate_number.localeCompare(b.plate_number));

  const now = new Date();
  const overdueAssignments = assignments.filter(a =>
    a.assignment_status !== 'Completed' &&
    a.booking?.event_datetime && new Date(a.booking.event_datetime) < now &&
    a.booking?.booking_status !== 'Rejected' && a.booking?.booking_status !== 'Cancelled'
  );

  const selectedDateObj = new Date(`${selectedDate}T00:00:00`);
  const isSelectedToday = selectedDate === todayISO();
  const isSelectedTomorrow = selectedDate === tomorrowISO();
  const selectedDateLabel = selectedDateObj.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    + (isSelectedToday ? ' (Today)' : isSelectedTomorrow ? ' (Tomorrow)' : '');

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

  // ============================================================
  // --- AVAILABILITY TAB: status + sort ---
  // ============================================================
  const getVehicleAvailabilityStatus = (v) => {
    if (v.vehicle_status === 'Maintenance') return { key: 'maintenance', label: RESOURCE_STATE.underMaintenance, rank: 0, pillClass: 'bg-orange-100 border-orange-300 text-orange-700' };
    if (v.vehicle_status === 'Unavailable') return { key: 'unavailable', label: RESOURCE_STATE.unavailable, rank: 0, pillClass: 'bg-slate-200 border-slate-300 text-slate-600' };
    if (v.assignments.length > 0) return { key: 'deployed', label: RESOURCE_STATE.committed, rank: 1, pillClass: 'bg-amber-100 border-amber-300 text-amber-700' };
    return { key: 'free', label: RESOURCE_STATE.available, rank: 2, pillClass: 'bg-emerald-100 border-emerald-300 text-emerald-700' };
  };

  const sortedAvailabilityVehicles = [...snapshot.vehicles].sort((a, b) => {
    const rankA = getVehicleAvailabilityStatus(a).rank;
    const rankB = getVehicleAvailabilityStatus(b).rank;
    if (rankA !== rankB) return rankA - rankB;
    return a.plate_number.localeCompare(b.plate_number);
  });

  const availabilityStatusCounts = {
    outofservice: sortedAvailabilityVehicles.filter(v => ['maintenance', 'unavailable'].includes(getVehicleAvailabilityStatus(v).key)).length,
    deployed: sortedAvailabilityVehicles.filter(v => getVehicleAvailabilityStatus(v).key === 'deployed').length,
    free: sortedAvailabilityVehicles.filter(v => getVehicleAvailabilityStatus(v).key === 'free').length,
  };

  const filteredAvailabilityVehicles = sortedAvailabilityVehicles.filter(v => {
    if (availabilityTypeFilter !== 'All' && v.vehicle_type !== availabilityTypeFilter) return false;
    const statusKey = getVehicleAvailabilityStatus(v).key;
    if (availabilityStatusFilter === 'outofservice' && !['maintenance', 'unavailable'].includes(statusKey)) return false;
    if (availabilityStatusFilter !== 'All' && availabilityStatusFilter !== 'outofservice' && statusKey !== availabilityStatusFilter) return false;
    if (availabilitySearch) {
      const term = availabilitySearch.toLowerCase();
      if (!v.plate_number.toLowerCase().includes(term)) return false;
    }
    return true;
  });

  const activeAvailabilityFilterCount = (availabilitySearch.trim() ? 1 : 0) + (availabilityTypeFilter !== 'All' ? 1 : 0) + (availabilityStatusFilter !== 'All' ? 1 : 0);

  const sortedFilteredAvailabilityVehicles = availabilitySort.field === 'plate'
    ? [...filteredAvailabilityVehicles].sort((a, b) => {
        const result = a.plate_number.localeCompare(b.plate_number);
        return availabilitySort.direction === 'asc' ? result : -result;
      })
    : filteredAvailabilityVehicles;

  // ============================================================
  // --- DAY TIMELINE (Availability tab) ---
  // ============================================================
  // The table can express one trip per vehicle; the window model allows
  // several. Positioning each dispatch as a block on a fixed day scale is what
  // makes "busy twice, free in between" visible without arithmetic.
  //
  // The scale is a fixed working window rather than the widest trip of the
  // day, so blocks sit in the same place from one date to the next — a bar
  // that rescales itself cannot be compared against yesterday's.
  const TIMELINE_START_HOUR = 4;
  const TIMELINE_END_HOUR = 23;
  const timelineTicks = (() => {
    const ticks = [];
    const span = TIMELINE_END_HOUR - TIMELINE_START_HOUR;
    for (let h = TIMELINE_START_HOUR; h <= TIMELINE_END_HOUR; h += 3) {
      ticks.push({ hour: h, label: String(h).padStart(2, '0'), pct: ((h - TIMELINE_START_HOUR) / span) * 100 });
    }
    return ticks;
  })();

  const timelineRows = sortedFilteredAvailabilityVehicles.map(v => {
    const dayStart = new Date(`${selectedDate}T00:00:00`);
    const scaleStart = new Date(dayStart.getTime() + TIMELINE_START_HOUR * 60 * 60 * 1000);
    const scaleEnd = new Date(dayStart.getTime() + TIMELINE_END_HOUR * 60 * 60 * 1000);
    const scaleMs = scaleEnd - scaleStart;
    const statusKey = getVehicleAvailabilityStatus(v).key;

    const blocks = (v.assignments || []).map(a => {
      // A trip can start before the scale or end after it; clamp so the block
      // stays inside its row rather than overflowing, while still showing that
      // the vehicle is busy at the edge.
      const from = Math.max(a.window.start.getTime(), scaleStart.getTime());
      const to = Math.min(a.window.end.getTime(), scaleEnd.getTime());
      if (to <= from) return null;
      const fmt = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return {
        assignment_id: a.assignment_id,
        booking_id: a.booking_id,
        booking_type: a.booking_type,
        ref: a.ref,
        tripType: a.tripType,
        completed: a.completed,
        label: `${fmt(a.window.start)}–${fmt(a.window.end)}`,
        leftPct: ((from - scaleStart.getTime()) / scaleMs) * 100,
        // A floor keeps a very short delivery from rendering as an invisible
        // sliver that reads as "free".
        widthPct: Math.max(4, ((to - from) / scaleMs) * 100),
      };
    }).filter(Boolean);

    return {
      vehicle_id: v.vehicle_id,
      plate_number: v.plate_number,
      vehicle_status: v.vehicle_status,
      outOfService: ['maintenance', 'unavailable'].includes(statusKey),
      blocks,
    };
  });

  // ============================================================
  // --- INVENTORY TAB: search + type filter ---
  // ============================================================
  const filteredInventory = vehicles.filter(v => {
    if (inventoryTypeFilter !== 'All' && v.vehicle_type !== inventoryTypeFilter) return false;
    if (inventorySearch) {
      const term = inventorySearch.toLowerCase();
      if (!v.plate_number.toLowerCase().includes(term)) return false;
    }
    return true;
  });

  const activeInventoryFilterCount = (inventorySearch.trim() ? 1 : 0) + (inventoryTypeFilter !== 'All' ? 1 : 0);

  const sortedFilteredInventory = inventorySort.field === 'plate'
    ? [...filteredInventory].sort((a, b) => {
        const result = a.plate_number.localeCompare(b.plate_number);
        return inventorySort.direction === 'asc' ? result : -result;
      })
    : filteredInventory;

  // ============================================================
  // --- ACTIVE ASSIGNMENTS: group by event ---
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

  const activeAssignmentFilterCount = (assignmentSearchTerm.trim() ? 1 : 0) + (assignmentSectionFilter !== 'All' ? 1 : 0) + (assignmentDatePreset !== 'All Time' ? 1 : 0);

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

  // ============================================================
  // --- HISTORY TAB: full assignment log, filter + sort ---
  // ============================================================
  const { start: historyRangeStart, end: historyRangeEnd } = getRangeBounds(historyDatePreset, historyDateCustomStart, historyDateCustomEnd);

  const filteredHistoryRows = assignments
    .filter(a => {
      if (historyStatusFilter !== 'All') {
        const status = getAssignmentStatus(a.assignment_status === 'Completed', a.booking?.event_datetime);
        // Keys come from getAssignmentStatus (assigned / in_use / returned).
        // They are NOT the stored vehicle_assign.assignment_status values —
        // mapping these to 'scheduled'/'completed' matches nothing at all and
        // silently empties the table for two of the three filters. This has
        // now regressed once via a stale-copy overwrite; if you are changing
        // this line, check getAssignmentStatus first.
        const filterKey = historyStatusFilter === 'Assigned' ? 'assigned' : historyStatusFilter === 'In Use' ? 'in_use' : 'returned';
        if (status.key !== filterKey) return false;
      }
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
    .sort((a, b) => new Date(b.dispatch_datetime || 0) - new Date(a.dispatch_datetime || 0));

  const activeHistoryFilterCount = (historySearch.trim() ? 1 : 0) + (historyStatusFilter !== 'All' ? 1 : 0) + (historyDatePreset !== 'All Time' ? 1 : 0);

  const sortedFilteredHistoryRows = historySort.field
    ? [...filteredHistoryRows].sort((a, b) => {
        let result = 0;
        if (historySort.field === 'customer') {
          const nameOf = (x) => (x.booking?.customer ? `${x.booking.customer.first_name} ${x.booking.customer.last_name}` : '');
          result = nameOf(a).localeCompare(nameOf(b));
        }
        else if (historySort.field === 'eventDate') result = new Date(a.booking?.event_datetime || 0) - new Date(b.booking?.event_datetime || 0);
        else if (historySort.field === 'dispatchedOn') result = new Date(a.dispatch_datetime || 0) - new Date(b.dispatch_datetime || 0);
        return historySort.direction === 'asc' ? result : -result;
      })
    : filteredHistoryRows;

  // ============================================================
  // --- HISTORY: one row per booking, not per vehicle ---
  // ============================================================
  // vehicle_assign stores a row per vehicle, so a booking that took two
  // vehicles produced two history rows carrying the same reference, customer
  // and event date. Grouped by booking the way the Active Assignments tab
  // already groups, and expandable to the individual vehicles — the same shape
  // the Equipment page's history uses.
  //
  // Grouping happens AFTER filtering, so a group summarises what matched: a
  // search for one plate shows that booking with the one vehicle that matched,
  // not the whole dispatch. Group order follows the row order above, so
  // whichever sort is active still drives the list.
  const historyGroups = (() => {
    const map = new Map();
    sortedFilteredHistoryRows.forEach(a => {
      const key = a.booking_id || `orphan-${a.assignment_id}`;
      if (!map.has(key)) {
        map.set(key, { key, booking_id: a.booking_id, booking: a.booking, items: [] });
      }
      map.get(key).items.push(a);
    });

    return Array.from(map.values()).map(g => {
      const returnedCount = g.items.filter(i => i.assignment_status === 'Completed').length;
      const allReturned = returnedCount === g.items.length;
      const open = g.items.filter(i => i.assignment_status !== 'Completed');
      // The group takes the least-finished stage among its vehicles, from the
      // same getAssignmentStatus the other tabs use, so a group can never
      // report a stage its own rows disagree with.
      const anyInUse = open.some(i => getAssignmentStatus(false, i.booking?.event_datetime).key === 'in_use');
      const stage = allReturned
        ? { key: 'returned', label: 'Returned' }
        : anyInUse
          ? { key: 'in_use', label: 'In Use' }
          : { key: 'assigned', label: 'Assigned' };
      const dispatchTimes = g.items.map(i => new Date(i.dispatch_datetime || 0).getTime()).filter(Boolean);
      return {
        ...g,
        returnedCount,
        allReturned,
        stage,
        // Earliest departure in the group — the moment the event's transport
        // actually started.
        firstDispatchAt: dispatchTimes.length ? new Date(Math.min(...dispatchTimes)) : null,
      };
    });
  })();

  const toggleHistoryGroup = (key) => {
    setExpandedHistoryGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // --- RENDER ---
  return (
    <div className="space-y-[18px] relative pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-[25px] font-bold tracking-[-0.02em] text-slate-900">Vehicles</h1>
          <p className="text-[14.5px] text-slate-600 mt-1.5 max-w-[540px] [text-wrap:pretty]">
            See what's actually free on a given date, manage the fleet, and track dispatches.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setAddFieldErrors({}); setIsAddModalOpen(true); }}
            className="bg-white border border-slate-300 text-slate-700 px-4 py-2.5 rounded-[10px] font-semibold transition-colors flex items-center gap-2 text-sm whitespace-nowrap shadow-sm cursor-pointer hover:bg-[#f4f9f6] hover:border-[#c9dfd4] hover:text-[#007038] focus:outline-none focus:ring-2 focus:ring-[#008A45]/40"
          >
            <Plus size={16} /> Add vehicle
          </button>
          <button
            onClick={() => { setSelectedVehicleIds([]); setBookingSearchTerm(''); setShowBookingDropdown(false); setVehiclePickerSearch(''); setIsAssignModalOpen(true); }}
            className="bg-[#008A45] hover:bg-[#007038] text-white px-[17px] py-2.5 rounded-[10px] font-bold transition-all flex items-center gap-2 text-sm whitespace-nowrap shadow-sm hover:shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 focus:ring-offset-1"
          >
            <ClipboardList size={16} /> Assign Vehicle
          </button>
          <button
            onClick={fetchData}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-3 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* --- DATE CONTEXT BAR --- */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <CalendarClock size={16} className="text-[#008A45] shrink-0" />
          <span className="font-semibold text-slate-600">Showing availability for:</span>
          <span className="font-bold text-slate-900">{selectedDateLabel}</span>
          {snapshotLoading && <span className="text-xs text-slate-400">(recalculating…)</span>}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedDate(todayISO())}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${isSelectedToday ? 'bg-[#008A45] border-[#008A45] text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            Today
          </button>
          <button
            onClick={() => setSelectedDate(tomorrowISO())}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${isSelectedTomorrow ? 'bg-[#008A45] border-[#008A45] text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
          >
            Tomorrow
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
          />
        </div>
      </div>
      <p className="text-xs text-slate-400 -mt-3 px-1">This date only affects the stat cards above and the Availability tab below — Active Assignments and History have their own independent date filters.</p>

      {/* --- STAT CARDS — date-scoped only. "Needs attention" and "Overdue
      returns" are live/always-current, so they live in the sidebar. --- */}
      <div>
        {/* The date these three describe is the one thing a reader can get
            wrong here, so it is stated once above them rather than as a
            centred 11px caption underneath. */}
        <p className="text-[13px] font-semibold text-slate-600 mb-2.5">
          For <span className="text-slate-900">{selectedDateLabel}</span> — follows the date selected above
        </p>
        <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]">
          <button
            onClick={() => setIsEventsModalOpen(true)}
            className="relative overflow-hidden rounded-[15px] border border-slate-200/70 bg-white px-5 py-[18px] text-left cursor-pointer transition-all hover:border-[#c9dfd4] hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)] focus:outline-none focus:ring-2 focus:ring-[#008A45]/40"
          >
            <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-slate-400" />
            <span className="block text-[13px] font-semibold text-slate-600 mb-2 whitespace-nowrap">Events on this date</span>
            <span className="block text-[30px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">{eventsOnDateCount}</span>
            <span className="block text-[13px] text-slate-600 mt-2.5">Bookings needing transport</span>
          </button>
          <button
            onClick={() => scrollToAvailability('deployed')}
            className="relative overflow-hidden rounded-[15px] border border-slate-200/70 bg-white px-5 py-[18px] text-left cursor-pointer transition-all hover:border-[#c9dfd4] hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)] focus:outline-none focus:ring-2 focus:ring-[#008A45]/40"
          >
            <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#008A45]" />
            <span className="block text-[13px] font-semibold text-slate-600 mb-2 whitespace-nowrap">Vehicles committed</span>
            <span className="block text-[30px] font-semibold tracking-[-0.03em] leading-none tabular-nums text-slate-900">{deployedCount}</span>
            <span className="block text-[13px] text-slate-600 mt-2.5">Promised to a booking on this date</span>
          </button>
          <button
            onClick={() => scrollToAvailability('free')}
            className="relative overflow-hidden rounded-[15px] border border-slate-200/70 bg-white px-5 py-[18px] text-left cursor-pointer transition-all hover:border-[#c9dfd4] hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)] focus:outline-none focus:ring-2 focus:ring-[#008A45]/40"
          >
            <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-teal-600" />
            <span className="block text-[13px] font-semibold text-slate-600 mb-2 whitespace-nowrap">Vehicles available</span>
            <span className={`block text-[30px] font-semibold tracking-[-0.03em] leading-none tabular-nums ${freeCount === 0 ? 'text-amber-700' : 'text-slate-900'}`}>{freeCount}</span>
            <span className="block text-[13px] text-slate-600 mt-2.5">Not committed · of {totalFleet} in the fleet</span>
          </button>
        </div>
      </div>

      {/* --- MAIN WORKSPACE: tabbed panel on the left, live operational
      alerts on the right --- */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">

      {/* --- TAB CONTROL --- */}
      <div ref={availabilityPanelRef} className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
        <div>
          {/* Underline tabs, matching every other page. White pills on a grey
              bar were this page's own invention. */}
          <div className="flex items-center gap-0.5 px-2 border-b border-slate-100 overflow-x-auto">
            <button
              onClick={() => setActiveTableTab('availability')}
              className={`shrink-0 flex items-center gap-[7px] whitespace-nowrap px-[15px] py-[13px] -mb-px border-b-2 text-[14.5px] transition-colors cursor-pointer ${activeTableTab === 'availability' ? 'border-[#008A45] text-[#007038] font-bold' : 'border-transparent text-slate-600 font-semibold hover:text-slate-900'}`}
            >
              <CalendarClock size={14} /> Availability
            </button>
            <button
              onClick={() => setActiveTableTab('inventory')}
              className={`shrink-0 flex items-center gap-[7px] whitespace-nowrap px-[15px] py-[13px] -mb-px border-b-2 text-[14.5px] transition-colors cursor-pointer ${activeTableTab === 'inventory' ? 'border-[#008A45] text-[#007038] font-bold' : 'border-transparent text-slate-600 font-semibold hover:text-slate-900'}`}
            >
              <LayoutGrid size={14} /> Fleet
              <span className={`inline-flex items-center justify-center min-w-[21px] h-[21px] px-1.5 rounded-full text-[12.5px] font-bold tabular-nums ${activeTableTab === 'inventory' ? 'bg-[#EAF3F2] text-[#00703a]' : 'bg-slate-100 text-slate-600'}`}>{totalFleet}</span>
            </button>
            <button
              onClick={() => setActiveTableTab('assignments')}
              className={`shrink-0 flex items-center gap-[7px] whitespace-nowrap px-[15px] py-[13px] -mb-px border-b-2 text-[14.5px] transition-colors cursor-pointer ${activeTableTab === 'assignments' ? 'border-[#008A45] text-[#007038] font-bold' : 'border-transparent text-slate-600 font-semibold hover:text-slate-900'}`}
            >
              <ClipboardList size={14} /> Active Assignments
              {activeAssignmentRows.length > 0 && (
                <span className={`inline-flex items-center justify-center min-w-[21px] h-[21px] px-1.5 rounded-full text-[12.5px] font-bold tabular-nums ${
                  overdueAssignments.length > 0
                    ? 'bg-red-50 text-red-700'
                    : activeTableTab === 'assignments' ? 'bg-[#EAF3F2] text-[#00703a]' : 'bg-slate-100 text-slate-600'
                }`}>
                  {assignmentGroups.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTableTab('history')}
              className={`shrink-0 flex items-center gap-[7px] whitespace-nowrap px-[15px] py-[13px] -mb-px border-b-2 text-[14.5px] transition-colors cursor-pointer ${activeTableTab === 'history' ? 'border-[#008A45] text-[#007038] font-bold' : 'border-transparent text-slate-600 font-semibold hover:text-slate-900'}`}
            >
              <History size={14} /> History
            </button>
          </div>
          <p className="px-5 py-3.5 border-b border-slate-100 text-[13.5px] text-slate-600 [text-wrap:pretty]">
            {activeTableTab === 'availability' && <>Every vehicle's committed/available status for <span className="font-semibold text-slate-700">{selectedDateLabel}</span>.</>}
            {activeTableTab === 'inventory' && <>The full fleet list — edit details, add new vehicles, or flag maintenance/unavailable.</>}
            {activeTableTab === 'assignments' && <>Everything currently dispatched to any event, regardless of the date selected above.</>}
            {activeTableTab === 'history' && <>The full log of every assignment ever made — scheduled and completed — across the whole fleet.</>}
          </p>
        </div>

        {/* ===== AVAILABILITY TAB ===== */}
        {activeTableTab === 'availability' && (
          <>
            <div className={`p-4 border-b flex flex-wrap items-center gap-3 ${activeAvailabilityFilterCount > 0 ? 'bg-emerald-50/40 border-emerald-100' : 'border-slate-200'}`}>
              {activeAvailabilityFilterCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shrink-0">
                  {activeAvailabilityFilterCount} active
                </span>
              )}
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Search plate number..."
                  value={availabilitySearch}
                  onChange={(e) => setAvailabilitySearch(e.target.value)}
                  className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${availabilitySearch.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
                />
              </div>
              <Select
                value={availabilityTypeFilter}
                onChange={(e) => setAvailabilityTypeFilter(e.target.value)}
                className={`border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${availabilityTypeFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
              >
                <option value="All">All types</option>
                <option value="Car">Car</option>
                <option value="Motorcycle">Motorcycle</option>
              </Select>
              <div className="flex items-center gap-1">
                {[
                  { key: 'All', label: 'All' },
                  { key: 'outofservice', label: `Out of service (${availabilityStatusCounts.outofservice})` },
                  { key: 'deployed', label: `Committed (${availabilityStatusCounts.deployed})` },
                  { key: 'free', label: `Available (${availabilityStatusCounts.free})` },
                ].map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setAvailabilityStatusFilter(opt.key)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                      availabilityStatusFilter === opt.key
                        ? (opt.key === 'outofservice' ? 'bg-orange-500 border-orange-500 text-white' : 'bg-[#008A45] border-[#008A45] text-white')
                        : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {activeAvailabilityFilterCount > 0 && (
                <button
                  onClick={() => { setAvailabilitySearch(''); setAvailabilityTypeFilter('All'); setAvailabilityStatusFilter('All'); }}
                  className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                >
                  Clear filters
                </button>
              )}
            </div>
            {/* ---- DAY TIMELINE ----
                 The table below can only ever express ONE trip per vehicle,
                 which is the shape the window model breaks: a van that runs a
                 06:00 wedding setup is free again by early afternoon and can
                 take a 14:00 delivery. Drawn as blocks on a day, that reads at
                 a glance — busy twice, free in between — instead of leaving
                 the manager to do the arithmetic. */}
            {snapshotLoading ? (
              <div className="px-5 py-8 text-center text-slate-500 text-sm border-b border-slate-100">Working out the day…</div>
            ) : timelineRows.length === 0 ? (
              <div className="px-5 py-8 text-center text-slate-500 text-sm border-b border-slate-100">No vehicles match this filter.</div>
            ) : (
              <div className="px-5 py-4 border-b border-slate-100">
                <div className="flex items-baseline justify-between gap-3 mb-3">
                  <p className="text-[13px] font-bold text-slate-600 tracking-[0.04em]">Day timeline</p>
                  <p className="text-[12.5px] text-slate-600">{TIMELINE_START_HOUR}:00 – {TIMELINE_END_HOUR}:00</p>
                </div>

                {/* hour ruler */}
                <div className="flex items-center gap-3 mb-1.5">
                  <span className="w-[104px] shrink-0" />
                  <div className="relative flex-1 h-4">
                    {timelineTicks.map(t => (
                      <span
                        key={t.hour}
                        className="absolute top-0 -translate-x-1/2 text-[11.5px] text-slate-400 tabular-nums"
                        style={{ left: `${t.pct}%` }}
                      >
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  {timelineRows.map(row => (
                    <div key={row.vehicle_id} className="flex items-center gap-3">
                      <div className="w-[104px] shrink-0 min-w-0">
                        <p className="text-[13.5px] font-semibold text-slate-900 truncate">{row.plate_number}</p>
                        {row.outOfService && (
                          <p className="text-[11.5px] text-amber-700 truncate">{row.vehicle_status}</p>
                        )}
                      </div>
                      <div className={`relative flex-1 h-8 rounded-[7px] border ${
                        row.outOfService
                          ? 'bg-slate-100 border-slate-200'
                          : row.blocks.length === 0
                            ? 'bg-[#f4f9f6] border-[#dcece3]'
                            : 'bg-slate-50 border-slate-200'
                      }`}>
                        {/* faint hour gridlines, so a block's position is readable */}
                        {timelineTicks.map(t => (
                          <span key={t.hour} className="absolute top-0 bottom-0 w-px bg-slate-200/70" style={{ left: `${t.pct}%` }} />
                        ))}
                        {row.outOfService ? (
                          <span className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold text-slate-500">
                            Out of service
                          </span>
                        ) : row.blocks.length === 0 ? (
                          <span className="absolute inset-0 flex items-center justify-center text-[12px] font-semibold text-[#00703a]">
                            Available all day
                          </span>
                        ) : row.blocks.map(b => (
                          <button
                            key={b.assignment_id}
                            type="button"
                            onClick={() => goToBookingDetails(b.booking_id, b.booking_type)}
                            title={`${b.ref} · ${b.tripType} · ${b.label}${b.completed ? ' · returned' : ''}`}
                            className={`absolute top-1 bottom-1 rounded-[5px] px-1.5 flex items-center overflow-hidden text-[11.5px] font-semibold whitespace-nowrap cursor-pointer transition-colors ${
                              b.completed
                                ? 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                                : b.tripType === 'Delivery'
                                  ? 'bg-[#e7d8fb] text-purple-800 hover:bg-[#dcc7f8]'
                                  : 'bg-[#bfe3cf] text-[#00532a] hover:bg-[#a9d9bd]'
                            }`}
                            style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}
                          >
                            {b.ref}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-4 mt-3.5 pt-3 border-t border-slate-100">
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-600">
                    <span className="w-3 h-3 rounded-[3px] bg-[#bfe3cf]" /> Event setup
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-600">
                    <span className="w-3 h-3 rounded-[3px] bg-[#e7d8fb]" /> Delivery
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-600">
                    <span className="w-3 h-3 rounded-[3px] bg-slate-200" /> Returned
                  </span>
                  <span className="text-[12.5px] text-slate-500">A gap between blocks is time the vehicle is free.</span>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#fbfcfd] border-b border-slate-100">
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">{renderSortHeader(availabilitySort, toggleAvailabilitySort, 'plate', 'Vehicle')}</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Type</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Status</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Assigned to</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                  {isLoading || snapshotLoading ? (
                    <tr><td colSpan="5" className="p-6 text-center text-slate-500">Calculating availability…</td></tr>
                  ) : sortedFilteredAvailabilityVehicles.length === 0 ? (
                    <tr><td colSpan="5" className="p-6 text-center text-slate-500">No vehicles match your search/filter.</td></tr>
                  ) : (
                    sortedFilteredAvailabilityVehicles.map((v) => {
                      const status = getVehicleAvailabilityStatus(v);
                      return (
                        <tr
                          key={v.vehicle_id}
                          onClick={() => { setAvailabilityDetailVehicle(v); setIsAvailabilityDetailOpen(true); }}
                          title="Click for details"
                          className={`hover:bg-[#fbfcfd] transition-colors cursor-pointer group ${status.key === 'maintenance' || status.key === 'unavailable' ? 'bg-orange-50/40' : ''}`}
                        >
                          <td className="px-4 py-[15px]">
                            <p className="font-bold text-slate-900">{v.plate_number}</p>
                          </td>
                          <td className="px-4 py-[15px]">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#CBDEDD]/60 border border-[#a3c7c4] text-slate-800">
                              {v.vehicle_type === 'Car' ? <Car size={14} /> : <Truck size={14} />}
                              {v.vehicle_type}
                            </span>
                          </td>
                          <td className="px-4 py-[15px]">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${status.pillClass}`}>{status.label}</span>
                          </td>
                          <td className="px-4 py-[15px]">
                            {v.assignments.length > 0 ? (
                              <div className="space-y-1.5">
                                {v.assignments.map((trip) => (
                                  <div key={trip.assignment_id}>
                                    <p className={`font-semibold ${trip.completed ? 'text-slate-500' : 'text-slate-800'}`}>
                                      {trip.customerName}
                                      {trip.completed && <span className="ml-1.5 text-[10px] font-bold text-slate-400 uppercase">returned</span>}
                                    </p>
                                    <p className="text-xs text-slate-500">{trip.ref} · {trip.tripType} · {formatTripWindow(trip.window)}</p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-[15px] text-right">
                            <ChevronRight size={16} className="text-slate-300 group-hover:text-[#008A45] transition-colors" />
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ===== FLEET (INVENTORY) TAB ===== */}
        {activeTableTab === 'inventory' && (
          <>
            <div className={`p-4 border-b flex flex-wrap items-center gap-3 ${activeInventoryFilterCount > 0 ? 'bg-emerald-50/40 border-emerald-100' : 'border-slate-200'}`}>
              {activeInventoryFilterCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shrink-0">
                  {activeInventoryFilterCount} active
                </span>
              )}
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
                <option value="Car">Car</option>
                <option value="Motorcycle">Motorcycle</option>
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
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#fbfcfd] border-b border-slate-100">
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">{renderSortHeader(inventorySort, toggleInventorySort, 'plate', 'Vehicle')}</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Type</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Base status</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-center">Trips booked</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                  {isLoading ? (
                    <tr><td colSpan="5" className="p-6 text-center text-slate-500">Loading fleet...</td></tr>
                  ) : sortedFilteredInventory.length === 0 ? (
                    <tr><td colSpan="5" className="p-6 text-center text-slate-500">No vehicles found.</td></tr>
                  ) : (
                    sortedFilteredInventory.map((v) => {
                      // "Usage" counted every open assignment and called it
                      // "in use", so a van booked for a wedding three weeks out
                      // read as being out on the road right now. Committed and
                      // in use are different states — blueprint-02 settles both
                      // words — so they are counted and labelled separately.
                      const openTrips = assignments.filter(a => a.vehicle_id === v.vehicle_id && a.assignment_status !== 'Completed');
                      const usageCount = openTrips.length;
                      const onTheRoadNow = openTrips.some(a => {
                        const w = getDispatchWindow(a, a.booking);
                        return w ? (w.start <= now && now <= w.end) : false;
                      });
                      return (
                        <tr key={v.vehicle_id} className="hover:bg-[#fbfcfd] transition-colors">
                          <td className="px-4 py-[15px]">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-slate-900">{v.plate_number}</p>
                              {v.vehicle_status !== 'Available' && (
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${v.vehicle_status === 'Maintenance' ? 'bg-orange-50 border-orange-200 text-orange-700' : 'bg-slate-100 border-slate-300 text-slate-600'}`}>
                                  {v.vehicle_status}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-[15px]">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#CBDEDD]/60 border border-[#a3c7c4] text-slate-800">
                              {v.vehicle_type === 'Car' ? <Car size={14} /> : <Truck size={14} />}
                              {v.vehicle_type}
                            </span>
                          </td>
                          <td className="px-4 py-[15px] text-slate-700 font-semibold">{v.vehicle_status}</td>
                          <td className="px-4 py-[15px] text-center">
                            <button
                              onClick={() => handleViewUsage(v)}
                              className="text-blue-500 hover:text-blue-700 transition-colors text-xs font-medium flex items-center gap-1 mx-auto"
                            >
                              <ClipboardList size={14} />
                              {usageCount === 0
                                ? 'None booked'
                                : onTheRoadNow
                                  ? `In use · ${usageCount} booked`
                                  : `${usageCount} booked`}
                            </button>
                          </td>
                          <td className="px-4 py-[15px] text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleFlagIssueClick(v)}
                                className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-full px-3 py-1.5 transition-colors cursor-pointer"
                                title="Mark this vehicle as under maintenance or unavailable"
                              >
                                <Wrench size={13} /> Flag issue
                              </button>
                              <button
                                onClick={() => handleEditClick(v)}
                                className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                                title="Edit plate, type, status"
                              >
                                <Edit size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteVehicle(v.vehicle_id)}
                                className="text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                                title="Delete vehicle"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ===== ACTIVE ASSIGNMENTS TAB ===== */}
        {activeTableTab === 'assignments' && (
        <div>
        <div className={`p-4 border-b ${activeAssignmentFilterCount > 0 ? 'bg-emerald-50/40 border-emerald-100' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div className="flex items-center gap-2">
              {activeAssignmentFilterCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shrink-0">
                  {activeAssignmentFilterCount} active
                </span>
              )}
              {activeAssignmentFilterCount > 0 && (
                <button
                  onClick={() => { setAssignmentSearchTerm(''); setAssignmentSectionFilter('All'); setAssignmentDatePreset('All Time'); setAssignmentDateCustomStart(''); setAssignmentDateCustomEnd(''); }}
                  className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                >
                  Clear filters
                </button>
              )}
            </div>
            <span className="text-xs font-semibold text-slate-500 shrink-0">{filteredAssignmentGroups.length} of {assignmentGroups.length} event{assignmentGroups.length !== 1 ? 's' : ''} · {activeAssignmentRows.length} vehicle{activeAssignmentRows.length !== 1 ? 's' : ''} total</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                placeholder="Search by customer, booking ref, venue, or plate..."
                value={assignmentSearchTerm}
                onChange={(e) => setAssignmentSearchTerm(e.target.value)}
                className={`w-full pl-8 pr-3 py-1.5 border rounded-lg text-xs focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${assignmentSearchTerm.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
              />
            </div>
            <div className="flex items-center gap-1">
              {['All', 'Overdue', 'Today', 'Upcoming'].map(section => (
                <button
                  key={section}
                  onClick={() => setAssignmentSectionFilter(section)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                    assignmentSectionFilter === section
                      ? (section === 'Overdue' ? 'bg-red-600 border-red-600 text-white' : 'bg-[#008A45] border-[#008A45] text-white')
                      : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {section}{section !== 'All' && ` (${assignmentSectionCounts[section]})`}
                </button>
              ))}
            </div>
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
          </div>

          <div className="mt-3 flex flex-col items-start gap-1">
            <p className="text-xs font-semibold text-slate-600">Or look up a specific event date / range <span className="font-normal text-slate-400">(independent of the date picker above)</span>:</p>
            <DateRangeFilter
              preset={assignmentDatePreset}
              customStart={assignmentDateCustomStart}
              customEnd={assignmentDateCustomEnd}
              rangeStart={assignmentRangeStart}
              rangeEnd={assignmentRangeEnd}
              onPresetChange={setAssignmentDatePreset}
              onCustomStartChange={setAssignmentDateCustomStart}
              onCustomEndChange={setAssignmentDateCustomEnd}
              onClear={() => { setAssignmentDatePreset('All Time'); setAssignmentDateCustomStart(''); setAssignmentDateCustomEnd(''); }}
            />
          </div>
        </div>

        <div className="max-h-[32rem] overflow-y-auto divide-y divide-slate-100">
          {isLoading ? (
            <p className="p-6 text-center text-slate-500 text-sm">Loading assignments...</p>
          ) : assignmentGroups.length === 0 ? (
            <p className="p-6 text-center text-slate-500 text-sm">No active assignments.</p>
          ) : sortedFilteredAssignmentGroups.length === 0 ? (
            <p className="p-6 text-center text-slate-500 text-sm">No assignments match your search/filter.</p>
          ) : (
            sortedFilteredAssignmentGroups.map((group) => {
              const ref = group.booking ? getBookingRef(group.booking) : 'Unknown';
              const customerName = group.booking?.customer ? `${group.booking.customer.first_name} ${group.booking.customer.last_name}` : 'Unknown';
              return (
                <details key={group.booking_id} open={group.isOverdue || group.isToday} className="group/details">
                  <summary className={`p-4 cursor-pointer list-none flex items-center justify-between gap-3 flex-wrap hover:bg-[#fbfcfd] transition-colors ${group.isOverdue ? 'bg-red-50/40' : ''}`}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-slate-400 group-open/details:rotate-90 transition-transform inline-block">▸</span>
                      {group.isOverdue && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-300">
                          <AlertTriangle size={10} /> OVERDUE
                        </span>
                      )}
                      {!group.isOverdue && group.isToday && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">TODAY</span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); goToBookingDetails(group.booking_id, group.booking?.booking_type); }}
                        className="font-mono text-xs font-bold text-[#008A45] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                        title="View full booking details"
                      >
                        {ref} <ExternalLink size={10} />
                      </button>
                      <span className="font-bold text-slate-900 text-sm">{customerName}</span>
                      <span className="text-xs text-slate-500 flex items-center gap-1">
                        <Calendar size={11} /> {group.eventDate ? group.eventDate.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                      </span>
                      {group.booking?.venue && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <MapPin size={11} /> {group.booking.venue}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-slate-500">{countDistinct(group.items, 'vehicle_id')} vehicle{countDistinct(group.items, 'vehicle_id') !== 1 ? 's' : ''}{group.items.length > countDistinct(group.items, 'vehicle_id') ? `, ${group.items.length} runs` : ''}</span>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); handleReturnAllForBooking(group.booking_id, group.items.length); }}
                        className={group.canReturn
                          ? 'text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 border border-blue-200 rounded-lg px-2.5 py-1 hover:bg-blue-50 transition-colors'
                          : 'text-xs font-semibold text-slate-400 flex items-center gap-1 border border-slate-200 rounded-lg px-2.5 py-1 transition-colors'}
                        title={group.canReturn ? undefined : `Locked — returns open 3 hours after the event, at ${formatReturnOpensAt(group.returnOpensAt)}`}
                      >
                        {group.canReturn ? <Undo2 size={13} /> : <Lock size={13} />} Return all
                      </button>
                    </div>
                  </summary>
                  <div className="px-4 pb-4 pl-11 space-y-1.5">
                    {group.items.map((a) => (
                      <div key={a.assignment_id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                        <span className="font-medium text-slate-700">
                          {a.vehicle?.plate_number || 'Unknown'}
                          <span className="text-xs text-slate-500 ml-2">
                            Dispatch: {a.dispatch_datetime ? new Date(a.dispatch_datetime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                          </span>
                        </span>
                        <button
                          onClick={() => handleReturnVehicle(a.assignment_id)}
                          className={group.canReturn
                            ? 'text-blue-500 hover:text-blue-700 transition-colors flex items-center gap-1 text-xs font-medium'
                            : 'text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1 text-xs font-medium'}
                          title={group.canReturn ? undefined : `Locked — returns open 3 hours after the event, at ${formatReturnOpensAt(group.returnOpensAt)}`}
                        >
                          {group.canReturn ? <Undo2 size={13} /> : <Lock size={13} />} Return
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })
          )}
        </div>
        </div>
        )}

        {/* ===== HISTORY TAB ===== */}
        {activeTableTab === 'history' && (
          <>
            <div className={`p-4 border-b space-y-3 ${activeHistoryFilterCount > 0 ? 'bg-emerald-50/40 border-emerald-100' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-center gap-3">
                {activeHistoryFilterCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shrink-0">
                    {activeHistoryFilterCount} active
                  </span>
                )}
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
                  {['All', 'Assigned', 'In Use', 'Returned'].map(opt => (
                    <button
                      key={opt}
                      onClick={() => setHistoryStatusFilter(opt)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                        historyStatusFilter === opt ? 'bg-[#008A45] border-[#008A45] text-white' : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {activeHistoryFilterCount > 0 && (
                  <button
                    onClick={() => { setHistorySearch(''); setHistoryStatusFilter('All'); setHistoryDatePreset('All Time'); setHistoryDateCustomStart(''); setHistoryDateCustomEnd(''); }}
                    className="text-xs font-semibold text-slate-500 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    Clear filters
                  </button>
                )}
              </div>
              <div className="flex flex-col items-start gap-1">
                <p className="text-xs font-semibold text-slate-600">Filter by event date / range <span className="font-normal text-slate-400">(independent of the date picker above)</span>:</p>
                <DateRangeFilter
                  preset={historyDatePreset}
                  customStart={historyDateCustomStart}
                  customEnd={historyDateCustomEnd}
                  rangeStart={historyRangeStart}
                  rangeEnd={historyRangeEnd}
                  onPresetChange={setHistoryDatePreset}
                  onCustomStartChange={setHistoryDateCustomStart}
                  onCustomEndChange={setHistoryDateCustomEnd}
                  onClear={() => { setHistoryDatePreset('All Time'); setHistoryDateCustomStart(''); setHistoryDateCustomEnd(''); }}
                />
              </div>
              <p className="text-[13px] text-slate-600 tabular-nums">
                {historyGroups.length} booking{historyGroups.length !== 1 ? 's' : ''} &#183; {filteredHistoryRows.length} of {assignments.length} dispatch record{assignments.length !== 1 ? 's' : ''}{historySort.field ? '' : ', most recently dispatched first'}
              </p>
            </div>
            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#fbfcfd] border-b border-slate-100 sticky top-0">
                    <th className="px-5 py-3">{renderSortHeader(historySort, toggleHistorySort, 'customer', 'Booking')}</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Vehicles</th>
                    <th className="px-4 py-3">{renderSortHeader(historySort, toggleHistorySort, 'eventDate', 'Event date')}</th>
                    <th className="px-4 py-3">{renderSortHeader(historySort, toggleHistorySort, 'dispatchedOn', 'Dispatch')}</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                  {isLoading ? (
                    <tr><td colSpan="5" className="p-6 text-center text-slate-500">Loading history...</td></tr>
                  ) : historyGroups.length === 0 ? (
                    <tr><td colSpan="5" className="p-6 text-center text-slate-500">No dispatch history matches your search or filter.</td></tr>
                  ) : (
                    historyGroups.map((g) => {
                      const ref = g.booking ? getBookingRef(g.booking) : 'Unknown';
                      const customerName = g.booking?.customer ? g.booking.customer.first_name + ' ' + g.booking.customer.last_name : 'Unknown';
                      const isExpanded = expandedHistoryGroups.has(g.key);
                      const multi = g.items.length > 1;
                      const stagePill = g.stage.key === 'returned' ? 'bg-slate-100 text-slate-600'
                        : g.stage.key === 'in_use' ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-blue-50 text-blue-700';
                      return (
                        <Fragment key={g.key}>
                          <tr
                            className={'transition-colors hover:bg-[#fbfcfd] ' + (multi ? 'cursor-pointer' : '')}
                            onClick={() => { if (multi) toggleHistoryGroup(g.key); }}
                          >
                            <td className="px-5 py-[15px] align-top">
                              <div className="flex items-start gap-2">
                                {multi ? (
                                  <ChevronRight size={15} className={'mt-[3px] shrink-0 text-slate-400 transition-transform ' + (isExpanded ? 'rotate-90' : '')} />
                                ) : (
                                  <span className="w-[15px] shrink-0" />
                                )}
                                <div className="min-w-0">
                                  <p className="text-[14.5px] font-semibold text-slate-900">{customerName}</p>
                                  <p className="text-[13px] text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
                                    {g.booking ? (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); goToBookingDetails(g.booking.booking_id, g.booking.booking_type); }}
                                        className="font-semibold text-[#007038] tabular-nums hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                                        title="View full booking details"
                                      >
                                        {ref} <ExternalLink size={11} />
                                      </button>
                                    ) : (
                                      <span className="font-semibold tabular-nums">{ref}</span>
                                    )}
                                    {g.booking?.venue && <span className="flex items-center gap-1"><MapPin size={11} /> {g.booking.venue}</span>}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-[15px] align-top text-sm text-slate-800">
                              {multi ? g.items.length + ' vehicles' : (g.items[0].vehicle?.plate_number || 'Unknown')}
                            </td>
                            <td className="px-4 py-[15px] align-top text-sm text-slate-600 tabular-nums">
                              {g.booking?.event_datetime ? new Date(g.booking.event_datetime).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                            </td>
                            <td className="px-4 py-[15px] align-top text-sm text-slate-600 tabular-nums">
                              {g.firstDispatchAt ? g.firstDispatchAt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                            </td>
                            <td className="px-4 py-[15px] align-top">
                              <span className={'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12.5px] font-semibold whitespace-nowrap ' + stagePill}>
                                {g.stage.key === 'returned' && <CheckCircle2 size={12} />}
                                {g.stage.label}
                              </span>
                              {/* A part-returned dispatch reads as still out, so
                                  say how much of it is actually back. */}
                              {multi && !g.allReturned && g.returnedCount > 0 && (
                                <p className="text-[12.5px] text-slate-600 mt-1 tabular-nums">{g.returnedCount} of {g.items.length} returned</p>
                              )}
                            </td>
                          </tr>

                          {multi && isExpanded && g.items.map((a) => {
                            const itemStatus = getAssignmentStatus(false, a.booking?.event_datetime);
                            return (
                              <tr key={a.assignment_id} className="bg-[#fbfcfd]">
                                <td className="px-5 py-2.5" />
                                <td className="px-4 py-2.5 text-[13.5px] font-medium text-slate-800">{a.vehicle?.plate_number || 'Unknown'}</td>
                                <td className="px-4 py-2.5" />
                                <td className="px-4 py-2.5 text-[13.5px] text-slate-600 tabular-nums">
                                  {a.dispatch_datetime ? new Date(a.dispatch_datetime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                                </td>
                                <td className="px-4 py-2.5">
                                  {a.assignment_status === 'Completed' ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12.5px] font-semibold bg-slate-100 text-slate-600 whitespace-nowrap">
                                      <CheckCircle2 size={11} /> Returned
                                    </span>
                                  ) : (
                                    <span className={'inline-flex items-center px-2.5 py-0.5 rounded-full text-[12.5px] font-semibold whitespace-nowrap ' + (itemStatus.key === 'in_use' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700')}>
                                      {itemStatus.label}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* --- SIDEBAR: live operational alerts, always-current --- */}
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <span className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-red-500" /> Needs Attention ({needsAttentionVehicles.length})
            </span>
            <button
              onClick={() => setActiveTableTab('inventory')}
              className="text-xs font-semibold text-[#008A45] hover:underline cursor-pointer"
            >
              View all
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {needsAttentionVehicles.length === 0 ? (
              <p className="p-4 text-[13px] text-slate-500">Nothing needs attention right now.</p>
            ) : (
              needsAttentionVehicles.slice(0, 4).map(v => (
                <button
                  key={v.vehicle_id}
                  type="button"
                  onClick={() => handleFlagIssueClick(v)}
                  title="Click to update this vehicle's status"
                  className="w-full flex items-center justify-between px-4 py-2.5 gap-2 text-left hover:bg-[#fbfcfd] transition-colors cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{v.plate_number}</p>
                    <p className="text-xs text-slate-500">{v.vehicle_type}</p>
                  </div>
                  <span className={`shrink-0 inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold ${v.vehicle_status === 'Maintenance' ? 'bg-orange-100 text-orange-700' : 'bg-slate-200 text-slate-600'}`}>{v.vehicle_status}</span>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <span className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-red-500" /> Overdue Returns ({overdueGroups.length})
            </span>
            <button
              onClick={() => { setAssignmentSectionFilter('Overdue'); setActiveTableTab('assignments'); }}
              className="text-xs font-semibold text-[#008A45] hover:underline cursor-pointer"
            >
              View all
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {overdueGroups.length === 0 ? (
              <p className="p-4 text-[13px] text-slate-500">No overdue returns.</p>
            ) : (
              overdueGroups.slice(0, 4).map(group => {
                const customerName = group.booking?.customer ? `${group.booking.customer.first_name} ${group.booking.customer.last_name}` : 'Unknown';
                const days = daysOverdue(group.eventDate);
                return (
                  <button
                    key={group.booking_id}
                    type="button"
                    onClick={() => {
                      setAssignmentSectionFilter('Overdue');
                      setAssignmentSearchTerm(group.booking ? getBookingRef(group.booking) : customerName);
                      setActiveTableTab('assignments');
                    }}
                    title="Click to jump to this event in Active Assignments"
                    className="w-full flex items-center justify-between px-4 py-2.5 gap-2 text-left hover:bg-[#fbfcfd] transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-red-700 truncate">{customerName}</p>
                      <p className="text-xs text-slate-500">{countDistinct(group.items, 'vehicle_id')} vehicle{countDistinct(group.items, 'vehicle_id') !== 1 ? 's' : ''} overdue</p>
                    </div>
                    <span className="shrink-0 text-xs font-bold text-red-600">{days === 0 ? 'Today' : `${days} day${days !== 1 ? 's' : ''}`}</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="p-3 border-t border-slate-200">
            <button
              onClick={scrollToAssignments}
              className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-[#008A45] border border-slate-300 hover:border-[#008A45] rounded-lg px-3 py-2 transition-colors cursor-pointer"
            >
              Go to Active Assignments <ChevronRight size={13} />
            </button>
          </div>
        </div>

        <p className="text-center text-[11px] font-semibold text-red-500">Live status — always current</p>
      </div>
      </div>

      {/* ========================================================= */}
      {/* MODALS */}
      {/* ========================================================= */}

      {/* EVENTS ON DATE MODAL */}
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
                              title={detailCanReturn ? undefined : `Locked — returns open 3 hours after the event, at ${formatReturnOpensAt(detailOpensAt)}`}
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
                  {availabilityDetailVehicle.vehicle_status === 'Available' ? 'Free on this date — nothing assigned.' : `Currently marked ${availabilityDetailVehicle.vehicle_status}.`}
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
            <form onSubmit={handleAddVehicle} className="p-6 space-y-5 text-left">
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
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Vehicle Type *</label>
                <Select
                  name="vehicle_type"
                  value={newVehicleForm.vehicle_type}
                  onChange={handleNewVehicleChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  required
                >
                  <option value="Car">Car</option>
                  <option value="Motorcycle">Motorcycle</option>
                </Select>
              </div>
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
            <form onSubmit={handleEditSubmit} className="p-6 space-y-5 text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Plate Number *</label>
                <input type="text" name="plate_number" value={editVehicleForm.plate_number} onChange={handleEditVehicleChange} className={errorInputClass(!!editFieldErrors.plate_number, 'w-full border rounded-lg p-2.5 text-sm bg-white focus:ring-2 outline-none')} required />
                {editFieldErrors.plate_number && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.plate_number}</p>}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Vehicle Type</label>
                <Select name="vehicle_type" value={editVehicleForm.vehicle_type} onChange={handleEditVehicleChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none">
                  <option value="Car">Car</option>
                  <option value="Motorcycle">Motorcycle</option>
                </Select>
              </div>
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
            <form onSubmit={handleFlagIssueSubmit} className="p-6 space-y-4 text-left">
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
            <form onSubmit={handleAssignSubmit} className="p-6 overflow-y-auto space-y-5 text-left">
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
                      {filteredBookings.length === 0 ? (
                        <div className="p-3 text-sm text-slate-500 text-center">No bookings found.</div>
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
                        const clashingTrip = conflictingTripFor(v.vehicle_id, selectedBooking, assignForm.dispatch_datetime);
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

              {/* Dispatch Date/Time */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Dispatch Date/Time (for all selected vehicles)</label>
                <input
                  type="datetime-local"
                  name="dispatch_datetime"
                  value={assignForm.dispatch_datetime}
                  onChange={handleAssignChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  required
                />
                {selectedBooking && selectedBooking.event_datetime && (
                  <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                    <Clock size={12} className="text-slate-400" />
                    <span>Event starts at: <span className="font-semibold text-slate-700">{new Date(selectedBooking.event_datetime).toLocaleString()}</span></span>
                    <span className="mx-1">•</span>
                    <span className="text-[#008A45] font-medium">Auto-suggested: 2 hours before event</span>
                  </div>
                )}
                <p className="text-xs text-slate-400 mt-1">All selected vehicles will have the same dispatch time.</p>
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
                    return (
                      <div key={record.assignment_id} className={`border rounded-lg p-3 flex justify-between items-center ${isCompleted ? 'bg-slate-50 border-slate-200' : status.key === 'in_use' ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div>
                          <p className="font-bold text-slate-900 text-sm">{customerName}</p>
                          <p className="text-xs text-slate-500">{booking?.venue || 'No venue'} · {booking?.event_datetime ? new Date(booking.event_datetime).toLocaleDateString() : 'N/A'}</p>
                          <p className="text-xs text-slate-500">Booking: {bookingRef} · Dispatch: {record.dispatch_datetime ? new Date(record.dispatch_datetime).toLocaleString() : 'N/A'}</p>
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
