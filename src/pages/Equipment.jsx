// src/pages/Equipment.jsx
import { useState, useEffect, useRef, Fragment } from 'react';
import Select from '../components/Select';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Plus, Edit, Trash2, X, ClipboardList, RefreshCw, Undo2,
  Calendar, MapPin, Users, Search, CalendarClock, LayoutGrid, AlertTriangle,
  ChevronRight, Wrench, CheckCircle2, History, ExternalLink, Lock,
  ArrowUpDown, ArrowUp, ArrowDown,
} from 'lucide-react';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePasswordConfirm } from '../contexts/PasswordConfirmContext';
import { ACTIVE_BOOKING_STATUSES } from '../utils/bookingStatus';
import { isPaymentLedgerLocked } from '../utils/payments';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { errorInputClass } from '../utils/formErrors';
import { getDailyEquipmentSnapshot, checkEquipmentAvailabilityImpact, getStockBreakdown, deriveEquipmentDemand, revalidateAssignmentCapacity } from '../utils/equipment.jsx';
import { getAssignmentStatus, ASSIGNMENT_STAGES } from '../utils/statusLabels';
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

// Turns checkEquipmentAvailabilityImpact's conflict list into the specific,
// accurate reason a stock change is blocked — naming the actual date(s)
// and booking(s) so the manager knows exactly what to resolve, instead of
// a vague "some bookings might be affected" warning.
const describeEquipmentConflicts = (conflicts, proposedAvailable) => {
  const first = conflicts[0];
  const dateLabel = new Date(`${first.date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const eventPreview = first.events
    .slice(0, 2)
    .map(e => `${e.ref} (${e.quantity} unit${e.quantity !== 1 ? 's' : ''})`)
    .join(', ');
  const moreEvents = first.events.length > 2 ? `, and ${first.events.length - 2} more` : '';
  const moreDates = conflicts.length > 1 ? ` (and ${conflicts.length - 1} other date${conflicts.length > 2 ? 's' : ''} would also fall short)` : '';
  return `Can't save this — on ${dateLabel}, ${first.committed} unit(s) are already needed for ${eventPreview}${moreEvents}, but this change would leave only ${proposedAvailable} available${moreDates}. Reassign equipment away from a lower-priority booking or reduce the Damaged/Maintenance count first.`;
};

// ============================================================
// EQUIPMENT RETURN POLICY
// ============================================================
// The panel asked outright: "What is the policy for equipment return?
// Right after use? Within 12 hrs? Within 4 hrs?" The code had half an
// answer buried in it and no stated one, so it is written down here and
// shown in the UI (see RETURN_POLICY_TEXT) rather than left to be
// inferred.
//
// Two distinct moments, which is what was previously conflated:
//
//   1. OPENS (event start + 3h) — the earliest a return can be recorded.
//      Equipment can't physically come back before the event it's out for
//      has realistically happened, so marking it returned early is
//      blocked. 3 hours covers an event that runs long.
//
//   2. DUE (event start + 24h) — the deadline. Still not returned past
//      this point and the assignment counts as Overdue.
//
// Previously "Overdue" was simply `event_datetime < now`, while Return
// only unlocked at event + 3h. That left a 3-hour window where an
// assignment was flagged Overdue in red and listed in the Overdue Returns
// panel while its Return button was still locked — the manager was told
// to act on something the system wouldn't let them act on. Anchoring
// overdue to the 24h due time removes that contradiction by construction,
// since DUE is always well after OPENS.
const RETURN_OPENS_AFTER_MS = 3 * 60 * 60 * 1000;   // 3 hours
const RETURN_DUE_AFTER_MS = 24 * 60 * 60 * 1000;    // 24 hours
export const RETURN_POLICY_TEXT = 'Equipment is due back within 24 hours of the event start. Returns can be recorded from 3 hours after the event starts, and anything still out past the 24-hour mark is flagged Overdue.';

const getReturnAvailability = (eventDatetimeStr) => {
  if (!eventDatetimeStr) return { canReturn: true, opensAt: null };
  const opensAt = new Date(new Date(eventDatetimeStr).getTime() + RETURN_OPENS_AFTER_MS);
  return { canReturn: Date.now() >= opensAt.getTime(), opensAt };
};
// When the equipment is contractually due back. No event_datetime at all
// (shouldn't normally happen) means nothing to count from, so it is never
// treated as overdue rather than being permanently flagged.
const getReturnDueAt = (eventDatetimeStr) =>
  eventDatetimeStr ? new Date(new Date(eventDatetimeStr).getTime() + RETURN_DUE_AFTER_MS) : null;
// ============================================================
// WHEN EQUIPMENT CAN BE ASSIGNED
// ============================================================
// Exactly one status: Approved.
//
//   Pending    — still an un-reviewed request. Nothing is allocated until
//                the manager accepts it, and approval is what allocates
//                (allocateEquipmentForBooking in useApprovalHandlers).
//   Approved   — accepted and not yet locked. This is the window for
//                allocation and for any adjustment to it.
//   Confirmed+ — locked. BookingDetails.jsx already refuses to assign,
//                edit, or remove equipment from here on
//                ("equipment can't be assigned once a booking is
//                Confirmed"), because the event is committed and its
//                resources are settled.
//
// Derived from the two shared constants rather than hardcoding 'Approved',
// so it keeps following the lifecycle if either list changes. The Equipment
// page's own Assign modal previously allowed Confirmed bookings, which let
// a manager do from here exactly what the booking's own page refused —
// same action, two different answers depending on which screen it was
// started from.
const canAssignEquipmentTo = (bookingStatus) =>
  ACTIVE_BOOKING_STATUSES.includes(bookingStatus) && !isPaymentLedgerLocked(bookingStatus);

const formatReturnOpensAt = (opensAt) =>
  opensAt ? opensAt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';


export default function Equipment() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();

  // --- STATE ---
  const [equipmentList, setEquipmentList] = useState([]);
  const [assignments, setAssignments] = useState([]); // ALL booking_equipment rows (returned + active) — feeds Usage history and the grouped Active Assignments section
  const [bookings, setBookings] = useState([]); // Package bookings, for the Assign modal's booking picker + the Upcoming Prep tab
  const [packageEquipment, setPackageEquipment] = useState([]); // package→equipment template rows, for required-vs-assigned in the prep view
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addFieldErrors, setAddFieldErrors] = useState({});
  const [editFieldErrors, setEditFieldErrors] = useState({});

  // --- Date context — drives the whole "what's actually free" view ---
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [snapshot, setSnapshot] = useState({ items: [], eventsOnDate: [] });
  const [snapshotLoading, setSnapshotLoading] = useState(true);

  // --- Availability/Inventory/Assignments tab control — all three live in
  // one tabbed panel so a long equipment list never pushes Active
  // Assignments far down the page; only one is on-screen at a time. ---
  // Opens on Upcoming: the manager's first question is "what's coming up
  // and is it ready", not "what's free today".
  const [activeTableTab, setActiveTableTab] = useState('upcoming'); // 'upcoming' | 'availability' | 'inventory' | 'assignments' | 'history'
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryTypeFilter, setInventoryTypeFilter] = useState('All'); // 'All' | 'Countable' | 'Decoration'
  // Switched on by the sidebar's Needs Attention panel.
  const [inventoryNeedsAttentionOnly, setInventoryNeedsAttentionOnly] = useState(false);

  // --- Availability tab search/filter — same shape as Inventory's, plus a
  // status filter, so filtering feels consistent across every tab on this
  // page instead of only some of them having it. ---
  const [availabilitySearch, setAvailabilitySearch] = useState('');
  const [availabilityTypeFilter, setAvailabilityTypeFilter] = useState('All'); // 'All' | 'Countable' | 'Decoration'
  const [availabilityStatusFilter, setAvailabilityStatusFilter] = useState('All'); // 'All' | 'overbooked' | 'tight' | 'fully' | 'available'

  // --- Active Assignments search/filter — this list spans every active
  // event regardless of the date picker above, so it can grow long; these
  // let a manager narrow it down instead of scrolling through everything. ---
  const [assignmentSearchTerm, setAssignmentSearchTerm] = useState('');
  const [assignmentSectionFilter, setAssignmentSectionFilter] = useState('All'); // 'All' | 'Overdue' | 'Today' | 'Upcoming'
  const [assignmentDatePreset, setAssignmentDatePreset] = useState('All Time');
  const [assignmentDateCustomStart, setAssignmentDateCustomStart] = useState('');
  const [assignmentDateCustomEnd, setAssignmentDateCustomEnd] = useState('');

  // --- History tab — full assignment log (both returned and still-active),
  // across every piece of equipment, so "where did this ever go" has one
  // findable place instead of being buried per-item in the Usage modal. ---
  const [historySearch, setHistorySearch] = useState('');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('All'); // 'All' | 'Assigned' | 'In Use' | 'Returned'
  const [historyDatePreset, setHistoryDatePreset] = useState('All Time');
  const [historyDateCustomStart, setHistoryDateCustomStart] = useState('');
  const [historyDateCustomEnd, setHistoryDateCustomEnd] = useState('');

  // --- Table sorting — one {field, direction} pair per tab, since each
  // tab's default order means something different (Availability defaults to
  // problems-first, History to newest-first, etc.) and clicking a header
  // should override just that tab's own sort, not affect the others. ---
  const [availabilitySort, setAvailabilitySort] = useState({ field: null, direction: 'asc' });
  const [inventorySort, setInventorySort] = useState({ field: null, direction: 'asc' });
  const [assignmentSort, setAssignmentSort] = useState({ field: 'priority', direction: 'asc' }); // 'priority' | 'date' | 'customer'
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

  // --- Availability row detail modal ---
  const [isAvailabilityDetailOpen, setIsAvailabilityDetailOpen] = useState(false);
  const [availabilityDetailItem, setAvailabilityDetailItem] = useState(null);

  // --- Events-on-date modal (from the stat card) ---
  const [isEventsModalOpen, setIsEventsModalOpen] = useState(false);

  // --- "Flag Issue" quick modal — a focused shortcut to mark equipment
  // damaged/under maintenance without going through the full Edit form. ---
  const [isFlagIssueModalOpen, setIsFlagIssueModalOpen] = useState(false);
  const [flagIssueItem, setFlagIssueItem] = useState(null);
  const [flagIssueForm, setFlagIssueForm] = useState({ damaged_quantity: 0, maintenance_quantity: 0 });
  const [flagIssueErrors, setFlagIssueErrors] = useState({});

  const [isUsageModalOpen, setIsUsageModalOpen] = useState(false);
  const [usageStatusFilter, setUsageStatusFilter] = useState('All'); // 'All' | 'in_use' | 'assigned' | 'returned'
  const [selectedEquipment, setSelectedEquipment] = useState(null);
  const [equipmentUsage, setEquipmentUsage] = useState([]);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAssignModalOpen, setIsAssignModalOpen] = useState(false);

  // --- Booking Search State for Assign Modal ---
  const [bookingSearchTerm, setBookingSearchTerm] = useState('');
  const [filteredBookings, setFilteredBookings] = useState([]);
  const [showBookingDropdown, setShowBookingDropdown] = useState(false);

  // --- Live per-item availability for the selected booking's date, inside
  // the Assign modal — so a conflict is visible before clicking Assign,
  // not discovered after. ---
  const [assignDateSnapshot, setAssignDateSnapshot] = useState(null);
  const [assignDateSnapshotLoading, setAssignDateSnapshotLoading] = useState(false);

  const [addFormData, setAddFormData] = useState({
    equipmentName: '',
    quantity: 0,
    damagedQuantity: 0,
    maintenanceQuantity: 0,
    description: '',
    equipmentType: 'Countable',
    paxPerUnit: '',
  });

  const [editFormData, setEditFormData] = useState({
    equipment_id: '',
    eqm_name: '',
    quantity_available: 0,
    damaged_quantity: 0,
    maintenance_quantity: 0,
    eqm_description: '',
    equipment_type: 'Countable',
    pax_per_unit: null,
  });

  const [assignFormData, setAssignFormData] = useState({
    booking_id: '',
    notes: '',
  });
  // True when the modal was opened for one specific event (from the Upcoming
  // tab's per-event Assign button) rather than from the page header. In that
  // case the booking is already decided, so the picker is replaced by a
  // read-only chip — leaving a live search there invites assigning to the
  // wrong event, which is the opposite of what the manager asked for.
  const [assignBookingLocked, setAssignBookingLocked] = useState(false);

  const [assignmentQueue, setAssignmentQueue] = useState([]);
  const [tempEquipId, setTempEquipId] = useState('');
  const [tempQuantity, setTempQuantity] = useState(1);

  // --- Condition is derived from the actual damaged/maintenance counts,
  // never set manually. Shown as a small badge next to the item name
  // instead of its own table column. ---
  const getConditionSummary = (item) => {
    const damaged = item.damaged_quantity || 0;
    const maintenance = item.maintenance_quantity || 0;
    if (damaged > 0 && maintenance > 0) {
      return { label: `${damaged} damaged, ${maintenance} under maintenance`, dbValue: 'Needs Attention', className: 'bg-red-50 border-red-200 text-red-600' };
    }
    if (damaged > 0) {
      return { label: `${damaged} damaged`, dbValue: 'Damaged', className: 'bg-red-50 border-red-200 text-red-600' };
    }
    if (maintenance > 0) {
      return { label: `${maintenance} under maintenance`, dbValue: 'Under Maintenance', className: 'bg-amber-50 border-amber-200 text-amber-700' };
    }
    return { label: 'Good condition', dbValue: 'Good Condition', className: 'bg-[#CBDEDD]/60 border-[#a3c7c4] text-slate-800' };
  };

  // --- Helper: generate structured booking reference ---
  const getBookingRef = (booking) => {
    if (booking.booking_number) return booking.booking_number;
    const prefix = booking.booking_type === 'Short Order' ? 'SO' : 'BKG';
    return `${prefix}-${booking.booking_id.slice(0, 8)}`;
  };

  // --- Jump to the full booking/short order detail page. Accepts either a
  // booking object (booking_id + booking_type) or the two values directly. ---
  const goToBookingDetails = (bookingIdOrBooking, bookingType) => {
    const id = typeof bookingIdOrBooking === 'object' ? bookingIdOrBooking.booking_id : bookingIdOrBooking;
    const type = typeof bookingIdOrBooking === 'object' ? bookingIdOrBooking.booking_type : bookingType;
    if (!id) return;
    navigate(`/app/${type === 'Short Order' ? 'orders' : 'bookings'}/${id}`);
  };

  // --- Shared sortable-column-header renderer, used across every tab's
  // table. A plain function call (not a JSX component) so it doesn't get
  // redefined as a fresh component identity on every render. ---
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

  // --- FETCH DATA (equipment, bookings, all assignments) ---
  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { data: equipData, error: equipError } = await supabase
        .from('equipment')
        .select('*')
        .order('eqm_name');
      if (equipError) throw equipError;
      setEquipmentList(equipData || []);

      // package_id + package name come along for the Upcoming Prep tab,
      // which has to answer "which package is this event, and what does
      // that package require?" — not just "which booking is this?".
      const { data: bookingData, error: bookingError } = await supabase
        .from('booking')
        .select(`
          booking_id, booking_number, booking_type, booking_status, event_datetime, venue, pax_count, notes, package_id,
          customer:customer_id (first_name, last_name, contact_no, cus_address),
          package:package_id (pkg_name)
        `)
        .eq('booking_type', 'Package')
        .in('booking_status', [...ACTIVE_BOOKING_STATUSES, 'Pending'])
        .order('event_datetime', { ascending: true });
      if (bookingError) throw bookingError;
      setBookings(bookingData || []);
      setFilteredBookings(bookingData || []);

      // The whole package→equipment template table. It is small (one row
      // per equipment line per package) and fetching it once here lets the
      // prep view compute required-vs-assigned for every upcoming event
      // client-side, instead of one round trip per booking.
      const { data: pkgEquipData, error: pkgEquipError } = await supabase
        .from('package_equipment')
        .select('package_id, equipment_id, included_quantity, per_pax');
      if (pkgEquipError) throw pkgEquipError;
      setPackageEquipment(pkgEquipData || []);

      const { data: assignData, error: assignError } = await supabase
        .from('booking_equipment')
        .select(`
          *,
          booking:booking_id (
            booking_id, booking_number, booking_type, venue, event_datetime,
            customer:customer_id (first_name, last_name)
          ),
          equipment:equipment_id (eqm_name)
        `)
        .order('assigned_at', { ascending: false });
      if (assignError) throw assignError;
      setAssignments(assignData || []);
    } catch (error) {
      handleError(error, 'Unable to load equipment data. Please refresh the page.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Equipment is shared physical stock, so this page is the one most
  // exposed to two managers working at once — assignments, returns, stock
  // edits and damage flags all change what everyone else can allocate.
  // `booking` is included because a booking moving Pending → Approved →
  // Confirmed changes both what appears in Upcoming and what can still be
  // assigned to.
  useRealtimeRefresh(
    'equipment-page',
    ['equipment', 'booking_equipment', 'package_equipment', 'booking'],
    fetchData
  );

  // --- Recompute the date snapshot whenever the selected date (or the
  // underlying data) changes ---
  const fetchSnapshot = async () => {
    setSnapshotLoading(true);
    try {
      const data = await getDailyEquipmentSnapshot(selectedDate);
      setSnapshot(data);
    } catch (error) {
      handleError(error, 'Unable to load availability for this date.');
      setSnapshot({ items: [], eventsOnDate: [] });
    } finally {
      setSnapshotLoading(false);
    }
  };

  useEffect(() => {
    fetchSnapshot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, equipmentList, assignments]);

  // --- Filter bookings when search term changes ---
  //
  // Approved only — see canAssignEquipmentTo. Two separate reasons:
  //
  // Pending was blocked because booking_equipment has no status column, so
  // such a row appeared in Active Assignments and History while every
  // availability query ignored it (they filter to ACTIVE_BOOKING_STATUSES)
  // — a reservation that held nothing, leaving the same stock free to be
  // promised to a second event.
  //
  // Confirmed is blocked because the booking is locked from that point on;
  // BookingDetails.jsx already refuses the same action there.
  useEffect(() => {
    const assignable = bookings.filter(b => canAssignEquipmentTo(b.booking_status));
    if (!bookingSearchTerm.trim()) {
      setFilteredBookings(assignable);
      return;
    }
    const term = bookingSearchTerm.toLowerCase();
    const filtered = assignable.filter(b => {
      const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}`.toLowerCase() : '';
      const ref = getBookingRef(b).toLowerCase();
      return customerName.includes(term) || ref.includes(term);
    });
    setFilteredBookings(filtered);
  }, [bookingSearchTerm, bookings]);

  const selectedBooking = bookings.find(b => b.booking_id === assignFormData.booking_id);

  // --- Live availability for the selected booking's own event date, shown
  // inside the Assign modal so a shortage is visible before Assign is
  // clicked, not after. ---
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!selectedBooking?.event_datetime) {
        setAssignDateSnapshot(null);
        return;
      }
      setAssignDateSnapshotLoading(true);
      try {
        const dateStr = toDateInputValue(new Date(selectedBooking.event_datetime));
        const data = await getDailyEquipmentSnapshot(dateStr);
        if (!cancelled) setAssignDateSnapshot(data);
      } catch (error) {
        console.error('Assign-modal availability check failed:', error);
        if (!cancelled) setAssignDateSnapshot(null);
      } finally {
        if (!cancelled) setAssignDateSnapshotLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [selectedBooking?.booking_id, selectedBooking?.event_datetime]);

  // --- FETCH USAGE (full history, any date, for the Inventory tab) ---
  const fetchEquipmentUsage = async (equipmentId) => {
    try {
      const { data, error } = await supabase
        .from('booking_equipment')
        .select(`
          *,
          booking:booking_id (
            booking_id, booking_number, venue, event_datetime,
            customer:customer_id (first_name, last_name)
          )
        `)
        .eq('equipment_id', equipmentId)
        .order('assigned_at', { ascending: false });
      if (error) throw error;
      setEquipmentUsage(data || []);
    } catch (error) {
      console.error('Error fetching usage:', error);
      setEquipmentUsage([]);
      toast.error('Unable to load usage history.');
    }
  };

  // --- HANDLERS ---
  const handleAddInputChange = (e) => {
    const { name, value } = e.target;
    setAddFormData(prev => ({
      ...prev,
      [name]: name === 'quantity' || name === 'damagedQuantity' || name === 'maintenanceQuantity'
        ? parseInt(value) || 0
        : name === 'paxPerUnit' ? (value === '' ? '' : parseInt(value) || 0) : value
    }));
    setAddFieldErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({
      ...prev,
      [name]: name === 'quantity_available' || name === 'damaged_quantity' || name === 'maintenance_quantity'
        ? parseInt(value) || 0
        : name === 'pax_per_unit' ? (value === '' ? null : parseInt(value) || 0) : value
    }));
    setEditFieldErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  const handleAssignInputChange = (e) => {
    const { name, value } = e.target;
    setAssignFormData(prev => ({ ...prev, [name]: value }));
  };

  // --- "Damaged or under maintenance" card -> the Inventory tab, filtered ---
  // Sends the manager to the list that can actually fix the problem rather
  // than to a read-only copy of it.
  const showNeedsAttentionInInventory = () => {
    setActiveTableTab('inventory');
    setInventoryNeedsAttentionOnly(true);
    setInventorySearch('');
    setInventoryTypeFilter('All');
    availabilityPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // --- ADD EQUIPMENT ---
  const handleAddEquipment = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setAddFieldErrors({});

    if (!addFormData.equipmentName.trim()) {
      toast.error('Equipment name is required.');
      setAddFieldErrors({ equipmentName: 'Equipment name is required.' });
      setIsSubmitting(false);
      return;
    }
    const qty = parseInt(addFormData.quantity) || 0;
    if (qty < 1) {
      toast.error('Total quantity must be at least 1.');
      setAddFieldErrors({ quantity: 'Must be at least 1.' });
      setIsSubmitting(false);
      return;
    }

    const damaged = parseInt(addFormData.damagedQuantity) || 0;
    const maintenance = parseInt(addFormData.maintenanceQuantity) || 0;

    if (damaged < 0 || maintenance < 0) {
      const msg = 'Cannot be negative.';
      toast.error('Damaged and Maintenance quantities cannot be negative.');
      setAddFieldErrors({ damagedQuantity: damaged < 0 ? msg : undefined, maintenanceQuantity: maintenance < 0 ? msg : undefined });
      setIsSubmitting(false);
      return;
    }

    if (damaged + maintenance > qty) {
      const msg = 'Cannot exceed total quantity.';
      toast.error('Damaged + Maintenance quantities cannot exceed total quantity.');
      setAddFieldErrors({ damagedQuantity: msg, maintenanceQuantity: msg });
      setIsSubmitting(false);
      return;
    }

    const available = qty - damaged - maintenance;

    try {
      const paxPerUnit = addFormData.equipmentType === 'Countable'
        ? (parseInt(addFormData.paxPerUnit) || null)
        : null;

      const { error } = await supabase
        .from('equipment')
        .insert([{
          eqm_name: addFormData.equipmentName.trim(),
          eqm_description: addFormData.description?.trim() || 'No description',
          quantity_available: available,
          damaged_quantity: damaged,
          maintenance_quantity: maintenance,
          eqm_status: getConditionSummary({ damaged_quantity: damaged, maintenance_quantity: maintenance }).dbValue,
          equipment_type: addFormData.equipmentType,
          pax_per_unit: paxPerUnit,
        }]);

      if (error) throw error;

      setIsAddModalOpen(false);
      setAddFormData({
        equipmentName: '',
        quantity: 0,
        damagedQuantity: 0,
        maintenanceQuantity: 0,
        description: '',
        equipmentType: 'Countable',
        paxPerUnit: '',
      });
      toast.success('Equipment added.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to add equipment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- EDIT EQUIPMENT ---
  const handleEditClick = (item) => {
    // The form's "Total Quantity" field means units OWNED, while the column
    // stores usable units — so the two out-of-service counts are added back
    // here and subtracted again on submit. getStockBreakdown owns that sum.
    const { total } = getStockBreakdown(item);
    setEditFormData({
      equipment_id: item.equipment_id,
      eqm_name: item.eqm_name,
      quantity_available: total,
      damaged_quantity: item.damaged_quantity || 0,
      maintenance_quantity: item.maintenance_quantity || 0,
      eqm_description: item.eqm_description || '',
      equipment_type: item.equipment_type || 'Countable',
      pax_per_unit: item.pax_per_unit || null,
    });
    setEditFieldErrors({});
    setIsEditModalOpen(true);
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setEditFieldErrors({});

    if (!editFormData.eqm_name.trim()) {
      toast.error('Equipment name is required.');
      setEditFieldErrors({ eqm_name: 'Equipment name is required.' });
      setIsSubmitting(false);
      return;
    }
    const qty = parseInt(editFormData.quantity_available) || 0;
    if (qty < 0) {
      toast.error('Total quantity cannot be negative.');
      setEditFieldErrors({ quantity_available: 'Cannot be negative.' });
      setIsSubmitting(false);
      return;
    }

    const damaged = parseInt(editFormData.damaged_quantity) || 0;
    const maintenance = parseInt(editFormData.maintenance_quantity) || 0;

    if (damaged < 0 || maintenance < 0) {
      const msg = 'Cannot be negative.';
      toast.error('Damaged and Maintenance quantities cannot be negative.');
      setEditFieldErrors({ damaged_quantity: damaged < 0 ? msg : undefined, maintenance_quantity: maintenance < 0 ? msg : undefined });
      setIsSubmitting(false);
      return;
    }

    if (damaged + maintenance > qty) {
      const msg = 'Cannot exceed total quantity.';
      toast.error('Damaged + Maintenance quantities cannot exceed total quantity.');
      setEditFieldErrors({ damaged_quantity: msg, maintenance_quantity: msg });
      setIsSubmitting(false);
      return;
    }

    const available = qty - damaged - maintenance;

    // Block outright if the new available quantity would fall short of
    // what's genuinely committed on some specific date — see
    // checkEquipmentAvailabilityImpact for why this is date-aware rather
    // than a single global sum.
    try {
      const conflicts = await checkEquipmentAvailabilityImpact(editFormData.equipment_id, available);
      if (conflicts.length > 0) {
        const message = describeEquipmentConflicts(conflicts, available);
        toast.error(message, { duration: 8000 });
        setEditFieldErrors({ damaged_quantity: 'Would cause a shortage — see message.', maintenance_quantity: 'Would cause a shortage — see message.' });
        setIsSubmitting(false);
        return;
      }
    } catch (checkError) {
      console.warn('Committed-quantity check failed:', checkError);
    }

    try {
      const paxPerUnit = editFormData.equipment_type === 'Countable'
        ? (parseInt(editFormData.pax_per_unit) || null)
        : null;

      const { error } = await supabase
        .from('equipment')
        .update({
          eqm_name: editFormData.eqm_name.trim(),
          eqm_description: editFormData.eqm_description?.trim() || '',
          quantity_available: available,
          damaged_quantity: damaged,
          maintenance_quantity: maintenance,
          eqm_status: getConditionSummary({ damaged_quantity: damaged, maintenance_quantity: maintenance }).dbValue,
          equipment_type: editFormData.equipment_type,
          pax_per_unit: paxPerUnit,
        })
        .eq('equipment_id', editFormData.equipment_id);

      if (error) throw error;

      setIsEditModalOpen(false);
      toast.success('Equipment saved.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to update equipment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- FLAG ISSUE (quick damaged/maintenance shortcut) ---
  const handleFlagIssueClick = (item) => {
    setFlagIssueItem(item);
    setFlagIssueForm({
      damaged_quantity: item.damaged_quantity || 0,
      maintenance_quantity: item.maintenance_quantity || 0,
    });
    setFlagIssueErrors({});
    setIsFlagIssueModalOpen(true);
  };

  const handleFlagIssueInputChange = (e) => {
    const { name, value } = e.target;
    setFlagIssueForm(prev => ({ ...prev, [name]: parseInt(value) || 0 }));
    setFlagIssueErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
  };

  const handleFlagIssueSubmit = async (e) => {
    e.preventDefault();
    if (!flagIssueItem) return;
    setFlagIssueErrors({});

    const { total } = getStockBreakdown(flagIssueItem);
    const damaged = parseInt(flagIssueForm.damaged_quantity) || 0;
    const maintenance = parseInt(flagIssueForm.maintenance_quantity) || 0;

    if (damaged < 0 || maintenance < 0) {
      const msg = 'Cannot be negative.';
      toast.error('Damaged and maintenance quantities cannot be negative.');
      setFlagIssueErrors({ damaged_quantity: damaged < 0 ? msg : undefined, maintenance_quantity: maintenance < 0 ? msg : undefined });
      return;
    }

    if (damaged + maintenance > total) {
      const msg = `Cannot exceed the total stock of ${total}.`;
      toast.error(`Damaged + maintenance cannot exceed the total stock (${total}).`);
      setFlagIssueErrors({ damaged_quantity: msg, maintenance_quantity: msg });
      return;
    }

    const available = total - damaged - maintenance;
    setIsSubmitting(true);

    // Same date-accurate blocking check as the full Edit flow.
    try {
      const conflicts = await checkEquipmentAvailabilityImpact(flagIssueItem.equipment_id, available);
      if (conflicts.length > 0) {
        const message = describeEquipmentConflicts(conflicts, available);
        toast.error(message, { duration: 8000 });
        setFlagIssueErrors({ damaged_quantity: 'Would cause a shortage — see message.', maintenance_quantity: 'Would cause a shortage — see message.' });
        setIsSubmitting(false);
        return;
      }
    } catch (checkError) {
      console.warn('Committed-quantity check failed:', checkError);
    }

    try {
      const { error } = await supabase
        .from('equipment')
        .update({
          quantity_available: available,
          damaged_quantity: damaged,
          maintenance_quantity: maintenance,
          eqm_status: getConditionSummary({ damaged_quantity: damaged, maintenance_quantity: maintenance }).dbValue,
        })
        .eq('equipment_id', flagIssueItem.equipment_id);
      if (error) throw error;

      setIsFlagIssueModalOpen(false);
      toast.success('Equipment condition updated.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to update equipment condition.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- DELETE EQUIPMENT ---
  const handleDeleteEquipment = async (id) => {
    // Establish whether the delete is even permitted BEFORE asking anything.
    // These are two cheap counts; running them last meant a manager could
    // confirm a destructive action and re-type their password only to be told
    // the delete was never possible in the first place.
    try {
      const { count, error: countError } = await supabase
        .from('booking_equipment')
        .select('*', { count: 'exact', head: true })
        .eq('equipment_id', id)
        .eq('returned', false);
      if (countError) throw countError;
      if (count > 0) {
        toast.error(`This equipment is out at ${count} event${count === 1 ? '' : 's'} right now. Mark it returned before deleting it.`);
        return;
      }

      // Also block on RETURNED (historical) assignments, not just active
      // ones — without this check, deleting equipment that was used and
      // returned in the past either fails with a raw foreign-key error or
      // (if the DB cascades) silently wipes its record from the History tab.
      const { count: historyCount, error: historyCountError } = await supabase
        .from('booking_equipment')
        .select('*', { count: 'exact', head: true })
        .eq('equipment_id', id);
      if (historyCountError) throw historyCountError;
      if (historyCount > 0) {
        toast.error(`This equipment has ${historyCount} assignment record${historyCount === 1 ? '' : 's'} in its history. Deleting it would erase that record — flag it Under Maintenance instead if it is out of service.`);
        return;
      }

      const { count: pkgCount, error: pkgCountError } = await supabase
        .from('package_equipment')
        .select('*', { count: 'exact', head: true })
        .eq('equipment_id', id);
      if (pkgCountError) throw pkgCountError;
      if (pkgCount > 0) {
        toast.error(`This equipment is part of ${pkgCount} package template${pkgCount === 1 ? '' : 's'}. Remove it from those packages before deleting it.`);
        return;
      }

      // Only now that the delete is known to be possible is it worth spending
      // the manager's attention on a confirmation and a password.
      const confirmed = await showConfirm({
        title: 'Delete this equipment?',
        message: 'This removes the item from the inventory permanently. It cannot be undone.',
        confirmLabel: 'Delete',
        confirmVariant: 'danger',
      });
      if (!confirmed) return;

      const passwordOk = await requestPasswordConfirm({
        title: 'Confirm your password',
        message: 'Deleting equipment is permanent. Re-enter your password to continue.',
      });
      if (!passwordOk) return;

      const { error } = await supabase
        .from('equipment')
        .delete()
        .eq('equipment_id', id);
      if (error) throw error;

      toast.success('Equipment deleted.');
      await fetchData();
    } catch (error) {
      // Postgres foreign-key violation (23503) — a last-resort net in case
      // a reference was created between the checks above and this delete.
      if (error?.code === '23503') {
        handleError(error, 'Cannot delete this equipment because other records still reference it.');
        return;
      }
      handleError(error, 'Failed to delete equipment.');
    }
  };

  // --- QUEUE FUNCTIONS ---
  const eventDateLabel = selectedBooking?.event_datetime
    ? new Date(selectedBooking.event_datetime).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    : 'that date';

  // How many units of an item are free ON THE SELECTED BOOKING'S EVENT DATE.
  //
  // Extracted so the equipment dropdown and addToQueue's validation read the
  // same number. They previously didn't: the dropdown printed
  // `quantity_available` (total usable stock, date-blind) while the validator
  // compared against the date snapshot's `free`. A manager picking from a list
  // that said "100 in stock" was then refused at 20 because 80 were already
  // promised to another event that day — the UI advertised one number and
  // enforced another.
  //
  // Returns null when a date-scoped answer isn't available yet (no booking
  // chosen, or the snapshot still loading), so callers can say so rather than
  // silently falling back to a stock figure that means something else.
  const freeOnDateFor = (equipmentId) => {
    if (!equipmentId) return null;
    const dateRow = assignDateSnapshot?.items?.find(i => i.equipment_id === equipmentId);
    if (!dateRow) return null;
    const base = getStockBreakdown(dateRow).free;
    // Items already queued in this modal aren't saved yet, so the snapshot
    // can't know about them — subtract them or the list would keep offering
    // units the manager has already spoken for in this same session.
    const queued = assignmentQueue
      .filter(q => q.equipment_id === equipmentId)
      .reduce((sum, q) => sum + (q.quantity || 0), 0);
    return Math.max(0, base - queued);
  };

  const addToQueue = () => {
    // Booking first, always. Everything below depends on it: the capacity
    // check is scoped to that booking's event date, the pax-based quantity
    // suggestion reads its pax_count, and the duplicate check is per booking.
    // Without one, items could be queued against no date at all and validated
    // against total stock — a number that means something different from the
    // one they'd actually be checked against on submit.
    if (!selectedBooking) {
      toast.error('Select a booking first — equipment is checked against that event’s date.');
      return;
    }
    if (!tempEquipId) {
      toast.error('Please select equipment.');
      return;
    }
    if (tempQuantity < 1) {
      toast.error('Quantity must be at least 1.');
      return;
    }
    const existing = assignmentQueue.find(item => item.equipment_id === tempEquipId);
    if (existing) {
      toast.error('This equipment is already in the list.');
      return;
    }
    const equip = equipmentList.find(e => e.equipment_id === tempEquipId);
    if (!equip) {
      toast.error('Equipment not found.');
      return;
    }

    // Check against what is free ON THE EVENT'S DATE, not against total usable
    // stock. Comparing to stock alone let a manager queue 20 chairs when 18 of
    // them were already promised to another event that day, and the shortage
    // only surfaced at submit — after the whole list had been built.
    // Same helper the dropdown displays from, so what was offered and what is
    // accepted are by construction the same number.
    const dateAwareFree = freeOnDateFor(tempEquipId);
    const freeOnDate = dateAwareFree !== null ? dateAwareFree : getStockBreakdown(equip).usable;
    if (tempQuantity > freeOnDate) {
      toast.error(
        dateAwareFree !== null
          ? `Only ${freeOnDate} "${equip.eqm_name}" free on ${eventDateLabel} — the rest are already committed to other events that day.`
          : `Only ${freeOnDate} "${equip.eqm_name}" usable — can't assign ${tempQuantity}.`
      );
      return;
    }

    if (selectedBooking) {
      const alreadyAssigned = assignments.some(a =>
        a.booking_id === selectedBooking.booking_id &&
        a.equipment_id === tempEquipId &&
        !a.returned
      );
      if (alreadyAssigned) {
        toast.error(`"${equip.eqm_name}" is already assigned to this booking. Return it first.`);
        return;
      }
    }

    setAssignmentQueue([...assignmentQueue, { equipment_id: tempEquipId, quantity: tempQuantity }]);
    setTempEquipId('');
    setTempQuantity(1);
  };

  const removeFromQueue = (equipment_id) => {
    setAssignmentQueue(assignmentQueue.filter(item => item.equipment_id !== equipment_id));
  };

  // --- ASSIGN EQUIPMENT (Multiple) ---
  const handleAssignSubmit = async (e) => {
    e.preventDefault();
    if (assignmentQueue.length === 0) {
      toast.error('Please add at least one equipment to assign.');
      return;
    }
    if (!assignFormData.booking_id) {
      toast.error('Please select a booking.');
      return;
    }

    // Enforced here as well as in the picker, matching how
    // BookingDetails.jsx guards its own equipment actions. The picker only
    // hides ineligible bookings; a selection made before a status changed
    // (another manager confirms it while this modal is open) would
    // otherwise still submit.
    const targetBooking = bookings.find(b => b.booking_id === assignFormData.booking_id);
    if (targetBooking && !canAssignEquipmentTo(targetBooking.booking_status)) {
      toast.error(
        targetBooking.booking_status === 'Pending'
          ? "This booking is still Pending — approve it first, which allocates its package equipment automatically."
          : `Equipment can't be assigned anymore — this booking is ${targetBooking.booking_status}.`
      );
      return;
    }

    // Quantity-aware capacity check — equipment isn't exclusive to one event
    // per day, there's just a finite amount of it. Sum what's already
    // committed to OTHER bookings on the same date and make sure adding
    // this request wouldn't exceed total stock.
    //
    // Read fresh from the database rather than from this page's `assignments`
    // snapshot: two managers assigning the same stock both passed the old
    // local check against their own stale copies, and both inserts went
    // through. Realtime keeps the page fresher but can't fix this on its own,
    // because the check and the insert remain separate steps.
    const eventDate = selectedBooking?.event_datetime ? new Date(selectedBooking.event_datetime) : null;
    setIsSubmitting(true);
    if (eventDate) {
      try {
        const violations = await revalidateAssignmentCapacity(
          eventDate,
          assignFormData.booking_id,
          assignmentQueue.map(i => ({ equipment_id: i.equipment_id, quantity: i.quantity }))
        );
        if (violations.length > 0) {
          const v = violations[0];
          toast.error(
            `"${v.name}": ${v.alreadyCommitted} already committed to other events on ${eventDate.toLocaleDateString()}, ` +
            `plus ${v.requested} requested exceeds the ${v.available} in stock.` +
            (violations.length > 1 ? ` (${violations.length - 1} other item${violations.length > 2 ? 's' : ''} also over capacity.)` : '')
          );
          setIsSubmitting(false);
          // Someone else's change is why this failed — pull it in so the
          // manager sees the real numbers instead of the stale ones that
          // let them build this queue.
          fetchData();
          return;
        }
      } catch (capacityError) {
        console.error('Capacity revalidation failed:', capacityError);
        toast.error('Could not verify equipment availability. Please try again.');
        setIsSubmitting(false);
        return;
      }
    }

    try {
      const itemsToAssign = [];
      for (const item of assignmentQueue) {
        const equip = equipmentList.find(e => e.equipment_id === item.equipment_id);
        if (!equip) throw new Error(`Equipment ID ${item.equipment_id} not found.`);

        // Fresh DB check, not the local `assignments` snapshot — that state
        // can be stale (another tab/session assigned this since our last
        // fetch), and a stale check here would let a duplicate active
        // assignment row slip through.
        const { count: dupCount, error: dupError } = await supabase
          .from('booking_equipment')
          .select('*', { count: 'exact', head: true })
          .eq('booking_id', assignFormData.booking_id)
          .eq('equipment_id', item.equipment_id)
          .eq('returned', false);
        if (dupError) throw dupError;
        if (dupCount > 0) {
          throw new Error(`"${equip.eqm_name}" is already assigned to this booking. Please return it first.`);
        }
        itemsToAssign.push({ ...item, equip });
      }

      for (const item of itemsToAssign) {
        const { error: insertError } = await supabase
          .from('booking_equipment')
          .insert([{
            booking_id: assignFormData.booking_id,
            equipment_id: item.equipment_id,
            quantity: item.quantity,
            notes: assignFormData.notes || null,
            returned: false,
          }]);
        if (insertError) throw insertError;
      }

      setAssignmentQueue([]);
      setIsAssignModalOpen(false);
      setAssignFormData({ booking_id: '', notes: '' });
      setBookingSearchTerm('');
      setShowBookingDropdown(false);
      setAssignBookingLocked(false);
      toast.success(`Assigned ${itemsToAssign.length} equipment item(s).`);
      await fetchData();
    } catch (error) {
      handleError(error, error.message || 'Failed to assign equipment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- RETURN EQUIPMENT (single) ---
  const handleReturnEquipment = async (assignmentId) => {
    const assignment = assignments.find(a => a.assignment_id === assignmentId);
    const { canReturn, opensAt } = getReturnAvailability(assignment?.booking?.event_datetime);
    if (!canReturn) {
      toast.error(`Too early to return this. Returns open 3 hours after the event starts, at ${formatReturnOpensAt(opensAt)}.`);
      return;
    }

    const confirmed = await showConfirm({
      title: 'Return Equipment?',
      message: 'Are you sure you want to mark this equipment as returned?',
      confirmLabel: 'Return',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('booking_equipment')
        .update({ returned: true, returned_at: new Date().toISOString() })
        .eq('assignment_id', assignmentId);
      if (error) throw error;

      toast.success('Equipment returned.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to return equipment.');
    }
  };

  // --- RETURN ALL ITEMS FOR ONE EVENT ---
  const handleReturnAllForBooking = async (bookingId, itemCount) => {
    const sampleAssignment = assignments.find(a => a.booking_id === bookingId);
    const { canReturn, opensAt } = getReturnAvailability(sampleAssignment?.booking?.event_datetime);
    if (!canReturn) {
      toast.error(`Too early to return these. Returns open 3 hours after the event starts, at ${formatReturnOpensAt(opensAt)}.`);
      return;
    }

    const confirmed = await showConfirm({
      title: 'Return All Items?',
      message: `Mark all ${itemCount} item${itemCount !== 1 ? 's' : ''} for this event as returned?`,
      confirmLabel: 'Return All',
      confirmVariant: 'success',
    });
    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from('booking_equipment')
        .update({ returned: true, returned_at: new Date().toISOString() })
        .eq('booking_id', bookingId)
        .eq('returned', false);
      if (error) throw error;

      toast.success('All equipment for this event returned.');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to return items.');
    }
  };

  // --- VIEW USAGE ---
  const handleViewUsage = async (item) => {
    setSelectedEquipment(item);
    setUsageStatusFilter('All'); // fresh view per item, not the last one's filter
    await fetchEquipmentUsage(item.equipment_id);
    setIsUsageModalOpen(true);
  };

  // ============================================================
  // --- PER-ITEM USAGE: stage, filter, order ---
  // ============================================================
  // The query returns rows newest-assigned-first, which interleaves records
  // still out with ones returned months ago — so the rows that can still be
  // acted on were scattered through the list.
  //
  // Ordered by stage instead, using the same getAssignmentStatus the
  // Active Assignments and History tabs use so the three can't disagree:
  //   In Use   — the event is happening or has happened, still not returned
  //   Assigned — reserved for an event still ahead
  //   Returned — closed, history
  const usageRecords = equipmentUsage.map(r => ({
    ...r,
    stage: getAssignmentStatus(r.returned, r.booking?.event_datetime),
  }));

  const usageStageCounts = {
    All: usageRecords.length,
    in_use: usageRecords.filter(r => r.stage.key === 'in_use').length,
    assigned: usageRecords.filter(r => r.stage.key === 'assigned').length,
    returned: usageRecords.filter(r => r.stage.key === 'returned').length,
  };

  const stageRank = (key) => (key === 'in_use' ? 0 : key === 'assigned' ? 1 : 2);

  const visibleUsageRecords = usageRecords
    .filter(r => usageStatusFilter === 'All' || r.stage.key === usageStatusFilter)
    .sort((a, b) => {
      const byStage = stageRank(a.stage.key) - stageRank(b.stage.key);
      if (byStage !== 0) return byStage;
      if (a.stage.key === 'returned') {
        // Closed records: most recently returned first — recent history is
        // the part anyone actually looks back at.
        return new Date(b.returned_at || b.assigned_at || 0) - new Date(a.returned_at || a.assigned_at || 0);
      }
      // Still open: earliest event first. For In Use that surfaces the
      // longest-outstanding item (the most overdue); for Assigned it is the
      // one coming up next.
      return new Date(a.booking?.event_datetime || 0) - new Date(b.booking?.event_datetime || 0);
    });

  const availabilityPanelRef = useRef(null);

  // ============================================================
  // --- STOCK TOTALS ---
  // ============================================================
  // usableStockAll, not "total stock": it excludes anything flagged damaged or
  // under maintenance, which is exactly why Available can be well below the
  // number of units the business owns.
  const usableStockAll = equipmentList.reduce((sum, eq) => sum + (eq.quantity_available || 0), 0);
  const ownedStockAll = equipmentList.reduce((sum, eq) => sum + getStockBreakdown(eq).total, 0);
  const unitsCommitted = snapshot.items.reduce((sum, item) => sum + (item.committed || 0), 0);
  const unitsFree = usableStockAll - unitsCommitted;
  const needsAttentionUnits = equipmentList.reduce((sum, eq) => sum + (eq.damaged_quantity || 0) + (eq.maintenance_quantity || 0), 0);

  // "Now", not the date selected in the Availability tab: overdue asks "is
  // anything late right now", not "late relative to whatever date I am
  // browsing". Overdue itself is worked out once, in assignmentGroups below,
  // against the 24-hour return deadline from the RETURN POLICY block at the
  // top of this file — never against the event date, which would flag an item
  // overdue while its Return button was still locked.
  const now = new Date();

  // ============================================================
  // --- UPCOMING PREP: what each upcoming event needs vs what it has ---
  // ============================================================
  // The panel's point was that "total units owned" is not a number a
  // manager can act on — knowing the business owns 500 chairs says nothing
  // about whether next Saturday's event is ready. What they actually need
  // is, per upcoming event: which package it is, what that package
  // requires at this pax count, what has actually been assigned, and
  // therefore what is still missing.
  //
  // Required comes from the package template via deriveEquipmentDemand —
  // the same rule allocateEquipmentForBooking uses, so "required" here can
  // never drift from what the Assign action would allocate.
  const equipmentById = {};
  equipmentList.forEach(eq => { equipmentById[eq.equipment_id] = eq; });

  const templateByPackage = {};
  packageEquipment.forEach(row => {
    (templateByPackage[row.package_id] ||= []).push(row);
  });

  const PREP_HORIZON_DAYS = 14;
  const prepHorizonEnd = new Date(now.getTime() + PREP_HORIZON_DAYS * 24 * 60 * 60 * 1000);

  const isInPrepWindow = (b) => {
    if (!b.event_datetime) return false;
    const ev = new Date(b.event_datetime);
    // Events that already happened are the Active Assignments tab's job
    // (returns), not prep. Horizon keeps this to what's actionable.
    return ev >= now && ev <= prepHorizonEnd;
  };

  // Pending is deliberately excluded. A pending booking is still an
  // inquiry the manager hasn't accepted — equipment is allocated by
  // allocateEquipmentForBooking at the moment of APPROVAL
  // (useApprovalHandlers), so a pending event has no allocation yet by
  // design, not by oversight. Listing it here would report every pending
  // request as "N units short" and make the prep count read as work
  // outstanding when the real next step is to approve or reject it.
  //
  // This also matches the rule the rest of the equipment logic already
  // follows: every availability query in utils/equipment.jsx filters on
  // ACTIVE_BOOKING_STATUSES, per the note on that constant.
  // What one booking's package calls for, what is actually assigned against
  // it, and therefore what is still missing.
  //
  // Extracted from upcomingPrep so the Assign modal can ask the same question
  // about any booking a manager searches for, not just the ones inside the
  // 14-day prep horizon. One definition, two callers — the modal can never
  // tell a manager a booking needs something the prep view says it doesn't.
  const getBookingEquipmentLines = (b) => {
    if (!b) return { lines: [], shortLines: [], unitsShort: 0, hasTemplate: false, totalAssignedUnits: 0, isReady: true };

    const required = deriveEquipmentDemand(templateByPackage[b.package_id] || [], equipmentById, b.pax_count);

    // Only unreturned rows count as "assigned for this event" — a row
    // already returned is history, not preparation.
    const assignedByEquipment = {};
    assignments
      .filter(a => a.booking_id === b.booking_id && !a.returned)
      .forEach(a => {
        assignedByEquipment[a.equipment_id] = (assignedByEquipment[a.equipment_id] || 0) + (a.quantity || 0);
      });

    // Union of both sides: an item can be required but unassigned, or
    // assigned as an extra the package template never listed. Showing
    // only the template would hide the second kind entirely.
    const allIds = [...new Set([...Object.keys(required), ...Object.keys(assignedByEquipment)])];
    const lines = allIds.map(id => {
      const req = required[id] || 0;
      const got = assignedByEquipment[id] || 0;
      return {
        equipment_id: id,
        name: equipmentById[id]?.eqm_name || 'Unknown item',
        required: req,
        assigned: got,
        short: Math.max(0, req - got),
        extra: Math.max(0, got - req),
      };
    }).sort((a, b2) => (b2.short - a.short) || a.name.localeCompare(b2.name));

    const shortLines = lines.filter(l => l.short > 0);
    return {
      lines,
      shortLines,
      unitsShort: shortLines.reduce((sum, l) => sum + l.short, 0),
      hasTemplate: (templateByPackage[b.package_id] || []).length > 0,
      totalAssignedUnits: Object.values(assignedByEquipment).reduce((s, n) => s + n, 0),
      isReady: shortLines.length === 0,
    };
  };

  // The selected booking's equipment plan: what its package calls for, what is
  // already allocated against it, and what is therefore still missing. Same
  // helper the Upcoming tab uses, so the modal cannot tell a manager a booking
  // needs something the prep view says it does not.
  const assignPlan = getBookingEquipmentLines(selectedBooking);
  // Shortfalls not already sitting in this session's queue.
  const unqueuedShortLines = assignPlan.shortLines.filter(
    l => !assignmentQueue.some(q => q.equipment_id === l.equipment_id)
  );

  // Queue every missing item at exactly its shortfall. This is the
  // anti-overlap path: it can only ever add what the template still calls for,
  // so it cannot double up on what approval already allocated.
  const queueAllMissing = () => {
    if (!selectedBooking) {
      toast.error('Select a booking first.');
      return;
    }
    const additions = [];
    const skipped = [];
    unqueuedShortLines.forEach(l => {
      // Never offer more than is actually free on the event's date -- the same
      // date-scoped number the picker and the submit check both use.
      const free = freeOnDateFor(l.equipment_id);
      const cap = free !== null ? free : l.short;
      const take = Math.min(l.short, cap);
      if (take > 0) additions.push({ equipment_id: l.equipment_id, quantity: take });
      if (take < l.short) skipped.push(`${l.name} (${l.short - take} still uncovered)`);
    });
    if (additions.length === 0) {
      toast.error('Nothing can be added — the missing items are already committed to other events on this date.');
      return;
    }
    setAssignmentQueue([...assignmentQueue, ...additions]);
    if (skipped.length > 0) {
      toast.error(`Added what is free on this date. Still uncovered: ${skipped.join(', ')}.`);
    }
  };

  const upcomingPrep = bookings
    .filter(b => ACTIVE_BOOKING_STATUSES.includes(b.booking_status) && isInPrepWindow(b))
    .map(b => ({
      ...b,
      ...getBookingEquipmentLines(b),
      canAssign: canAssignEquipmentTo(b.booking_status),
      daysUntil: Math.ceil((new Date(b.event_datetime) - now) / (24 * 60 * 60 * 1000)),
    }));

  // ============================================================
  // --- PREP, GROUPED BY DAY ---
  // ============================================================
  // Per-booking "units short" turned out to be a dead signal: approval runs
  // allocateEquipmentForBooking over the whole package template, so for any
  // Approved/Confirmed booking assigned == required by construction, and
  // isReady is always true. A card counting those was structurally always
  // zero.
  //
  // The question that ISN'T answered anywhere, and that a manager actually
  // prepares against, is per-DAY: several events share one pool of stock, so
  // "can we physically cover everything happening that day" is a cross-event
  // question no single booking can answer. Prep also happens per day — you
  // stage one van-load for the day, not per booking.
  const prepDays = (() => {
    const byDay = {};
    upcomingPrep.forEach(ev => {
      const d = new Date(ev.event_datetime);
      const key = toDateInputValue(d);
      if (!byDay[key]) {
        byDay[key] = { dateKey: key, date: new Date(d.getFullYear(), d.getMonth(), d.getDate()), events: [] };
      }
      byDay[key].events.push(ev);
    });

    return Object.values(byDay)
      .map(day => {
        // What actually leaves the warehouse that day, summed across every
        // event on it. Assigned units only — required-but-unassigned is not
        // something anyone can load onto a van.
        const totals = {};
        day.events.forEach(ev => ev.lines.forEach(l => {
          if (l.assigned > 0) totals[l.equipment_id] = (totals[l.equipment_id] || 0) + l.assigned;
        }));

        const items = Object.entries(totals)
          .map(([id, needed]) => {
            const eq = equipmentById[id];
            const usable = eq?.quantity_available || 0;
            return {
              equipment_id: id,
              name: eq?.eqm_name || 'Unknown item',
              needed,
              usable,
              short: Math.max(0, needed - usable),
            };
          })
          .sort((a, b2) => (b2.short - a.short) || b2.needed - a.needed);

        const shortages = items.filter(i => i.short > 0);
        day.events.sort((a, b2) => new Date(a.event_datetime) - new Date(b2.event_datetime));

        return {
          ...day,
          items,
          shortages,
          totalUnits: items.reduce((s, i) => s + i.needed, 0),
          isToday: day.dateKey === todayISO(),
          isTomorrow: day.dateKey === tomorrowISO(),
        };
      })
      .sort((a, b2) => a.date - b2.date);
  })();

  // Days where committed stock exceeds what we own and can use — the real
  // preparation risk, and unlike per-booking shortage it can genuinely occur
  // (units flagged damaged after allocation, or an allocation made when the
  // date was clear).
  const overCapacityDays = prepDays.filter(d => d.shortages.length > 0);
  const nextEvent = upcomingPrep.length > 0
    ? [...upcomingPrep].sort((a, b2) => new Date(a.event_datetime) - new Date(b2.event_datetime))[0]
    : null;

  // Shown as a read-only note on the Upcoming tab, not as prep work:
  // these are requests waiting on an approve/reject decision, and that
  // decision — not equipment — is the next action.
  //
  // Deliberately NOT limited to the 14-day prep horizon. A pending request
  // whose event date has already passed is more urgent than one next week —
  // it was never actioned at all — so a forward-only window hid exactly the
  // cases most needing a decision. (It hid BKG-080, whose event was
  // yesterday, which is why this read "1 pending" against 2 real ones.)
  //
  // Package bookings only, matching the rest of this page: short orders
  // carry no equipment at all, so they are not this page's concern.
  const pendingBookings = bookings
    .filter(b => b.booking_status === 'Pending')
    .sort((a, b2) => new Date(a.event_datetime || 0) - new Date(b2.event_datetime || 0));
  const pendingPastDue = pendingBookings.filter(b => b.event_datetime && new Date(b.event_datetime) < now);

  const selectedDateObj = new Date(`${selectedDate}T00:00:00`);
  const isSelectedToday = selectedDate === todayISO();
  const isSelectedTomorrow = selectedDate === tomorrowISO();
  const selectedDateLabel = selectedDateObj.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
    + (isSelectedToday ? ' (Today)' : isSelectedTomorrow ? ' (Tomorrow)' : '');

  // Full equipment list per event on the selected date, including returned
  // items — powers the "Events on this date" modal so a booking's complete
  // equipment picture (assigned / returned) is visible in one place, not
  // just the ones still out.
  const eventEquipmentMap = {};
  snapshot.eventsOnDate.forEach(ev => {
    eventEquipmentMap[ev.booking_id] = assignments
      .filter(a => a.booking_id === ev.booking_id)
      .map(a => ({
        assignment_id: a.assignment_id,
        eqm_name: a.equipment?.eqm_name || 'Unknown',
        quantity: a.quantity,
        returned: a.returned,
      }));
  });

  // ============================================================
  // --- AVAILABILITY TAB: status + sort ---
  // ============================================================
  // These labels describe how much stock is COMMITTED, not how much is left,
  // which is why the old wording read backwards: "Almost full" fired when an
  // item was nearly all promised out — i.e. nearly gone — but plainly reads as
  // "plenty in stock", the opposite of what it means. "None left" said stock
  // had vanished when it is only spoken for, and "Overbooked!" put an
  // exclamation mark in a data label without saying by how much.
  //
  // The shortfall is now named: "Short by 12" tells the manager what to fix.
  // Keys are unchanged — filters, sorting and row highlighting key off those,
  // not off the label text.
  // Measured against USABLE stock, never the total owned: damaged and
  // under-maintenance units cannot be sent to an event, so counting them here
  // would report an item as fine while the usable half of it is already
  // promised elsewhere.
  const getAvailabilityStatus = (item) => {
    const { usable, committed, free } = getStockBreakdown(item);
    if (committed > usable) return { key: 'overbooked', label: `Short by ${committed - usable}`, rank: 0, barColor: 'bg-red-600', textColor: 'text-red-700', pillClass: 'bg-red-100 border-red-300 text-red-700' };
    // Every unit owned is damaged or under maintenance. Nothing can go out,
    // which is emphatically not "Available" — but with both later checks
    // guarded on `usable > 0`, that is exactly what this used to fall
    // through to: a green Available pill on an item with zero usable stock.
    // Grouped under the 'fully' key so it lands in the existing warning
    // filter bucket rather than the healthy one.
    if (usable === 0) return { key: 'fully', label: 'None usable', rank: 1, barColor: 'bg-slate-400', textColor: 'text-slate-600', pillClass: 'bg-slate-200 border-slate-300 text-slate-700' };
    if (usable > 0 && free === 0) return { key: 'fully', label: 'Fully committed', rank: 1, barColor: 'bg-amber-500', textColor: 'text-amber-700', pillClass: 'bg-amber-100 border-amber-300 text-amber-700' };
    if (usable > 0 && free / usable < 0.2) return { key: 'tight', label: 'Low stock', rank: 1, barColor: 'bg-amber-500', textColor: 'text-amber-700', pillClass: 'bg-amber-100 border-amber-300 text-amber-700' };
    return { key: 'available', label: 'Available', rank: 2, barColor: 'bg-emerald-500', textColor: 'text-emerald-700', pillClass: 'bg-emerald-100 border-emerald-300 text-emerald-700' };
  };

  const sortedAvailabilityItems = [...snapshot.items].sort((a, b) => {
    const rankA = getAvailabilityStatus(a).rank;
    const rankB = getAvailabilityStatus(b).rank;
    if (rankA !== rankB) return rankA - rankB;
    return a.eqm_name.localeCompare(b.eqm_name);
  });

  const availabilityStatusCounts = {
    overbooked: sortedAvailabilityItems.filter(i => getAvailabilityStatus(i).key === 'overbooked').length,
    tight: sortedAvailabilityItems.filter(i => ['tight', 'fully'].includes(getAvailabilityStatus(i).key)).length,
    available: sortedAvailabilityItems.filter(i => getAvailabilityStatus(i).key === 'available').length,
  };

  const filteredAvailabilityItems = sortedAvailabilityItems.filter(item => {
    if (availabilityTypeFilter !== 'All' && item.equipment_type !== availabilityTypeFilter) return false;
    const statusKey = getAvailabilityStatus(item).key;
    if (availabilityStatusFilter === 'tight' && !['tight', 'fully'].includes(statusKey)) return false;
    if (availabilityStatusFilter !== 'All' && availabilityStatusFilter !== 'tight' && statusKey !== availabilityStatusFilter) return false;
    if (availabilitySearch) {
      const term = availabilitySearch.toLowerCase();
      if (!item.eqm_name.toLowerCase().includes(term)) return false;
    }
    return true;
  });

  const activeAvailabilityFilterCount = (availabilitySearch.trim() ? 1 : 0) + (availabilityTypeFilter !== 'All' ? 1 : 0) + (availabilityStatusFilter !== 'All' ? 1 : 0);

  // A manual sort choice overrides the default problems-first ordering;
  // with no choice made, the problems-first sort from sortedAvailabilityItems
  // (already applied above) stands.
  const sortedFilteredAvailabilityItems = availabilitySort.field
    ? [...filteredAvailabilityItems].sort((a, b) => {
        let result = 0;
        if (availabilitySort.field === 'name') result = a.eqm_name.localeCompare(b.eqm_name);
        else if (availabilitySort.field === 'free') result = a.free - b.free;
        return availabilitySort.direction === 'asc' ? result : -result;
      })
    : filteredAvailabilityItems;

  // ============================================================
  // --- INVENTORY TAB: search + type filter ---
  // ============================================================
  const filteredInventory = equipmentList.filter(item => {
    // Set by the sidebar's Needs Attention panel, so that panel leads to the
    // one list that can actually act on the problem instead of to a read-only
    // copy of it.
    if (inventoryNeedsAttentionOnly && !((item.damaged_quantity || 0) + (item.maintenance_quantity || 0) > 0)) return false;
    if (inventoryTypeFilter !== 'All' && item.equipment_type !== inventoryTypeFilter) return false;
    if (inventorySearch) {
      const term = inventorySearch.toLowerCase();
      if (!item.eqm_name.toLowerCase().includes(term) && !(item.eqm_description || '').toLowerCase().includes(term)) return false;
    }
    return true;
  });

  const activeInventoryFilterCount = (inventorySearch.trim() ? 1 : 0) + (inventoryTypeFilter !== 'All' ? 1 : 0) + (inventoryNeedsAttentionOnly ? 1 : 0);

  const sortedFilteredInventory = inventorySort.field
    ? [...filteredInventory].sort((a, b) => {
        const result = a.eqm_name.localeCompare(b.eqm_name);
        return inventorySort.direction === 'asc' ? result : -result;
      })
    : filteredInventory;

  // ============================================================
  // --- ACTIVE ASSIGNMENTS: group by event ---
  // ============================================================
  const activeAssignmentRows = assignments.filter(a => !a.returned);
  const assignmentGroupsMap = {};
  activeAssignmentRows.forEach(a => {
    const bId = a.booking_id;
    if (!assignmentGroupsMap[bId]) {
      assignmentGroupsMap[bId] = {
        booking_id: bId,
        booking: a.booking,
        items: [],
        totalUnits: 0,
      };
    }
    assignmentGroupsMap[bId].items.push(a);
    assignmentGroupsMap[bId].totalUnits += (a.quantity || 0);
  });

  const assignmentGroups = Object.values(assignmentGroupsMap).map(g => {
    const eventDate = g.booking?.event_datetime ? new Date(g.booking.event_datetime) : null;
    // Overdue is anchored to the 24h return deadline, not the event date
    // itself — see RETURN POLICY at the top of this file. Using the event
    // date meant an item could be flagged Overdue while its Return button
    // was still locked (which only opens at event + 3h).
    const dueAt = getReturnDueAt(g.booking?.event_datetime);
    const isOverdue = dueAt ? dueAt < now : false;
    const isToday = eventDate ? eventDate.toDateString() === now.toDateString() : false;
    const { canReturn, opensAt: returnOpensAt } = getReturnAvailability(g.booking?.event_datetime);
    return { ...g, eventDate, dueAt, isOverdue, isToday, canReturn, returnOpensAt };
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

  // Overdue events for the sidebar panel — already sorted overdue-first by
  // assignmentGroups' own sort, so just filter.
  const overdueGroups = assignmentGroups.filter(g => g.isOverdue);
  // Measured from the return deadline, not the event date, so "2 days
  // overdue" means two days past when it was actually due back.
  const daysOverdue = (dueAt) => Math.max(0, Math.floor((now - dueAt) / (1000 * 60 * 60 * 24)));

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
      const itemNames = g.items.map(i => (i.equipment?.eqm_name || '').toLowerCase()).join(' ');
      if (!ref.includes(term) && !customerName.includes(term) && !venue.includes(term) && !itemNames.includes(term)) return false;
    }
    return true;
  });

  const activeAssignmentFilterCount = (assignmentSearchTerm.trim() ? 1 : 0) + (assignmentSectionFilter !== 'All' ? 1 : 0) + (assignmentDatePreset !== 'All Time' ? 1 : 0);

  // 'priority' (the default) keeps assignmentGroups' own overdue-first sort;
  // 'date' and 'customer' let a manager override that with a plain oldest/
  // newest or A-Z ordering instead.
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
        const status = getAssignmentStatus(a.returned, a.booking?.event_datetime);
        const filterKey = historyStatusFilter === 'Assigned' ? 'assigned' : historyStatusFilter === 'In Use' ? 'in_use' : 'returned';
        if (status.key !== filterKey) return false;
      }
      if (historyDatePreset !== 'All Time' && !isWithinRange(a.booking?.event_datetime, historyRangeStart, historyRangeEnd)) return false;
      if (historySearch.trim()) {
        const term = historySearch.toLowerCase();
        const eqName = (a.equipment?.eqm_name || '').toLowerCase();
        const ref = (a.booking ? getBookingRef(a.booking) : '').toLowerCase();
        const customerName = (a.booking?.customer ? `${a.booking.customer.first_name} ${a.booking.customer.last_name}` : '').toLowerCase();
        const venue = (a.booking?.venue || '').toLowerCase();
        if (!eqName.includes(term) && !ref.includes(term) && !customerName.includes(term) && !venue.includes(term)) return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.assigned_at || 0) - new Date(a.assigned_at || 0));

  const activeHistoryFilterCount = (historySearch.trim() ? 1 : 0) + (historyStatusFilter !== 'All' ? 1 : 0) + (historyDatePreset !== 'All Time' ? 1 : 0);

  // No field chosen = the default sort already applied above (newest
  // assigned first). Choosing a header overrides it.
  const sortedFilteredHistoryRows = historySort.field
    ? [...filteredHistoryRows].sort((a, b) => {
        let result = 0;
        if (historySort.field === 'customer') {
          const nameOf = (x) => (x.booking?.customer ? `${x.booking.customer.first_name} ${x.booking.customer.last_name}` : '');
          result = nameOf(a).localeCompare(nameOf(b));
        }
        else if (historySort.field === 'eventDate') result = new Date(a.booking?.event_datetime || 0) - new Date(b.booking?.event_datetime || 0);
        else if (historySort.field === 'assignedOn') result = new Date(a.assigned_at || 0) - new Date(b.assigned_at || 0);
        return historySort.direction === 'asc' ? result : -result;
      })
    : filteredHistoryRows;

  // ============================================================
  // --- HISTORY: one row per booking, not per equipment type ---
  // ============================================================
  // booking_equipment stores a row per equipment type, so a booking that took
  // eight different items produced eight history rows carrying the same
  // reference, customer and event date. Grouped by booking the way the Active
  // Assignments tab already groups, and expandable to the individual items --
  // the same shape the Payments page uses for a booking's payments.
  //
  // Grouping happens AFTER filtering, so a group summarises what matched: a
  // search for one equipment name shows that booking with the one item that
  // matched, not the whole booking. Group order follows the row order above,
  // so whichever sort is active still drives the list.
  const historyGroups = (() => {
    const map = new Map();
    sortedFilteredHistoryRows.forEach(a => {
      // A row with no booking can't be grouped with anything -- keep it as its
      // own group rather than collapsing unrelated orphans together.
      const key = a.booking_id || `orphan-${a.assignment_id}`;
      if (!map.has(key)) {
        map.set(key, { key, booking_id: a.booking_id, booking: a.booking, items: [], totalUnits: 0 });
      }
      const g = map.get(key);
      g.items.push(a);
      g.totalUnits += (a.quantity || 0);
    });

    return Array.from(map.values()).map(g => {
      const returnedCount = g.items.filter(i => i.returned).length;
      const allReturned = returnedCount === g.items.length;
      const openItems = g.items.filter(i => !i.returned);
      const anyOverdue = openItems.some(i => {
        const dueAt = getReturnDueAt(i.booking?.event_datetime);
        return dueAt ? dueAt < now : false;
      });
      // The group takes the least-finished stage among its items, from the
      // same getAssignmentStatus every other tab uses, so a group can never
      // report a stage its rows disagree with.
      const anyInUse = openItems.some(i => getAssignmentStatus(i.returned, i.booking?.event_datetime).key === 'in_use');
      const stage = allReturned
        ? { key: 'returned', label: 'Returned' }
        : anyOverdue
          ? { key: 'overdue', label: 'Overdue' }
          : anyInUse
            ? { key: 'in_use', label: 'In Use' }
            : { key: 'assigned', label: 'Assigned' };
      const assignedTimes = g.items.map(i => new Date(i.assigned_at || 0).getTime()).filter(Boolean);
      return {
        ...g,
        returnedCount,
        allReturned,
        stage,
        // Newest assignment in the group -- matches the default newest-first sort.
        latestAssignedAt: assignedTimes.length ? new Date(Math.max(...assignedTimes)) : null,
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
          <h1 className="text-[25px] font-bold tracking-[-0.02em] text-slate-900">Equipment</h1>
          <p className="text-[14.5px] text-slate-600 mt-1.5 max-w-[540px] [text-wrap:pretty]">
            See what's actually free on a given date, manage inventory, and track assignments.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setAddFieldErrors({}); setIsAddModalOpen(true); }}
            className="bg-white border border-slate-300 text-slate-700 px-4 py-2.5 rounded-[10px] font-semibold transition-colors flex items-center gap-2 text-sm whitespace-nowrap shadow-sm cursor-pointer hover:bg-[#f4f9f6] hover:border-[#c9dfd4] hover:text-[#007038] focus:outline-none focus:ring-2 focus:ring-[#008A45]/40"
          >
            <Plus size={16} /> Add Stock
          </button>
          <button
            onClick={() => {
              // Resets booking_id too. Without that, opening this after
              // assigning from a specific event inherited that event's
              // booking while showing an empty search box — the modal looked
              // like nothing was selected and would assign to the previous
              // booking anyway.
              setAssignmentQueue([]);
              setAssignFormData({ booking_id: '', notes: '' });
              setBookingSearchTerm('');
              setShowBookingDropdown(false);
              setAssignBookingLocked(false);
              setIsAssignModalOpen(true);
            }}
            className="bg-[#008A45] hover:bg-[#007038] text-white px-[17px] py-2.5 rounded-[10px] font-bold transition-all flex items-center gap-2 text-sm whitespace-nowrap shadow-sm hover:shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 focus:ring-offset-1"
          >
            <ClipboardList size={16} /> Assign Equipment
          </button>
          <button
            onClick={fetchData}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-3 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* --- AT A GLANCE — live figures only: what we own, and anything
      needing action. The date-scoped numbers that used to sit here (events
      on date / in use / available) moved into the Availability tab,
      alongside the date picker that actually drives them.

      Mixing the two scopes in one screenful is what previously forced
      three separate captions to explain the layout to the manager
      ("Date-scoped — follows the date selected above", "Live status —
      always current", and a line spelling out which tabs the date picker
      does and doesn't affect). One scope per region needs no caption at
      all, which is the actual fix for the overload — not shorter
      captions. The two sidebar alert panels are folded in here too, so
      the page is a single column instead of competing for attention with
      a 320px rail. --- */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* "Total stock owned" used to sit here. The panel's point was that
            it isn't a number anyone acts on — owning 500 chairs says
            nothing about whether Saturday's event is ready. It moved to
            the Inventory tab as reference context; this slot now answers
            the question a manager actually opens this page with: is
            anything coming up not ready yet? */}
        {/* Was "Events needing prep", which was structurally always zero:
            approval allocates the full package template, so an
            Approved/Confirmed booking is never short against it. This
            reports what is actually true and varies — how much work is
            coming, and whether any day is over capacity. */}
        <button
          onClick={() => setActiveTableTab('upcoming')}
          className={`relative overflow-hidden rounded-[15px] border px-5 py-[18px] text-left cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 ${overCapacityDays.length > 0 ? 'bg-[#fef4f4] border-[#f3d3d3] hover:border-[#e8bcbc]' : 'bg-white border-slate-200/70 hover:border-[#c9dfd4] hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)]'}`}
        >
          <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${overCapacityDays.length > 0 ? 'bg-red-500' : 'bg-[#008A45]'}`} />
          <span className={`block text-[13px] font-semibold mb-2 whitespace-nowrap ${overCapacityDays.length > 0 ? 'text-red-700' : 'text-slate-600'}`}>Upcoming events</span>
          <span className={`block text-[30px] font-semibold tracking-[-0.03em] leading-none tabular-nums ${overCapacityDays.length > 0 ? 'text-red-700' : 'text-slate-900'}`}>{upcomingPrep.length}</span>
          <span className="block text-[13px] mt-2.5">
            {overCapacityDays.length > 0 ? (
              <span className="font-semibold text-red-600">
                {overCapacityDays.length} date{overCapacityDays.length === 1 ? '' : 's'} over capacity
              </span>
            ) : upcomingPrep.length === 0 ? (
              <span className="text-slate-600">Nothing booked in the next {PREP_HORIZON_DAYS} days</span>
            ) : (
              <span className="text-slate-600">
                Next: {nextEvent?.daysUntil <= 0 ? 'today' : nextEvent?.daysUntil === 1 ? 'tomorrow' : `in ${nextEvent?.daysUntil} days`} · {prepDays.length} day{prepDays.length === 1 ? '' : 's'} with events
              </span>
            )}
          </span>
        </button>

        <button
          onClick={showNeedsAttentionInInventory}
          className="relative overflow-hidden rounded-[15px] border px-5 py-[18px] text-left cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 bg-white border-slate-200/70 hover:border-[#c9dfd4] hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)]"
        >
          <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-amber-500" />
          <span className="block text-[13px] font-semibold mb-2 whitespace-nowrap text-slate-600">Damaged or under maintenance</span>
          <span className={`block text-[30px] font-semibold tracking-[-0.03em] leading-none tabular-nums ${needsAttentionUnits > 0 ? 'text-slate-900' : 'text-slate-400'}`}>{needsAttentionUnits}</span>
          <span className="block text-[13px] mt-2.5 text-slate-600">
            {needsAttentionUnits > 0 ? 'Never counted as available' : 'Nothing needs attention'}
          </span>
        </button>

        <button
          onClick={() => { setAssignmentSectionFilter('Overdue'); setActiveTableTab('assignments'); }}
          className="relative overflow-hidden rounded-[15px] border px-5 py-[18px] text-left cursor-pointer transition-all focus:outline-none focus:ring-2 focus:ring-[#008A45]/40 bg-white border-slate-200/70 hover:border-[#c9dfd4] hover:shadow-[0_3px_12px_rgba(15,23,42,0.05)]"
        >
          <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${overdueGroups.length > 0 ? 'bg-red-500' : 'bg-slate-400'}`} />
          <span className="block text-[13px] font-semibold mb-2 whitespace-nowrap text-slate-600">Overdue returns</span>
          <span className={`block text-[30px] font-semibold tracking-[-0.03em] leading-none tabular-nums ${overdueGroups.length > 0 ? 'text-red-700' : 'text-slate-400'}`}>{overdueGroups.length}</span>
          <span className="block text-[13px] mt-2.5 text-slate-600">
            {overdueGroups.length > 0 ? 'Past the 24-hour return window' : 'All returns up to date'}
          </span>
        </button>
      </div>

      {/* --- MAIN WORKSPACE: one full-width tabbed panel. The alerts that
      used to sit in a 320px sidebar here are now the two clickable cards
      above, which link into the same places the sidebar's "View all"
      buttons did. --- */}
      <div>

      {/* --- TAB CONTROL --- */}
      <div ref={availabilityPanelRef} className="bg-white rounded-2xl border border-slate-200/70 overflow-hidden">
        {/* Underline tabs, matching every other page. These were white pills on
            a grey bar, which is a control style used nowhere else in the app.
            Counts sit on the tab so what is waiting in Active Assignments is
            visible without switching to it.

            Upcoming leads because preparing for what's coming is the job this
            page exists for; the other four support it (what's free, what we
            own, what's out, what happened). */}
        <div className="flex items-center gap-0.5 px-2 border-b border-slate-100 overflow-x-auto">
          {[
            { key: 'upcoming', label: 'Upcoming', Icon: Calendar, count: upcomingPrep.length, alert: overCapacityDays.length > 0 },
            { key: 'availability', label: 'Availability', Icon: CalendarClock },
            { key: 'inventory', label: 'Inventory', Icon: LayoutGrid, count: equipmentList.length },
            { key: 'assignments', label: 'Active Assignments', Icon: ClipboardList, count: assignmentGroups.length, alert: overdueGroups.length > 0 },
            { key: 'history', label: 'History', Icon: History },
          ].map(t => {
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

        {/* One line per tab, describing the step of the equipment process it
            covers. These explain scope, which is this page's hardest concept —
            they were 12px grey inside the tab bar and easy to miss. */}
        <p className="px-5 py-3.5 border-b border-slate-100 text-[13.5px] text-slate-600 [text-wrap:pretty]">
          {activeTableTab === 'upcoming' && <>Events in the next {PREP_HORIZON_DAYS} days, grouped by day — what goes out, and whether stock covers everything happening that day.</>}
          {activeTableTab === 'availability' && <>What's free to assign on a chosen date, after subtracting what's already committed.</>}
          {activeTableTab === 'inventory' && <>Everything we own — add stock, edit details, or flag damage and repairs.</>}
          {activeTableTab === 'assignments' && <>Everything currently out at an event and not yet returned. {RETURN_POLICY_TEXT}</>}
          {activeTableTab === 'history' && <>Every assignment ever made — assigned and returned — grouped by booking. Open a row to see the individual items.</>}
        </p>

        {/* ===== UPCOMING PREP TAB ===== */}
        {/* Answers the panel's two questions in one place: which packages
            are coming up, and what equipment is assigned for them. Each
            event expands to a required-vs-assigned breakdown so the gap is
            explicit rather than something the manager has to work out by
            cross-referencing the package template against the assignment
            list themselves. */}
        {activeTableTab === 'upcoming' && (
          <div className="divide-y divide-slate-100">
            {/* Pending requests are surfaced as a count, not as rows. They
                have no allocation yet by design (approval is what
                allocates), so listing them as prep work would report the
                normal state of an un-reviewed request as a shortage. */}
            {pendingBookings.length > 0 && (
              <details className="group/pending bg-slate-50">
                <summary className="px-4 py-2.5 flex items-center gap-2 text-xs text-slate-600 cursor-pointer list-none hover:bg-slate-100 transition-colors">
                  <span className="text-slate-400 group-open/pending:rotate-90 transition-transform inline-block">▸</span>
                  <AlertTriangle size={13} className={pendingPastDue.length > 0 ? 'text-amber-500 shrink-0' : 'text-slate-400 shrink-0'} />
                  <span>
                    <span className="font-bold text-slate-800">{pendingBookings.length}</span> booking request{pendingBookings.length === 1 ? '' : 's'} awaiting approval — equipment is allocated once approved, so {pendingBookings.length === 1 ? 'it does' : 'they do'} not appear as prep work here.
                    {pendingPastDue.length > 0 && (
                      <span className="font-semibold text-amber-700"> {pendingPastDue.length} {pendingPastDue.length === 1 ? 'has' : 'have'} an event date that already passed.</span>
                    )}
                  </span>
                  <span className="ml-auto text-[13px] font-semibold text-[#007038] shrink-0">View</span>
                </summary>
                <div className="px-4 pb-3 pt-1 space-y-1.5 border-t border-slate-200">
                  {pendingBookings.map(pb => {
                    const pbDate = pb.event_datetime ? new Date(pb.event_datetime) : null;
                    const isPastDue = pbDate && pbDate < now;
                    return (
                      <button
                        key={pb.booking_id}
                        type="button"
                        onClick={() => goToBookingDetails(pb.booking_id, pb.booking_type)}
                        className="w-full flex items-center justify-between gap-3 text-left px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-[#008A45]/50 transition-colors cursor-pointer"
                        title="Open this booking to approve or reject it"
                      >
                        <span className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="text-[13px] font-semibold text-[#007038] tabular-nums">{getBookingRef(pb)}</span>
                          <span className="text-xs font-semibold text-slate-800 truncate">
                            {pb.customer ? `${pb.customer.first_name} ${pb.customer.last_name}` : 'Unknown'}
                          </span>
                          {pb.package?.pkg_name && (
                            <span className="text-[11.5px] font-semibold px-2 py-[3px] rounded-full bg-blue-50 text-blue-700">
                              {pb.package.pkg_name}
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className={`text-[13px] ${isPastDue ? 'font-semibold text-amber-700' : 'text-slate-600'}`}>
                            {pbDate ? pbDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'No date'}
                            {isPastDue ? ' · passed' : ''}
                          </span>
                          <ExternalLink size={11} className="text-slate-400" />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </details>
            )}
            {isLoading ? (
              <p className="p-6 text-center text-slate-500 text-sm">Loading upcoming events…</p>
            ) : prepDays.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-slate-500">No approved events in the next {PREP_HORIZON_DAYS} days.</p>
                <p className="text-xs text-slate-400 mt-1">Bookings appear here once approved — approving one also allocates its package equipment.</p>
              </div>
            ) : (
              prepDays.map(day => {
                const dayLabel = day.date.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
                return (
                  <details key={day.dateKey} open={day.isToday || day.isTomorrow || day.shortages.length > 0} className="group/day">
                    <summary className={`p-4 cursor-pointer list-none flex items-center justify-between gap-3 flex-wrap hover:bg-[#fbfcfd] transition-colors ${day.shortages.length > 0 ? 'bg-red-50/50' : ''}`}>
                      <div className="flex items-center gap-3 flex-wrap min-w-0">
                        <span className="text-slate-400 group-open/day:rotate-90 transition-transform inline-block">▸</span>
                        <span className="font-bold text-slate-900 text-sm">{dayLabel}</span>
                        {day.isToday && (
                          <span className="inline-flex items-center px-2.5 py-[3px] rounded-full text-[11.5px] font-bold bg-[#008A45] text-white">TODAY</span>
                        )}
                        {day.isTomorrow && (
                          <span className="inline-flex items-center px-2.5 py-[3px] rounded-full text-[11.5px] font-semibold bg-emerald-50 text-emerald-700">TOMORROW</span>
                        )}
                        <span className="text-xs text-slate-500">
                          {day.events.length} event{day.events.length === 1 ? '' : 's'} · {day.totalUnits} unit{day.totalUnits === 1 ? '' : 's'} going out
                        </span>
                      </div>
                      {day.shortages.length > 0 && (
                        <span className="inline-flex items-center gap-1 px-3 py-[5px] rounded-full text-[12.5px] font-semibold bg-red-50 text-red-700">
                          <AlertTriangle size={10} /> OVER CAPACITY
                        </span>
                      )}
                    </summary>

                    <div className="px-4 pb-4 bg-slate-50/50 space-y-3">
                      {/* Day-level shortfall first: it is the one thing on
                          this screen that cannot be fixed by looking at a
                          single booking, because it is caused by several
                          events sharing one pool of stock. */}
                      {day.shortages.length > 0 && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                          <p className="text-xs font-bold text-red-800 mb-1.5">
                            Not enough stock for everything booked this day
                          </p>
                          <div className="space-y-1">
                            {day.shortages.map(s => (
                              <p key={s.equipment_id} className="text-xs text-red-700">
                                <span className="font-semibold">{s.name}</span> — {day.events.length} event{day.events.length === 1 ? '' : 's'} need {s.needed}, only {s.usable} usable
                                <span className="font-bold"> · short {s.short}</span>
                              </p>
                            ))}
                          </div>
                          <p className="text-[13px] text-red-600 mt-1.5">
                            Free up units by returning stock early, repairing damaged items, or moving equipment between these events.
                          </p>
                        </div>
                      )}

                      {/* What to load for the day, pooled across its events —
                          staging happens per van-load, not per booking. */}
                      {day.items.length > 0 && (
                        <div className="rounded-lg border border-slate-200 bg-white p-3">
                          <p className="text-[13px] font-bold text-slate-600 tracking-[0.04em] mb-2">To prepare this day</p>
                          <div className="flex flex-wrap gap-1.5">
                            {day.items.map(i => (
                              <span
                                key={i.equipment_id}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold border ${i.short > 0 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-200 text-slate-700'}`}
                                title={`${i.needed} needed · ${i.usable} usable in stock`}
                              >
                                {i.name} <span className="font-extrabold">×{i.needed}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Then the per-event breakdown: who, what package, and
                          exactly what that event takes. */}
                      {day.events.map(ev => {
                        const customerName = ev.customer ? `${ev.customer.first_name} ${ev.customer.last_name}` : 'Unknown';
                        const ref = getBookingRef(ev);
                        const assignedLines = ev.lines.filter(l => l.assigned > 0);
                        return (
                          <div key={ev.booking_id} className="rounded-lg border border-slate-200 bg-white p-3">
                            <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                              <div className="flex items-center gap-2 flex-wrap min-w-0">
                                <span className="text-xs font-bold text-slate-700">
                                  {new Date(ev.event_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => goToBookingDetails(ev.booking_id, ev.booking_type)}
                                  className="font-mono text-xs font-bold text-[#008A45] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                                  title="View full booking details"
                                >
                                  {ref} <ExternalLink size={10} />
                                </button>
                                <span className="text-sm font-semibold text-slate-900 truncate">{customerName}</span>
                                <span className="text-[11.5px] font-semibold px-2.5 py-[3px] rounded-full bg-blue-50 text-blue-700">
                                  {ev.package?.pkg_name || 'No package'}
                                </span>
                                <span className="text-xs text-slate-500 flex items-center gap-1">
                                  <Users size={11} /> {ev.pax_count || 0} pax
                                </span>
                                <span className={`text-[11.5px] font-semibold px-2.5 py-[3px] rounded-full ${ev.booking_status === 'Confirmed' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>
                                  {ev.booking_status}
                                </span>
                              </div>
                              {ev.canAssign ? (
                                <button
                                  onClick={() => {
                                    setAssignmentQueue([]);
                                    setAssignFormData({ booking_id: ev.booking_id, notes: '' });
                                    setBookingSearchTerm(`${ref} - ${customerName}`);
                                    setShowBookingDropdown(false);
                                    setAssignBookingLocked(true);
                                    setIsAssignModalOpen(true);
                                  }}
                                  className="shrink-0 inline-flex items-center gap-1.5 bg-[#008A45] hover:bg-[#007038] text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                                >
                                  <ClipboardList size={13} /> Add equipment
                                </button>
                              ) : (
                                <span
                                  className="shrink-0 inline-flex items-center gap-1.5 bg-slate-100 text-slate-500 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200"
                                  title={`Equipment can't be assigned once a booking is ${ev.booking_status}`}
                                >
                                  <Lock size={13} /> Locked
                                </span>
                              )}
                            </div>

                            {ev.venue && (
                              <p className="text-xs text-slate-500 flex items-center gap-1 mb-2">
                                <MapPin size={11} /> {ev.venue}
                              </p>
                            )}

                            {assignedLines.length === 0 ? (
                              <p className="text-[13px] text-slate-600">
                                No equipment assigned to this event yet.
                                {!ev.hasTemplate && ' Its package has no equipment template, so nothing was allocated automatically.'}
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-1.5">
                                {assignedLines.map(l => (
                                  <span
                                    key={l.equipment_id}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs bg-slate-50 border border-slate-200 text-slate-700"
                                    title={l.required > 0 ? `${l.required} required by the package template` : 'Assigned manually — not part of the package template'}
                                  >
                                    {l.name} <span className="font-bold">×{l.assigned}</span>
                                    {l.short > 0 && <span className="text-amber-700 font-semibold">({l.short} short)</span>}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })
            )}
          </div>
        )}

        {/* ===== AVAILABILITY TAB ===== */}
        {activeTableTab === 'availability' && (
          <>
            {/* Date control lives here, not in a page-level bar, because
                this is the only tab it affects. Sitting at the top of the
                page it read as global, which is exactly why a caption had
                to exist telling the manager it wasn't. The three
                date-scoped figures sit with it, so the number and the
                control that changes it are never separated. */}
            <div className="p-4 border-b border-slate-200 bg-slate-50/60">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <CalendarClock size={16} className="text-[#008A45] shrink-0" />
                  <span className="font-semibold text-slate-600">Availability for</span>
                  <span className="font-bold text-slate-900">{selectedDateLabel}</span>
                  {snapshotLoading && <span className="text-xs text-slate-400">(recalculating…)</span>}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedDate(todayISO())}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${isSelectedToday ? 'bg-[#008A45] border-[#008A45] text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                  >
                    Today
                  </button>
                  <button
                    onClick={() => setSelectedDate(tomorrowISO())}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${isSelectedTomorrow ? 'bg-[#008A45] border-[#008A45] text-white' : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
                  >
                    Tomorrow
                  </button>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <button
                  onClick={() => setIsEventsModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:border-[#008A45] hover:text-[#008A45] transition-colors cursor-pointer"
                >
                  {snapshot.eventsOnDate.length} event{snapshot.eventsOnDate.length === 1 ? '' : 's'} this date
                  <ChevronRight size={12} />
                </button>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-600">
                  <span className="text-blue-700 font-extrabold">{unitsCommitted}</span> units in use
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-semibold text-slate-600">
                  <span className={`font-extrabold ${unitsFree < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{unitsFree}</span> still available
                  <span className="text-slate-400 font-normal">({usableStockAll} usable − {unitsCommitted} in use)</span>
                </span>
              </div>
            </div>
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
                  placeholder="Search equipment name..."
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
                <option value="Countable">Countable</option>
                <option value="Decoration">Decoration</option>
              </Select>
              <div className="flex items-center gap-1">
                {[
                  { key: 'All', label: 'All' },
                  { key: 'overbooked', label: `Short (${availabilityStatusCounts.overbooked})` },
                  { key: 'tight', label: `Low or fully committed (${availabilityStatusCounts.tight})` },
                  { key: 'available', label: `Available (${availabilityStatusCounts.available})` },
                ].map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setAvailabilityStatusFilter(opt.key)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                      availabilityStatusFilter === opt.key
                        ? (opt.key === 'overbooked' ? 'bg-red-600 border-red-600 text-white' : 'bg-[#008A45] border-[#008A45] text-white')
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
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#fbfcfd] border-b border-slate-100">
                  <th className="px-4 py-3">{renderSortHeader(availabilitySort, toggleAvailabilitySort, 'name', 'Equipment')}</th>
                  <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Usable</th>
                  <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">In use on this date</th>
                  <th className="px-4 py-3 text-center">{renderSortHeader(availabilitySort, toggleAvailabilitySort, 'free', 'Available', 'justify-center mx-auto')}</th>
                  <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                {isLoading || snapshotLoading ? (
                  <tr><td colSpan="6" className="p-6 text-center text-slate-500">Calculating availability…</td></tr>
                ) : filteredAvailabilityItems.length === 0 ? (
                  <tr><td colSpan="6" className="p-6 text-center text-slate-500">No equipment matches your search/filter.</td></tr>
                ) : (
                  sortedFilteredAvailabilityItems.map((item) => {
                    const status = getAvailabilityStatus(item);
                    const stock = getStockBreakdown(item);
                    const outOfService = stock.outOfService;
                    // The bar shows how much of the USABLE stock is spoken for.
                    // The bar reads as "how much of this item is still
                    // available", not how much is used. Filled by usage, an
                    // item with nothing committed drew an EMPTY bar — so the
                    // healthiest possible row looked identical to one with
                    // nothing in it, and the colour carried all the meaning.
                    // Now full stock reads as a full green bar and drains as
                    // the item gets committed, which is the direction people
                    // read a level indicator.
                    const availableRatio = stock.usable > 0
                      ? Math.max(0, Math.min(1, stock.free / stock.usable))
                      : 0;
                    return (
                      <tr
                        key={item.equipment_id}
                        onClick={() => { setAvailabilityDetailItem(item); setIsAvailabilityDetailOpen(true); }}
                        title="Click for the list of events using this item"
                        className={`hover:bg-[#fbfcfd] transition-colors cursor-pointer group ${status.key === 'overbooked' ? 'bg-red-50/40' : ''}`}
                      >
                        <td className="px-4 py-[15px]">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-900">{item.eqm_name}</p>
                            <span className={`inline-flex items-center px-2 py-[3px] rounded-full text-[11.5px] font-semibold ${item.equipment_type === 'Decoration' ? 'bg-[#f6edfe] text-purple-700' : 'bg-blue-50 text-blue-700'}`}>
                              {item.equipment_type === 'Decoration' ? 'Decoration' : 'Countable'}
                            </span>
                          </div>
                          {item.events.length > 0 ? (
                            <p className="text-xs text-slate-500 mt-0.5">Used by {item.events.length} event{item.events.length !== 1 ? 's' : ''} on this date — click to see which</p>
                          ) : (
                            <p className="text-xs text-slate-400 mt-0.5">Not used on this date</p>
                          )}
                          {/* Why the usable figure is below what the business
                              owns — only worth a line when it isn't zero. */}
                          {outOfService > 0 && (
                            <p className="text-xs text-red-600 mt-0.5 font-medium">
                              {stock.total} owned · {outOfService} out of service
                              {stock.damaged > 0 && stock.maintenance > 0
                                ? ` (${stock.damaged} damaged, ${stock.maintenance} under maintenance)`
                                : ''}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-[15px] text-right font-bold text-slate-900">{stock.usable}</td>
                        <td className="px-4 py-[15px] text-right font-semibold text-slate-700">{stock.committed} <span className="text-slate-400 font-normal">units</span></td>
                        <td className="px-4 py-[15px] text-right">
                          <span className={`inline-flex items-center justify-center min-w-[3rem] px-3 py-1 rounded-full text-xl font-extrabold ${status.key === 'overbooked' ? 'bg-red-100 text-red-700' : status.rank === 1 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {stock.free}
                          </span>
                        </td>
                        <td className="px-4 py-[15px]">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${status.pillClass}`}>{status.label}</span>
                            <div className="w-14 h-1.5 rounded-full bg-slate-200 overflow-hidden shrink-0">
                              <div className={`h-full ${status.barColor}`} style={{ width: `${Math.round(availableRatio * 100)}%` }} />
                            </div>
                          </div>
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

        {/* ===== INVENTORY TAB ===== */}
        {activeTableTab === 'inventory' && (
          <>
            {/* Stock totals live here rather than in a headline card. They
                are reference context for "what do we own" — the tab that
                question belongs to — not something a manager acts on at a
                glance, which was the panel's point about the old
                "Total stock owned" card. */}
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/60 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
              <span className="text-slate-600">
                <span className="font-extrabold text-slate-900 text-sm">{ownedStockAll}</span> units owned
              </span>
              <span className="text-slate-500">
                = <span className="font-bold text-emerald-700">{usableStockAll}</span> usable
                {' + '}
                <span className="font-bold text-red-600">{needsAttentionUnits}</span> out of service (damaged or under maintenance)
              </span>
            </div>
            <div className={`p-4 border-b flex flex-wrap items-center gap-3 ${activeInventoryFilterCount > 0 ? 'bg-emerald-50/40 border-emerald-100' : 'border-slate-200'}`}>
              {activeInventoryFilterCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-600 text-white shrink-0">
                  {activeInventoryFilterCount} active
                </span>
              )}
              {/* Arriving from the sidebar applies a filter the manager didn't
                  set by hand, so it has to be visible and removable here. */}
              {inventoryNeedsAttentionOnly && (
                <button
                  type="button"
                  onClick={() => setInventoryNeedsAttentionOnly(false)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors cursor-pointer shrink-0"
                  title="Show all equipment again"
                >
                  Needs attention only <X size={12} />
                </button>
              )}
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  type="text"
                  placeholder="Search equipment name or description..."
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
                <option value="Countable">Countable</option>
                <option value="Decoration">Decoration</option>
              </Select>
              {activeInventoryFilterCount > 0 && (
                <button
                  onClick={() => { setInventorySearch(''); setInventoryTypeFilter('All'); setInventoryNeedsAttentionOnly(false); }}
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
                    <th className="px-4 py-3">{renderSortHeader(inventorySort, toggleInventorySort, 'name', 'Equipment')}</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Owned</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Damaged</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Under Maintenance</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Usable</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Type</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Guests per Unit</th>
                    {/* Not "Out now": this counts unreturned ASSIGNMENTS, most
                        of which are for events that haven't happened yet, and
                        statusLabels.js is explicit that a chair promised to a
                        wedding three days out is not in use by any reading of
                        the word. "Committed" is the settled term for exactly
                        that state (RESOURCE_STATE.committed). */}
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Committed to</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                  {isLoading ? (
                    <tr><td colSpan="9" className="p-6 text-center text-slate-500">Loading equipment...</td></tr>
                  ) : filteredInventory.length === 0 ? (
                    <tr><td colSpan="9" className="p-6 text-center text-slate-500">No equipment found.</td></tr>
                  ) : (
                    sortedFilteredInventory.map((item) => {
                      // Unreturned assignments for this item. Counting rows,
                      // not units — which is the second reason "N out now"
                      // misread: for Chairs it looked like a chair count when
                      // it was a booking count. The label now names the unit,
                      // and the tooltip carries both that and the
                      // Assigned/In Use split from statusLabels.js.
                      const activeForItem = assignments.filter(a => a.equipment_id === item.equipment_id && !a.returned);
                      const usageCount = activeForItem.length;
                      const inUseCount = activeForItem.filter(
                        a => getAssignmentStatus(false, a.booking?.event_datetime).key === 'in_use'
                      ).length;
                      const upcomingCount = usageCount - inUseCount;
                      const committedUnits = activeForItem.reduce((sum, a) => sum + (a.quantity || 0), 0);
                      const stock = getStockBreakdown(item);
                      const condition = getConditionSummary(item);
                      return (
                        <tr key={item.equipment_id} className="hover:bg-[#fbfcfd] transition-colors">
                          <td className="px-4 py-[15px]">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-slate-900">{item.eqm_name}</p>
                              {condition.dbValue !== 'Good Condition' && (
                                <span className={`inline-flex items-center px-2 py-[3px] rounded-full text-[11.5px] font-semibold ${condition.className}`}>
                                  {condition.label}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">{item.eqm_description}</p>
                          </td>
                          <td className="px-4 py-[15px] text-right font-semibold text-slate-800">{stock.total}</td>
                          <td className="px-4 py-[15px] text-right font-semibold text-red-600">{stock.damaged}</td>
                          <td className="px-4 py-[15px] text-right font-semibold text-amber-600">{stock.maintenance}</td>
                          <td className="px-4 py-[15px] text-right font-bold text-slate-900">{stock.usable}</td>
                          <td className="px-4 py-[15px] text-right">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${item.equipment_type === 'Decoration' ? 'bg-[#f6edfe] text-purple-700' : 'bg-blue-50 text-blue-700'}`}>
                              {item.equipment_type === 'Decoration' ? 'Decoration' : 'Countable'}
                            </span>
                          </td>
                          <td className="px-4 py-[15px] text-right font-semibold text-slate-900">
                            {item.pax_per_unit ? `${item.pax_per_unit} pax` : '—'}
                          </td>
                          <td className="px-4 py-[15px] text-right">
                            <button
                              onClick={() => handleViewUsage(item)}
                              className="text-blue-500 hover:text-blue-700 transition-colors text-xs font-medium flex items-center gap-1 mx-auto"
                              title={usageCount > 0
                                ? `${committedUnits} unit${committedUnits === 1 ? '' : 's'} across ${usageCount} booking${usageCount === 1 ? '' : 's'} — ${inUseCount} in use, ${upcomingCount} still upcoming`
                                : 'No current commitments — click to see past assignments'}
                            >
                              <ClipboardList size={14} />
                              {usageCount > 0
                                ? `${usageCount} booking${usageCount === 1 ? '' : 's'}`
                                : 'View history'}
                            </button>
                          </td>
                          <td className="px-4 py-[15px] text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleFlagIssueClick(item)}
                                className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-full px-3 py-1.5 transition-colors cursor-pointer"
                                title="Mark this equipment as damaged or under maintenance"
                              >
                                <Wrench size={13} /> Flag issue
                              </button>
                              <button
                                onClick={() => handleEditClick(item)}
                                className="text-slate-400 hover:text-slate-700 transition-colors cursor-pointer"
                                title="Edit name, description, stock, type"
                              >
                                <Edit size={16} />
                              </button>
                              <button
                                onClick={() => handleDeleteEquipment(item.equipment_id)}
                                className="text-red-400 hover:text-red-600 transition-colors cursor-pointer"
                                title="Delete Equipment"
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
            <span className="text-xs font-semibold text-slate-500 shrink-0">{filteredAssignmentGroups.length} of {assignmentGroups.length} event{assignmentGroups.length !== 1 ? 's' : ''} · {activeAssignmentRows.length} item{activeAssignmentRows.length !== 1 ? 's' : ''} total</span>
          </div>

          {/* Search + section filter, so a long list stays navigable instead of cramped */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                placeholder="Search by customer, booking ref, venue, or equipment..."
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

          {/* Look up a specific event date or range, independent of the quick shortcuts above */}
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

        {/* Internal scroll so a long list of bookings doesn't stretch the whole page */}
        <div className="max-h-[32rem] overflow-y-auto divide-y divide-slate-100">
          {isLoading ? (
            <p className="p-6 text-center text-slate-500 text-sm">Loading assignments...</p>
          ) : assignmentGroups.length === 0 ? (
            <p className="p-6 text-center text-slate-500 text-sm">No active assignments.</p>
          ) : filteredAssignmentGroups.length === 0 ? (
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
                      {group.isOverdue && (() => {
                        // Says how far past the 24-hour return deadline this
                        // is, rather than just "OVERDUE" — one day late and
                        // a week late are very different problems.
                        const late = daysOverdue(group.dueAt);
                        return (
                          <span
                            className="inline-flex items-center gap-1 px-3 py-[5px] rounded-full text-[12.5px] font-semibold bg-red-50 text-red-700"
                            title={group.dueAt ? `Was due back ${group.dueAt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : undefined}
                          >
                            <AlertTriangle size={10} /> OVERDUE{late > 0 ? ` · ${late}d` : ''}
                          </span>
                        );
                      })()}
                      {!group.isOverdue && group.isToday && (
                        <span className="inline-flex items-center px-2.5 py-[3px] rounded-full text-[11.5px] font-semibold bg-emerald-50 text-emerald-700">TODAY</span>
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
                      <span className="text-xs font-semibold text-slate-500">{group.items.length} item type{group.items.length !== 1 ? 's' : ''} · {group.totalUnits} units</span>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); handleReturnAllForBooking(group.booking_id, group.items.length); }}
                        className={group.canReturn
                          ? 'text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 border border-blue-200 rounded-lg px-2.5 py-1 hover:bg-blue-50 transition-colors'
                          : 'text-xs font-semibold text-slate-400 flex items-center gap-1 border border-slate-200 rounded-lg px-2.5 py-1 transition-colors'}
                        title={group.canReturn ? undefined : `Returns open 3 hours after the event starts, at ${formatReturnOpensAt(group.returnOpensAt)}`}
                      >
                        {group.canReturn ? <Undo2 size={13} /> : <Lock size={13} />} Return all
                      </button>
                    </div>
                  </summary>
                  <div className="px-4 pb-4 pl-11 space-y-1.5">
                    {group.items.map((a) => (
                      <div key={a.assignment_id} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                        <span className="font-medium text-slate-700">{a.equipment?.eqm_name || 'Unknown'} × <span className="font-bold text-[#008A45]">{a.quantity}</span></span>
                        <button
                          onClick={() => handleReturnEquipment(a.assignment_id)}
                          className={group.canReturn
                            ? 'text-blue-500 hover:text-blue-700 transition-colors flex items-center gap-1 text-xs font-medium'
                            : 'text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1 text-xs font-medium'}
                          title={group.canReturn ? undefined : `Returns open 3 hours after the event starts, at ${formatReturnOpensAt(group.returnOpensAt)}`}
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
                    placeholder="Search by equipment, customer, booking ref, or venue..."
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
                {historyGroups.length} booking{historyGroups.length !== 1 ? 's' : ''} &#183; {filteredHistoryRows.length} of {assignments.length} assignment record{assignments.length !== 1 ? 's' : ''}{historySort.field ? '' : ', most recent first'}
              </p>
            </div>
            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#fbfcfd] border-b border-slate-100 sticky top-0">
                    <th className="px-5 py-3">{renderSortHeader(historySort, toggleHistorySort, 'customer', 'Booking')}</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Equipment</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap text-right">Units</th>
                    <th className="px-4 py-3">{renderSortHeader(historySort, toggleHistorySort, 'eventDate', 'Event date')}</th>
                    <th className="px-4 py-3">{renderSortHeader(historySort, toggleHistorySort, 'assignedOn', 'Assigned on')}</th>
                    <th className="px-4 py-3 text-[12.5px] font-bold uppercase tracking-[0.05em] text-slate-800 whitespace-nowrap">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                  {isLoading ? (
                    <tr><td colSpan="6" className="p-6 text-center text-slate-500">Loading history...</td></tr>
                  ) : historyGroups.length === 0 ? (
                    <tr><td colSpan="6" className="p-6 text-center text-slate-500">No assignment history matches your search or filter.</td></tr>
                  ) : (
                    historyGroups.map((g) => {
                      const ref = g.booking ? getBookingRef(g.booking) : 'Unknown';
                      const customerName = g.booking?.customer ? g.booking.customer.first_name + ' ' + g.booking.customer.last_name : 'Unknown';
                      const isExpanded = expandedHistoryGroups.has(g.key);
                      const multi = g.items.length > 1;
                      const stagePill = g.stage.key === 'returned' ? 'bg-slate-100 text-slate-600'
                        : g.stage.key === 'overdue' ? 'bg-red-50 text-red-700'
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
                                {/* Only a group hiding something gets a chevron;
                                    a single-item booking has nothing to reveal. */}
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
                              {multi ? g.items.length + ' equipment types' : (g.items[0].equipment?.eqm_name || 'Unknown')}
                            </td>
                            <td className="px-4 py-[15px] align-top text-right text-sm text-slate-800 tabular-nums">{g.totalUnits}</td>
                            <td className="px-4 py-[15px] align-top text-sm text-slate-600 tabular-nums">
                              {g.booking?.event_datetime ? new Date(g.booking.event_datetime).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                            </td>
                            <td className="px-4 py-[15px] align-top text-sm text-slate-600 tabular-nums">
                              {g.latestAssignedAt ? g.latestAssignedAt.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                            </td>
                            <td className="px-4 py-[15px] align-top">
                              <span className={'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12.5px] font-semibold whitespace-nowrap ' + stagePill}>
                                {g.stage.key === 'returned' && <CheckCircle2 size={12} />}
                                {g.stage.label}
                              </span>
                              {/* A part-returned booking reads as still open, so
                                  say how much of it is actually back. */}
                              {multi && !g.allReturned && g.returnedCount > 0 && (
                                <p className="text-[12.5px] text-slate-600 mt-1 tabular-nums">{g.returnedCount} of {g.items.length} returned</p>
                              )}
                            </td>
                          </tr>

                          {multi && isExpanded && g.items.map((a) => {
                            const itemStatus = getAssignmentStatus(a.returned, a.booking?.event_datetime);
                            return (
                              <tr key={a.assignment_id} className="bg-[#fbfcfd]">
                                <td className="px-5 py-2.5" />
                                <td className="px-4 py-2.5 text-[13.5px] font-medium text-slate-800">{a.equipment?.eqm_name || 'Unknown'}</td>
                                <td className="px-4 py-2.5 text-right text-[13.5px] text-slate-700 tabular-nums">{a.quantity}</td>
                                <td className="px-4 py-2.5" />
                                <td className="px-4 py-2.5 text-[13.5px] text-slate-600 tabular-nums">
                                  {a.assigned_at ? new Date(a.assigned_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}
                                </td>
                                <td className="px-4 py-2.5">
                                  {a.returned ? (
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[12.5px] font-semibold bg-slate-100 text-slate-600 whitespace-nowrap">
                                      <CheckCircle2 size={11} /> Returned {a.returned_at ? new Date(a.returned_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
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
                <p className="text-sm text-slate-500 text-center py-8">No events on this date.</p>
              ) : (
                snapshot.eventsOnDate.map(ev => {
                  const eventEquipment = eventEquipmentMap[ev.booking_id] || [];
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
                            className="text-[13.5px] font-semibold text-[#007038] tabular-nums hover:underline flex items-center gap-1 cursor-pointer"
                            title="View full booking details"
                          >
                            {ev.ref} <ExternalLink size={11} />
                          </button>
                          <p className="text-slate-500">{new Date(ev.event_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                      </div>
                      <div className="p-3">
                        <p className="text-xs font-bold text-slate-600 mb-1.5">Equipment for this event</p>
                        {eventEquipment.length === 0 ? (
                          <p className="text-xs text-slate-500">No equipment assigned to this booking yet.</p>
                        ) : (
                          <div className="space-y-1">
                            {eventEquipment.map(eqi => {
                              const eqiStatus = getAssignmentStatus(eqi.returned, ev.event_datetime);
                              return (
                                <div key={eqi.assignment_id} className="flex items-center justify-between text-xs">
                                  <span className="text-slate-700 font-medium">{eqi.eqm_name} × {eqi.quantity}</span>
                                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold ${eqi.returned ? 'bg-slate-100 text-slate-500' : eqiStatus.key === 'in_use' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                                    {eqi.returned ? <><CheckCircle2 size={11} /> Returned</> : eqiStatus.label}
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
      {isAvailabilityDetailOpen && availabilityDetailItem && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{availabilityDetailItem.eqm_name}</h2>
                <p className="text-[13px] text-slate-600 mt-0.5">Available on {selectedDateLabel}: <span className={`font-bold ${availabilityDetailItem.free < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{availabilityDetailItem.free}</span> of {availabilityDetailItem.quantity_available} total</p>
              </div>
              <button onClick={() => setIsAvailabilityDetailOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"><X size={18} /></button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {availabilityDetailItem.events.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">No events using this item on this date.</p>
              ) : (
                availabilityDetailItem.events.map((ev, idx) => {
                  const { canReturn: evCanReturn, opensAt: evReturnOpensAt } = getReturnAvailability(ev.event_datetime);
                  return (
                  <div key={idx} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 text-sm truncate">{ev.customerName}</p>
                      <p className="text-xs text-slate-500 truncate flex items-center gap-1">
                        {ev.venue || 'No venue'} ·{' '}
                        <button
                          onClick={() => goToBookingDetails(ev.booking_id, ev.booking_type)}
                          className="text-[#008A45] hover:underline font-semibold inline-flex items-center gap-0.5 cursor-pointer"
                          title="View full booking details"
                        >
                          {ev.ref} <ExternalLink size={10} />
                        </button>
                      </p>
                      {ev.source === 'estimated' && (
                        <p className="text-[12.5px] text-amber-700 font-semibold mt-0.5">Estimated from package (not yet manually assigned)</p>
                      )}
                    </div>
                    <div className="text-right shrink-0 flex items-center gap-3">
                      <span className="font-bold text-[#008A45]">× {ev.quantity}</span>
                      {ev.assignment_id ? (
                        <button
                          onClick={async () => { await handleReturnEquipment(ev.assignment_id); setIsAvailabilityDetailOpen(false); }}
                          className={evCanReturn
                            ? 'text-blue-500 hover:text-blue-700 transition-colors flex items-center gap-1 text-xs font-medium'
                            : 'text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1 text-xs font-medium'}
                          title={evCanReturn ? undefined : `Locked — returns open 3 hours after the event, at ${formatReturnOpensAt(evReturnOpensAt)}`}
                        >
                          {evCanReturn ? <Undo2 size={13} /> : <Lock size={13} />} Return
                        </button>
                      ) : (
                        <span className="text-[13px] text-slate-500">No return action</span>
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

      {/* ADD EQUIPMENT MODAL */}
      {isAddModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Add New Equipment</h2>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAddEquipment} className="p-6 space-y-5 text-left">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipment Name *</label>
                  <input
                    type="text"
                    name="equipmentName"
                    value={addFormData.equipmentName}
                    onChange={handleAddInputChange}
                    placeholder="e.g. Infinity Chairs"
                    className={errorInputClass(!!addFieldErrors.equipmentName, 'w-full border rounded-lg p-2.5 text-sm bg-white focus:ring-2 outline-none font-medium text-slate-800')}
                    required
                  />
                  {addFieldErrors.equipmentName && <p className="text-xs text-red-600 font-semibold mt-1">{addFieldErrors.equipmentName}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Total Quantity *</label>
                  <input
                    type="number"
                    name="quantity"
                    min="1"
                    value={addFormData.quantity}
                    onChange={handleAddInputChange}
                    className={errorInputClass(!!addFieldErrors.quantity, 'w-full border rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 outline-none')}
                    required
                  />
                  {addFieldErrors.quantity && <p className="text-xs text-red-600 font-semibold mt-1">{addFieldErrors.quantity}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Damaged Quantity</label>
                  <input
                    type="number"
                    name="damagedQuantity"
                    min="0"
                    value={addFormData.damagedQuantity}
                    onChange={handleAddInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-red-600 focus:ring-2 focus:ring-red-200 focus:border-red-400 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Maintenance Quantity</label>
                  <input
                    type="number"
                    name="maintenanceQuantity"
                    min="0"
                    value={addFormData.maintenanceQuantity}
                    onChange={handleAddInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-amber-600 focus:ring-2 focus:ring-amber-200 focus:border-amber-400 outline-none"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-400 -mt-2">Damaged + Maintenance cannot exceed Total Quantity. Overall condition is set automatically from these counts.</p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipment Type</label>
                <Select
                  name="equipmentType"
                  value={addFormData.equipmentType}
                  onChange={handleAddInputChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                >
                  <option value="Countable">Countable (chairs, plates, etc.)</option>
                  <option value="Decoration">Decoration / Per Event</option>
                </Select>
                <p className="text-xs text-slate-400 mt-1">
                  <span className="font-semibold">Countable:</span> quantity is tracked per unit.
                  <br />
                  <span className="font-semibold">Decoration:</span> usually assigned as 1 per event.
                </p>
              </div>
              {addFormData.equipmentType === 'Countable' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">
                    Pax per Unit
                    <span className="font-normal text-slate-400 ml-1">(how many guests can each unit serve?)</span>
                  </label>
                  <input
                    type="number"
                    name="paxPerUnit"
                    min="1"
                    value={addFormData.paxPerUnit}
                    onChange={handleAddInputChange}
                    placeholder="e.g., 1 for chair, 10 for table"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">Used to auto‑calculate needed quantity based on guest count.</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Description</label>
                <textarea
                  name="description"
                  rows="3"
                  placeholder="Type description..."
                  value={addFormData.description}
                  onChange={handleAddInputChange}
                  className="w-full border border-slate-300 rounded-lg p-3 text-sm text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setIsAddModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer">Cancel</button>
                <button type="submit" disabled={isSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50">
                  {isSubmitting ? 'Adding...' : 'Add Equipment'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* EDIT EQUIPMENT MODAL */}
      {isEditModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Edit Equipment</h2>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"><X size={18} /></button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 space-y-5 text-left">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipment Name *</label>
                  <input type="text" name="eqm_name" value={editFormData.eqm_name} onChange={handleEditInputChange} className={errorInputClass(!!editFieldErrors.eqm_name, 'w-full border rounded-lg p-2.5 text-sm bg-white focus:ring-2 outline-none font-medium text-slate-800')} required />
                  {editFieldErrors.eqm_name && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.eqm_name}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Total Quantity *</label>
                  <input type="number" name="quantity_available" min="0" value={editFormData.quantity_available} onChange={handleEditInputChange} className={errorInputClass(!!editFieldErrors.quantity_available, 'w-full border rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 outline-none')} required />
                  {editFieldErrors.quantity_available && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.quantity_available}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Damaged Quantity</label>
                  <input type="number" name="damaged_quantity" min="0" value={editFormData.damaged_quantity} onChange={handleEditInputChange} className={errorInputClass(!!editFieldErrors.damaged_quantity, 'w-full border rounded-lg p-2.5 text-sm font-semibold text-red-600 focus:ring-2 outline-none')} />
                  {editFieldErrors.damaged_quantity && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.damaged_quantity}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Maintenance Quantity</label>
                  <input type="number" name="maintenance_quantity" min="0" value={editFormData.maintenance_quantity} onChange={handleEditInputChange} className={errorInputClass(!!editFieldErrors.maintenance_quantity, 'w-full border rounded-lg p-2.5 text-sm font-semibold text-amber-600 focus:ring-2 outline-none')} />
                  {editFieldErrors.maintenance_quantity && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.maintenance_quantity}</p>}
                </div>
              </div>
              <p className="text-xs text-slate-400 -mt-2">Damaged + Maintenance cannot exceed Total Quantity. Overall condition is set automatically from these counts.</p>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Equipment Type</label>
                <Select name="equipment_type" value={editFormData.equipment_type} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none">
                  <option value="Countable">Countable (chairs, plates, etc.)</option>
                  <option value="Decoration">Decoration / Per Event</option>
                </Select>
              </div>
              {editFormData.equipment_type === 'Countable' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Pax per Unit</label>
                  <input type="number" name="pax_per_unit" min="1" value={editFormData.pax_per_unit || ''} onChange={handleEditInputChange} placeholder="e.g., 1 for chair, 10 for table" className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none" />
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Description</label>
                <textarea name="eqm_description" rows="3" placeholder="Type description..." value={editFormData.eqm_description} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-3 text-sm text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none" />
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

      {/* FLAG ISSUE MODAL — quick shortcut to mark damaged/maintenance */}
      {isFlagIssueModalOpen && flagIssueItem && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                  <Wrench size={15} className="text-amber-700" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Flag an issue</h2>
                  <p className="text-xs text-slate-500">{flagIssueItem.eqm_name}</p>
                </div>
              </div>
              <button onClick={() => setIsFlagIssueModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"><X size={18} /></button>
            </div>
            <form onSubmit={handleFlagIssueSubmit} className="p-6 space-y-4 text-left">
              <p className="text-xs text-slate-500 -mt-1">
                This item has <span className="font-semibold text-slate-700">{getStockBreakdown(flagIssueItem).total} units</span> in
                total. Whatever you don't flag here stays usable and can still be assigned to events.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Damaged</label>
                  <input
                    type="number"
                    name="damaged_quantity"
                    min="0"
                    value={flagIssueForm.damaged_quantity}
                    onChange={handleFlagIssueInputChange}
                    className={errorInputClass(!!flagIssueErrors.damaged_quantity, 'w-full border rounded-lg p-2.5 text-sm font-semibold text-red-600 focus:ring-2 outline-none')}
                  />
                  {flagIssueErrors.damaged_quantity && <p className="text-xs text-red-600 font-semibold mt-1">{flagIssueErrors.damaged_quantity}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Under Maintenance</label>
                  <input
                    type="number"
                    name="maintenance_quantity"
                    min="0"
                    value={flagIssueForm.maintenance_quantity}
                    onChange={handleFlagIssueInputChange}
                    className={errorInputClass(!!flagIssueErrors.maintenance_quantity, 'w-full border rounded-lg p-2.5 text-sm font-semibold text-amber-600 focus:ring-2 outline-none')}
                  />
                  {flagIssueErrors.maintenance_quantity && <p className="text-xs text-red-600 font-semibold mt-1">{flagIssueErrors.maintenance_quantity}</p>}
                </div>
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

      {/* ASSIGN EQUIPMENT MODAL - with Searchable Booking Dropdown + live date availability */}
      {isAssignModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Assign Equipment</h2>
                <p className="text-xs text-slate-500">Select a booking and add multiple equipment items</p>
              </div>
              <button
                onClick={() => {
                  setIsAssignModalOpen(false);
                  setAssignmentQueue([]);
                  setAssignFormData({ booking_id: '', notes: '' });
                  setBookingSearchTerm('');
                  setShowBookingDropdown(false);
                  setAssignBookingLocked(false);
                }}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAssignSubmit} className="p-6 overflow-y-auto space-y-5 text-left">
              {/* Booking Selection — a read-only chip when the modal was
                  opened for one specific event, a searchable dropdown when
                  opened from the page header with no booking decided yet. */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  {assignBookingLocked ? 'Assigning to' : 'Select Booking'}
                </label>
                {assignBookingLocked ? (
                  <div className="flex items-center justify-between gap-3 w-full px-3 py-2.5 border border-[#008A45]/40 bg-[#EAF3F2] rounded-lg">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold text-slate-800">
                          {selectedBooking ? getBookingRef(selectedBooking) : '—'}
                        </span>
                        <span className="text-sm font-semibold text-slate-900 truncate">
                          {selectedBooking?.customer
                            ? `${selectedBooking.customer.first_name} ${selectedBooking.customer.last_name}`
                            : 'Unknown'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {selectedBooking?.event_datetime
                          ? new Date(selectedBooking.event_datetime).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                          : 'No date'}
                        {selectedBooking?.venue ? ` · ${selectedBooking.venue}` : ''}
                      </p>
                    </div>
                    {/* No "change booking" affordance on purpose. This modal
                        was opened for one specific event, so switching the
                        target here is only ever a mistake — assigning that
                        event's equipment to a different booking. To assign
                        elsewhere, close this and use that event's own Assign
                        button, or the page header for a free choice. */}
                    <Lock size={13} className="shrink-0 text-[#008A45]" />
                  </div>
                ) : (
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      type="text"
                      placeholder="Search by customer name or booking ref..."
                      value={bookingSearchTerm}
                      onChange={(e) => {
                        setBookingSearchTerm(e.target.value);
                        setShowBookingDropdown(true);
                      }}
                      onFocus={() => setShowBookingDropdown(true)}
                      className="w-full pl-9 pr-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                    />
                  </div>
                  {showBookingDropdown && (
                    <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                      {filteredBookings.length === 0 ? (
                        // Says why, not just "nothing here" — the most
                        // likely reason a manager finds no match is that
                        // they searched a booking still awaiting approval.
                        <div className="p-3 text-sm text-slate-500 text-center">
                          No approved bookings found.
                          <span className="block text-xs text-slate-400 mt-1">
                            Only Approved and Confirmed bookings can have equipment assigned — approve the booking first, which allocates its package equipment automatically.
                          </span>
                        </div>
                      ) : (
                        filteredBookings.map((b) => {
                          const ref = getBookingRef(b);
                          const customerName = b.customer ? `${b.customer.first_name} ${b.customer.last_name}` : 'Unknown';
                          const eventDate = b.event_datetime ? new Date(b.event_datetime).toLocaleDateString() : 'No date';
                          return (
                            <button
                              key={b.booking_id}
                              type="button"
                              onClick={() => {
                                // Switching booking invalidates anything
                                // already queued: those quantities were
                                // accepted against the previous event's date,
                                // and the new one may have far less free that
                                // day. Keeping them would show a list that
                                // passed a check no longer being applied,
                                // failing only at submit.
                                const switching = assignFormData.booking_id && assignFormData.booking_id !== b.booking_id;
                                if (switching && assignmentQueue.length > 0) {
                                  setAssignmentQueue([]);
                                  toast('Equipment list cleared — availability differs on the new booking’s date.', { icon: 'ℹ️' });
                                }
                                setAssignFormData(prev => ({ ...prev, booking_id: b.booking_id }));
                                setBookingSearchTerm(`${ref} - ${customerName}`);
                                setShowBookingDropdown(false);
                                setTempEquipId('');
                                setTempQuantity(1);
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-slate-800">{ref}</span>
                                <span className="text-[11.5px] font-semibold px-2.5 py-[3px] bg-blue-50 text-blue-700 rounded-full">
                                  Package
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
                )}
                {!assignBookingLocked && (
                  <p className="text-xs text-slate-400 mt-1">Type to search, then click a booking to select.</p>
                )}
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
                        selectedBooking.booking_status === 'Pending' ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                        'bg-slate-100 text-slate-700 border border-slate-200'
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
                      <span className="ml-2 text-[11.5px] font-semibold px-2.5 py-[3px] bg-blue-50 text-blue-700 rounded-full">
                        Package
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
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600">Type:</span>
                      <span className="font-semibold text-slate-900">{selectedBooking.booking_type || 'Package'}</span>
                    </div>
                    {selectedBooking.notes && (
                      <div className="col-span-2 text-xs text-slate-500 border-t border-slate-200 pt-2 mt-1">
                        <span className="font-medium text-slate-600">Notes:</span> {selectedBooking.notes}
                      </div>
                    )}
                  </div>

                  {/* Live availability for this event's date — surfaces a
                      conflict before the manager clicks Assign, instead of
                      after. */}
                  <div className="border-t border-slate-200 pt-3">
                    <p className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1.5">
                      <CalendarClock size={13} /> Availability on {new Date(selectedBooking.event_datetime).toLocaleDateString()}
                    </p>
                    {assignDateSnapshotLoading ? (
                      <p className="text-xs text-slate-400">Checking availability…</p>
                    ) : !assignDateSnapshot || assignDateSnapshot.items.length === 0 ? (
                      <p className="text-xs text-slate-400">No availability data.</p>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-32 overflow-y-auto pr-1">
                        {assignDateSnapshot.items
                          .filter(i => i.committed > 0 || i.free < i.quantity_available)
                          .map(i => (
                            <div key={i.equipment_id} className={`text-[12.5px] px-2 py-1 rounded-[7px] border ${i.free < 0 ? 'bg-red-50 border-red-200 text-red-700' : i.free === 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                              <span className="font-semibold">{i.eqm_name}:</span> {i.free} free
                            </div>
                          ))}
                        {assignDateSnapshot.items.every(i => i.committed === 0) && (
                          <p className="text-xs text-emerald-600 col-span-full">Nothing else committed on this date — full stock available.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ---- WHAT THIS PACKAGE CALLS FOR ----
                  Approval allocates the whole package template, so most of what
                  a booking needs is usually already there. Without seeing that,
                  a manager assigning here is guessing at what is left, and only
                  finds out something is already covered when addToQueue rejects
                  it. This states the position before anything is picked:
                  required, already allocated, still missing. */}
              {selectedBooking && (
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-[#fbfcfd] border-b border-slate-100">
                    <p className="text-[13px] font-bold text-slate-700 flex items-center gap-1.5">
                      <ClipboardList size={13} /> What this package calls for
                    </p>
                    {unqueuedShortLines.length > 0 && (
                      <button
                        type="button"
                        onClick={queueAllMissing}
                        className="inline-flex items-center gap-1.5 px-3 py-[7px] rounded-[9px] bg-[#008A45] hover:bg-[#007038] text-white text-[12.5px] font-semibold whitespace-nowrap transition-colors cursor-pointer"
                      >
                        <Plus size={13} /> Add all missing ({assignPlan.unitsShort})
                      </button>
                    )}
                  </div>

                  {!assignPlan.hasTemplate ? (
                    <p className="px-4 py-3 text-[13px] text-amber-700">
                      This package has no equipment template, so approval allocated nothing automatically. Everything for this event has to be assigned here.
                    </p>
                  ) : assignPlan.lines.length === 0 ? (
                    <p className="px-4 py-3 text-[13px] text-slate-600">Nothing recorded for this booking yet.</p>
                  ) : (
                    <>
                      <div className="max-h-40 overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-white border-b border-slate-100">
                              <th className="px-4 py-2 text-[11.5px] font-bold uppercase tracking-[0.05em] text-slate-600">Item</th>
                              <th className="px-3 py-2 text-[11.5px] font-bold uppercase tracking-[0.05em] text-slate-600 text-right whitespace-nowrap">Needs</th>
                              <th className="px-3 py-2 text-[11.5px] font-bold uppercase tracking-[0.05em] text-slate-600 text-right whitespace-nowrap">Allocated</th>
                              <th className="px-4 py-2 text-[11.5px] font-bold uppercase tracking-[0.05em] text-slate-600 text-right whitespace-nowrap">Missing</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {assignPlan.lines.map(l => {
                              const queued = assignmentQueue
                                .filter(q => q.equipment_id === l.equipment_id)
                                .reduce((sum, q) => sum + (q.quantity || 0), 0);
                              return (
                                <tr key={l.equipment_id} className={l.short > 0 ? 'bg-[#fefafa]' : ''}>
                                  <td className="px-4 py-2 text-[13px] text-slate-800">
                                    {l.name}
                                    {/* An item with no required figure was never in the
                                        template -- it is an extra someone added. */}
                                    {l.required === 0 && (
                                      <span className="ml-2 text-[11.5px] font-semibold px-2 py-[2px] rounded-full bg-slate-100 text-slate-600">Extra</span>
                                    )}
                                    {queued > 0 && (
                                      <span className="ml-2 text-[11.5px] font-semibold px-2 py-[2px] rounded-full bg-[#EAF3F2] text-[#00703a]">+{queued} queued</span>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 text-[13px] text-right tabular-nums text-slate-600">{l.required || '—'}</td>
                                  <td className="px-3 py-2 text-[13px] text-right tabular-nums text-slate-800">{l.assigned}</td>
                                  <td className={`px-4 py-2 text-[13px] text-right tabular-nums font-semibold ${l.short > 0 ? 'text-red-700' : 'text-slate-400'}`}>
                                    {l.short > 0 ? l.short : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <p className="px-4 py-2.5 border-t border-slate-100 bg-[#fbfcfd] text-[12.5px] text-slate-600">
                        {assignPlan.isReady
                          ? 'Everything this package calls for is already allocated. Anything added here is an extra on top of the template.'
                          : `${assignPlan.unitsShort} unit${assignPlan.unitsShort === 1 ? '' : 's'} still missing against the template.`}
                      </p>
                    </>
                  )}
                </div>
              )}

              {/* Add Equipment to Queue */}
              <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Add Equipment to Assignment List</label>
                <p className="text-[13px] text-slate-600 mb-2">
                  {assignDateSnapshotLoading
                    ? 'Checking what is free on this event’s date…'
                    : !selectedBooking
                      ? 'Pick a booking first — availability is counted for that event’s date, not overall stock.'
                      : assignDateSnapshot
                        ? <>Counts are what is free on <span className="font-semibold text-slate-700">{eventDateLabel}</span>, after other events booked that day.</>
                        : 'Showing total usable stock — availability for this date could not be loaded.'}
                </p>
                <div className={`flex flex-col sm:flex-row gap-2 ${!selectedBooking ? 'opacity-60' : ''}`}>
                  <Select
                    value={tempEquipId}
                    disabled={!selectedBooking}
                    onChange={(e) => {
                      setTempEquipId(e.target.value);
                      const equipId = e.target.value;
                      const equip = equipmentList.find(eq => eq.equipment_id === equipId);
                      if (selectedBooking && equip?.pax_per_unit && equip.equipment_type === 'Countable') {
                        const pax = selectedBooking.pax_count || 0;
                        const needed = Math.ceil(pax / equip.pax_per_unit);
                        if (needed > 0) {
                          setTempQuantity(needed);
                          toast(`Suggested quantity: ${needed} based on ${pax} pax.`, { icon: 'ℹ️' });
                        }
                      } else {
                        setTempQuantity(1);
                      }
                    }}
                    className="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  >
                    <option value="">Select equipment...</option>
                    {equipmentList.map((eq) => {
                      // Date-aware where possible. Falls back to total usable
                      // stock only when there is no date to scope to (no
                      // booking picked yet, or the snapshot still loading),
                      // and says which of the two it is showing rather than
                      // printing a bare number that could mean either.
                      const free = freeOnDateFor(eq.equipment_id);
                      const scoped = free !== null;
                      const shown = scoped ? free : getStockBreakdown(eq).usable;
                      return (
                        <option
                          key={eq.equipment_id}
                          value={eq.equipment_id}
                          disabled={scoped && shown === 0}
                        >
                          {eq.eqm_name} — {shown} {scoped ? `free on ${eventDateLabel}` : 'usable in stock'}
                          {scoped && shown === 0 ? ' (fully committed)' : ''}
                          {eq.equipment_type === 'Decoration' ? ' [Decoration]' : ''}
                          {eq.pax_per_unit ? ` · ${eq.pax_per_unit} pax/unit` : ''}
                        </option>
                      );
                    })}
                  </Select>
                  <input
                    type="number"
                    min="1"
                    value={tempQuantity}
                    disabled={!selectedBooking}
                    onChange={(e) => setTempQuantity(parseInt(e.target.value) || 1)}
                    className="w-20 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none disabled:bg-slate-100 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    onClick={addToQueue}
                    disabled={!selectedBooking}
                    title={!selectedBooking ? 'Select a booking first' : undefined}
                    className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1 disabled:bg-slate-300 disabled:cursor-not-allowed disabled:hover:bg-slate-300"
                  >
                    <Plus size={16} /> Add
                  </button>
                </div>
                {assignmentQueue.length > 0 && (
                  <div className="mt-3 space-y-1.5">
                    <p className="text-xs font-medium text-slate-600">Selected Equipment:</p>
                    {assignmentQueue.map((item) => {
                      const equip = equipmentList.find(e => e.equipment_id === item.equipment_id);
                      const isDecoration = equip?.equipment_type === 'Decoration';
                      return (
                        <div key={item.equipment_id} className="flex items-center justify-between bg-white border border-slate-200 rounded px-3 py-1.5 text-sm">
                          <span className="font-medium text-slate-700">
                            {equip?.eqm_name || 'Unknown'} × {item.quantity}
                            {isDecoration && <span className="ml-2 text-xs text-purple-600">(Decoration)</span>}
                            {equip?.pax_per_unit && !isDecoration && (
                              <span className="ml-2 text-xs text-slate-500">(each serves {equip.pax_per_unit} pax)</span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFromQueue(item.equipment_id)}
                            className="text-red-500 hover:text-red-700 text-xs font-bold"
                          >
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Notes (optional)</label>
                <textarea
                  name="notes"
                  rows="2"
                  placeholder="Any special instructions..."
                  value={assignFormData.notes}
                  onChange={handleAssignInputChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => {
                    setIsAssignModalOpen(false);
                    setAssignmentQueue([]);
                    setAssignFormData({ booking_id: '', notes: '' });
                    setBookingSearchTerm('');
                    setShowBookingDropdown(false);
                    setAssignBookingLocked(false);
                  }}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Assigning...' : `Assign ${assignmentQueue.length} Item${assignmentQueue.length !== 1 ? 's' : ''}`}
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
                Equipment Usage: {selectedEquipment?.eqm_name}
              </h3>
              <button onClick={() => setIsUsageModalOpen(false)} className="text-slate-400 hover:text-slate-600 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={20} />
              </button>
            </div>
            {usageRecords.length > 0 && (
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 shrink-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { key: 'All', label: 'All' },
                    { key: 'in_use', label: ASSIGNMENT_STAGES.in_use },
                    { key: 'assigned', label: ASSIGNMENT_STAGES.assigned },
                    { key: 'returned', label: ASSIGNMENT_STAGES.returned },
                  ].map(opt => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => setUsageStatusFilter(opt.key)}
                      disabled={usageStageCounts[opt.key] === 0}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                        usageStatusFilter === opt.key
                          ? 'bg-[#008A45] border-[#008A45] text-white'
                          : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {opt.label} ({usageStageCounts[opt.key]})
                    </button>
                  ))}
                </div>
                <p className="text-[13px] text-slate-600 mt-2">
                  Still-out records first (longest outstanding at the top), then upcoming reservations, then returned — most recent first.
                </p>
              </div>
            )}
            <div className="p-4 overflow-y-auto flex-1">
              {usageRecords.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">No usage records found.</p>
              ) : visibleUsageRecords.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-8">No {ASSIGNMENT_STAGES[usageStatusFilter]?.toLowerCase() || ''} records for this item.</p>
              ) : (
                <div className="space-y-3">
                  {visibleUsageRecords.map(record => {
                    const booking = record.booking;
                    const customerName = booking?.customer
                      ? `${booking.customer.first_name} ${booking.customer.last_name}`
                      : 'Unknown';
                    const bookingRef = booking?.booking_number ||
                      (booking?.booking_id ?
                        (booking.booking_type === 'Short Order' ? 'SO' : 'BKG') + '-' + booking.booking_id.slice(0, 8)
                        : 'N/A');
                    const status = record.stage;
                    return (
                      <div key={record.assignment_id} className={`border rounded-lg p-3 flex justify-between items-center gap-3 ${record.returned ? 'bg-slate-50 border-slate-200' : status.key === 'in_use' ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 text-sm">{customerName}</p>
                          <p className="text-xs text-slate-500">{booking?.venue || 'No venue'} · {booking?.event_datetime ? new Date(booking.event_datetime).toLocaleDateString() : 'N/A'}</p>
                          <p className="text-xs text-slate-500">Booking: {bookingRef} · Quantity: <span className="font-bold text-[#008A45]">{record.quantity}</span></p>
                          {record.returned && record.returned_at && (
                            <p className="text-xs text-slate-500">
                              Returned {new Date(record.returned_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${record.returned ? 'bg-green-100 text-green-700' : status.key === 'in_use' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                            {status.label}
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
