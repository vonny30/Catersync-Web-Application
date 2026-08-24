// src/pages/Equipment.jsx
import { useState, useEffect, useRef } from 'react';
import Select from '../components/Select';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Plus, Edit, Trash2, X, Settings, ClipboardList, RefreshCw, Undo2,
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
import { getAssignmentStatus } from '../utils/statusLabels';
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

  // --- "Damaged or under repair" card -> the Inventory tab, filtered ---
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

  const addToQueue = () => {
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
    // assignDateSnapshot is already loaded for the selected booking's date.
    const dateRow = assignDateSnapshot?.items?.find(i => i.equipment_id === tempEquipId);
    const freeOnDate = dateRow ? getStockBreakdown(dateRow).free : getStockBreakdown(equip).usable;
    if (tempQuantity > freeOnDate) {
      toast.error(
        dateRow
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
    await fetchEquipmentUsage(item.equipment_id);
    setIsUsageModalOpen(true);
  };

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

  // Overdue: not returned and past the 24-hour return deadline — see the
  // RETURN POLICY block at the top of this file. Deliberately based on
  // "now", not the date selected in the Availability tab, since this asks
  // "is anything overdue right now", not "overdue relative to whatever
  // date I'm browsing". Uses the same due-time rule as assignmentGroups'
  // isOverdue below, so the tab badge and the rows can't disagree — this
  // previously counted from the event date while the rows counted from
  // the deadline.
  const now = new Date();
  const overdueAssignments = assignments.filter(a => {
    if (a.returned || !a.booking?.event_datetime) return false;
    const dueAt = getReturnDueAt(a.booking.event_datetime);
    return dueAt && dueAt < now;
  });
  const overdueUnits = overdueAssignments.reduce((sum, a) => sum + (a.quantity || 0), 0);

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
  const upcomingPrep = bookings
    .filter(b => ACTIVE_BOOKING_STATUSES.includes(b.booking_status) && isInPrepWindow(b))
    .map(b => {
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
      const unitsShort = shortLines.reduce((sum, l) => sum + l.short, 0);
      const daysUntil = Math.ceil((new Date(b.event_datetime) - now) / (24 * 60 * 60 * 1000));

      return {
        ...b,
        lines,
        shortLines,
        unitsShort,
        hasTemplate: (templateByPackage[b.package_id] || []).length > 0,
        totalAssignedUnits: Object.values(assignedByEquipment).reduce((s, n) => s + n, 0),
        isReady: shortLines.length === 0,
        canAssign: canAssignEquipmentTo(b.booking_status),
        daysUntil,
      };
    });

  const eventsNeedingPrep = upcomingPrep.filter(e => !e.isReady);

  // Shown as a read-only note on the Upcoming tab, not as prep work:
  // these are requests waiting on an approve/reject decision, and that
  // decision — not equipment — is the next action.
  const pendingUpcoming = bookings.filter(b => b.booking_status === 'Pending' && isInPrepWindow(b));

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
        if (historySort.field === 'equipment') result = (a.equipment?.eqm_name || '').localeCompare(b.equipment?.eqm_name || '');
        else if (historySort.field === 'eventDate') result = new Date(a.booking?.event_datetime || 0) - new Date(b.booking?.event_datetime || 0);
        else if (historySort.field === 'assignedOn') result = new Date(a.assigned_at || 0) - new Date(b.assigned_at || 0);
        return historySort.direction === 'asc' ? result : -result;
      })
    : filteredHistoryRows;

  // --- RENDER ---
  return (
    <div className="space-y-6 relative pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Equipment</h1>
          <p className="text-sm text-slate-500">See what's actually free on a given date, manage inventory, and track assignments</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setAddFieldErrors({}); setIsAddModalOpen(true); }}
            className="bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-xs cursor-pointer"
          >
            <Settings size={16} /> Add Stock
          </button>
          <button
            onClick={() => { setAssignmentQueue([]); setBookingSearchTerm(''); setShowBookingDropdown(false); setIsAssignModalOpen(true); }}
            className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2.5 rounded-lg font-semibold transition-colors flex items-center gap-2 text-sm shadow-sm cursor-pointer"
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
        <button
          onClick={() => setActiveTableTab('upcoming')}
          className={`bg-white border border-slate-200 border-l-4 rounded-2xl p-5 text-left shadow-sm transition-all cursor-pointer group ${eventsNeedingPrep.length > 0 ? 'border-l-amber-500 hover:shadow-md' : 'border-l-[#008A45] hover:shadow-md'}`}
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Events needing prep</p>
          <h3 className={`text-3xl font-extrabold ${eventsNeedingPrep.length > 0 ? 'text-amber-600' : 'text-[#008A45]'}`}>{eventsNeedingPrep.length}</h3>
          <p className="text-[11px] text-slate-500 mt-1 group-hover:text-[#008A45] transition-colors">
            {upcomingPrep.length === 0
              ? 'No events in the next 14 days'
              : eventsNeedingPrep.length > 0
                ? `of ${upcomingPrep.length} upcoming — missing equipment →`
                : `all ${upcomingPrep.length} upcoming events ready →`}
          </p>
        </button>

        <button
          onClick={showNeedsAttentionInInventory}
          className={`bg-white border border-slate-200 border-l-4 rounded-2xl p-5 text-left shadow-sm transition-all cursor-pointer group ${needsAttentionUnits > 0 ? 'border-l-red-500 hover:shadow-md' : 'border-l-slate-300'}`}
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Damaged or under repair</p>
          <h3 className={`text-3xl font-extrabold ${needsAttentionUnits > 0 ? 'text-red-600' : 'text-slate-400'}`}>{needsAttentionUnits}</h3>
          <p className="text-[11px] text-slate-500 mt-1 group-hover:text-[#008A45] transition-colors">
            {needsAttentionUnits > 0 ? 'Never counted as available →' : 'Nothing needs attention'}
          </p>
        </button>

        <button
          onClick={() => { setAssignmentSectionFilter('Overdue'); setActiveTableTab('assignments'); }}
          className={`bg-white border border-slate-200 border-l-4 rounded-2xl p-5 text-left shadow-sm transition-all cursor-pointer group ${overdueGroups.length > 0 ? 'border-l-red-500 hover:shadow-md' : 'border-l-slate-300'}`}
        >
          <p className="text-xs font-semibold text-slate-600 mb-1">Overdue returns</p>
          <h3 className={`text-3xl font-extrabold ${overdueGroups.length > 0 ? 'text-red-600' : 'text-slate-400'}`}>{overdueGroups.length}</h3>
          <p className="text-[11px] text-slate-500 mt-1 group-hover:text-[#008A45] transition-colors">
            {overdueGroups.length > 0 ? 'Past the 24-hour return window →' : 'All returns up to date'}
          </p>
        </button>
      </div>

      {/* --- MAIN WORKSPACE: one full-width tabbed panel. The alerts that
      used to sit in a 320px sidebar here are now the two clickable cards
      above, which link into the same places the sidebar's "View all"
      buttons did. --- */}
      <div>

      {/* --- TAB CONTROL --- */}
      <div ref={availabilityPanelRef} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-2 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-1 flex-wrap">
            {/* Upcoming leads the tabs because preparing for what's coming
                is the job this page exists for; the other three support it
                (what's free, what we own, what's out). */}
            <button
              onClick={() => setActiveTableTab('upcoming')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${activeTableTab === 'upcoming' ? 'bg-white shadow-sm text-[#008A45] border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Calendar size={14} /> Upcoming
              {eventsNeedingPrep.length > 0 && (
                <span className="ml-0.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold bg-amber-500 text-white">
                  {eventsNeedingPrep.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTableTab('availability')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${activeTableTab === 'availability' ? 'bg-white shadow-sm text-[#008A45] border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <CalendarClock size={14} /> Availability
            </button>
            <button
              onClick={() => setActiveTableTab('inventory')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${activeTableTab === 'inventory' ? 'bg-white shadow-sm text-[#008A45] border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <LayoutGrid size={14} /> Inventory
            </button>
            <button
              onClick={() => setActiveTableTab('assignments')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${activeTableTab === 'assignments' ? 'bg-white shadow-sm text-[#008A45] border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <ClipboardList size={14} /> Active Assignments
              {activeAssignmentRows.length > 0 && (
                <span className={`ml-0.5 inline-flex items-center justify-center min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold ${overdueUnits > 0 ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                  {assignmentGroups.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTableTab('history')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer ${activeTableTab === 'history' ? 'bg-white shadow-sm text-[#008A45] border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <History size={14} /> History
            </button>
          </div>
          {/* One line per tab, describing the step of the equipment
              process it covers: what we own → what's free on a date →
              what's out right now → what happened historically. */}
          <p className="text-xs text-slate-500 px-1 pt-2">
            {activeTableTab === 'upcoming' && <>Events in the next {PREP_HORIZON_DAYS} days — the package each one booked, what that package requires at its pax count, and what's still to assign.</>}
            {activeTableTab === 'availability' && <>What's free to assign on a chosen date, after subtracting what's already committed.</>}
            {activeTableTab === 'inventory' && <>Everything we own — add stock, edit details, or flag damage and repairs.</>}
            {activeTableTab === 'assignments' && <>Everything currently out at an event and not yet returned. {RETURN_POLICY_TEXT}</>}
            {activeTableTab === 'history' && <>The full log of every assignment ever made — assigned and returned — across all equipment.</>}
          </p>
        </div>

        {/* ===== UPCOMING PREP TAB ===== */}
        {/* Answers the panel's two questions in one place: which packages
            are coming up, and what equipment is assigned for them. Each
            event expands to a required-vs-assigned breakdown so the gap is
            explicit rather than something the manager has to work out by
            cross-referencing the package template against the assignment
            list themselves. */}
        {activeTableTab === 'upcoming' && (
          <div className="divide-y divide-slate-200">
            {/* Pending requests are surfaced as a count, not as rows. They
                have no allocation yet by design (approval is what
                allocates), so listing them as prep work would report the
                normal state of an un-reviewed request as a shortage. */}
            {pendingUpcoming.length > 0 && (
              <div className="px-4 py-2.5 bg-slate-50 flex items-center gap-2 text-xs text-slate-600">
                <AlertTriangle size={13} className="text-slate-400 shrink-0" />
                <span>
                  <span className="font-bold text-slate-800">{pendingUpcoming.length}</span> pending request{pendingUpcoming.length === 1 ? '' : 's'} in this window {pendingUpcoming.length === 1 ? 'is' : 'are'} awaiting approval — equipment is allocated once approved, so {pendingUpcoming.length === 1 ? 'it does' : 'they do'} not appear as prep work here.
                </span>
              </div>
            )}
            {isLoading ? (
              <p className="p-6 text-center text-slate-400 text-sm">Loading upcoming events…</p>
            ) : upcomingPrep.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-slate-500">No events scheduled in the next {PREP_HORIZON_DAYS} days.</p>
                <p className="text-xs text-slate-400 mt-1">Confirmed and pending package bookings appear here as their event date approaches.</p>
              </div>
            ) : (
              upcomingPrep.map(ev => {
                const customerName = ev.customer ? `${ev.customer.first_name} ${ev.customer.last_name}` : 'Unknown';
                const ref = getBookingRef(ev);
                return (
                  <details key={ev.booking_id} open={!ev.isReady} className="group/prep">
                    <summary className={`p-4 cursor-pointer list-none flex items-center justify-between gap-3 flex-wrap hover:bg-slate-50 transition-colors ${!ev.isReady ? 'bg-amber-50/40' : ''}`}>
                      <div className="flex items-center gap-3 flex-wrap min-w-0">
                        <span className="text-slate-400 group-open/prep:rotate-90 transition-transform inline-block">▸</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${ev.isReady ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-amber-100 text-amber-800 border-amber-300'}`}>
                          {ev.isReady ? 'READY' : `${ev.unitsShort} UNIT${ev.unitsShort === 1 ? '' : 'S'} SHORT`}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); goToBookingDetails(ev.booking_id, ev.booking_type); }}
                          className="font-mono text-xs font-bold text-[#008A45] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                          title="View full booking details"
                        >
                          {ref} <ExternalLink size={10} />
                        </button>
                        <span className="font-bold text-slate-900 text-sm truncate">{customerName}</span>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200">
                          {ev.package?.pkg_name || 'No package'}
                        </span>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Users size={11} /> {ev.pax_count || 0} pax
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Calendar size={11} />
                          {new Date(ev.event_datetime).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className={`text-[11px] font-bold ${ev.daysUntil <= 1 ? 'text-red-600' : ev.daysUntil <= 3 ? 'text-amber-600' : 'text-slate-500'}`}>
                          {ev.daysUntil <= 0 ? 'Today' : ev.daysUntil === 1 ? 'Tomorrow' : `in ${ev.daysUntil} days`}
                        </span>
                      </div>
                    </summary>

                    <div className="px-4 pb-4 pt-1 bg-slate-50/50">
                      {ev.venue && (
                        <p className="text-xs text-slate-500 flex items-center gap-1 mb-3">
                          <MapPin size={11} /> {ev.venue}
                        </p>
                      )}

                      {ev.lines.length === 0 ? (
                        <div className="text-xs text-slate-500 italic py-2">
                          {ev.hasTemplate
                            ? 'This package lists no equipment, and nothing has been assigned.'
                            : 'This package has no equipment template set up, and nothing has been assigned yet — assign items manually, or add an equipment template to the package so future bookings know what they need.'}
                        </div>
                      ) : (
                        <>
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                                <th className="py-2 font-bold">Equipment</th>
                                <th className="py-2 font-bold text-center w-24">Required</th>
                                <th className="py-2 font-bold text-center w-24">Assigned</th>
                                <th className="py-2 font-bold text-right w-32">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {ev.lines.map(line => (
                                <tr key={line.equipment_id}>
                                  <td className="py-2 text-slate-800 font-medium">{line.name}</td>
                                  <td className="py-2 text-center text-slate-600">{line.required || '—'}</td>
                                  <td className="py-2 text-center font-semibold text-slate-900">{line.assigned || '—'}</td>
                                  <td className="py-2 text-right">
                                    {line.short > 0 ? (
                                      <span className="text-xs font-bold text-amber-700">{line.short} to assign</span>
                                    ) : line.extra > 0 ? (
                                      <span className="text-xs font-medium text-slate-500" title="Assigned beyond what the package template lists">+{line.extra} extra</span>
                                    ) : (
                                      <span className="text-xs font-medium text-emerald-600">Complete</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {!ev.hasTemplate && (
                            <p className="text-[11px] text-slate-500 italic mt-2">
                              This package has no equipment template, so "Required" is blank — these rows are what was assigned manually.
                            </p>
                          )}
                        </>
                      )}

                      {/* Confirmed events stay listed — they are still
                          events to prepare for, and a shortage on one is
                          worth seeing precisely because it can no longer be
                          fixed by assigning. What changes is the action:
                          the booking is locked, so Assign is disabled with
                          the reason rather than failing on click. */}
                      <div className="flex items-center gap-2 mt-3 flex-wrap">
                        {ev.canAssign ? (
                          <button
                            onClick={() => {
                              setAssignmentQueue([]);
                              setBookingSearchTerm(ref);
                              setShowBookingDropdown(false);
                              setIsAssignModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1.5 bg-[#008A45] hover:bg-[#007038] text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                          >
                            <ClipboardList size={13} /> Assign equipment
                          </button>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-500 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200"
                            title={`Equipment can't be assigned once a booking is ${ev.booking_status}`}
                          >
                            <Lock size={13} /> Locked — {ev.booking_status}
                          </span>
                        )}
                        <span className="text-[11px] text-slate-500">
                          {ev.totalAssignedUnits} unit{ev.totalAssignedUnits === 1 ? '' : 's'} assigned so far
                        </span>
                        {!ev.canAssign && !ev.isReady && (
                          <span className="text-[11px] font-semibold text-amber-700">
                            Short, and no longer assignable — resolve on the booking itself.
                          </span>
                        )}
                      </div>
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
                <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                  <th className="p-4">{renderSortHeader(availabilitySort, toggleAvailabilitySort, 'name', 'Equipment')}</th>
                  <th className="p-4 font-bold text-center">Usable</th>
                  <th className="p-4 font-bold text-center">In use on this date</th>
                  <th className="p-4 text-center">{renderSortHeader(availabilitySort, toggleAvailabilitySort, 'free', 'Available', 'justify-center mx-auto')}</th>
                  <th className="p-4 font-bold">Status</th>
                  <th className="p-4 font-bold w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
                {isLoading || snapshotLoading ? (
                  <tr><td colSpan="6" className="p-6 text-center text-slate-400">Calculating availability…</td></tr>
                ) : filteredAvailabilityItems.length === 0 ? (
                  <tr><td colSpan="6" className="p-6 text-center text-slate-400 italic">No equipment matches your search/filter.</td></tr>
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
                        className={`hover:bg-slate-50 transition-colors cursor-pointer group ${status.key === 'overbooked' ? 'bg-red-50/40' : ''}`}
                      >
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-slate-900">{item.eqm_name}</p>
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${item.equipment_type === 'Decoration' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
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
                        <td className="p-4 text-center font-bold text-slate-900">{stock.usable}</td>
                        <td className="p-4 text-center font-semibold text-slate-700">{stock.committed} <span className="text-slate-400 font-normal">units</span></td>
                        <td className="p-4 text-center">
                          <span className={`inline-flex items-center justify-center min-w-[3rem] px-3 py-1 rounded-full text-xl font-extrabold ${status.key === 'overbooked' ? 'bg-red-100 text-red-700' : status.rank === 1 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {stock.free}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${status.pillClass}`}>{status.label}</span>
                            <div className="w-14 h-1.5 rounded-full bg-slate-200 overflow-hidden shrink-0">
                              <div className={`h-full ${status.barColor}`} style={{ width: `${Math.round(availableRatio * 100)}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-right">
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
                <span className="font-bold text-red-600">{needsAttentionUnits}</span> out of service (damaged or under repair)
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
                  <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                    <th className="p-4">{renderSortHeader(inventorySort, toggleInventorySort, 'name', 'Equipment')}</th>
                    <th className="p-4 font-bold text-center">Owned</th>
                    <th className="p-4 font-bold text-center">Damaged</th>
                    <th className="p-4 font-bold text-center">Under Maintenance</th>
                    <th className="p-4 font-bold text-center">Usable</th>
                    <th className="p-4 font-bold text-center">Type</th>
                    <th className="p-4 font-bold text-center">Guests per Unit</th>
                    <th className="p-4 font-bold text-center">Out now</th>
                    <th className="p-4 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
                  {isLoading ? (
                    <tr><td colSpan="9" className="p-6 text-center text-slate-400">Loading equipment...</td></tr>
                  ) : filteredInventory.length === 0 ? (
                    <tr><td colSpan="9" className="p-6 text-center text-slate-400 italic">No equipment found.</td></tr>
                  ) : (
                    sortedFilteredInventory.map((item) => {
                      const usageCount = assignments.filter(a => a.equipment_id === item.equipment_id && !a.returned).length;
                      const stock = getStockBreakdown(item);
                      const condition = getConditionSummary(item);
                      return (
                        <tr key={item.equipment_id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-slate-900">{item.eqm_name}</p>
                              {condition.dbValue !== 'Good Condition' && (
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold border ${condition.className}`}>
                                  {condition.label}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">{item.eqm_description}</p>
                          </td>
                          <td className="p-4 text-center font-semibold text-slate-800">{stock.total}</td>
                          <td className="p-4 text-center font-semibold text-red-600">{stock.damaged}</td>
                          <td className="p-4 text-center font-semibold text-amber-600">{stock.maintenance}</td>
                          <td className="p-4 text-center font-bold text-slate-900">{stock.usable}</td>
                          <td className="p-4 text-center">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${item.equipment_type === 'Decoration' ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-blue-50 border-blue-200 text-blue-700'}`}>
                              {item.equipment_type === 'Decoration' ? 'Decoration' : 'Countable'}
                            </span>
                          </td>
                          <td className="p-4 text-center font-semibold text-slate-900">
                            {item.pax_per_unit ? `${item.pax_per_unit} pax` : '—'}
                          </td>
                          <td className="p-4 text-center">
                            <button
                              onClick={() => handleViewUsage(item)}
                              className="text-blue-500 hover:text-blue-700 transition-colors text-xs font-medium flex items-center gap-1 mx-auto"
                            >
                              <ClipboardList size={14} />
                              {usageCount > 0 ? `${usageCount} out now` : 'View history'}
                            </button>
                          </td>
                          <td className="p-4 text-right">
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
        <div className="max-h-[32rem] overflow-y-auto divide-y divide-slate-200">
          {isLoading ? (
            <p className="p-6 text-center text-slate-400 text-sm">Loading assignments...</p>
          ) : assignmentGroups.length === 0 ? (
            <p className="p-6 text-center text-slate-400 italic text-sm">No active assignments.</p>
          ) : filteredAssignmentGroups.length === 0 ? (
            <p className="p-6 text-center text-slate-400 italic text-sm">No assignments match your search/filter.</p>
          ) : (
            sortedFilteredAssignmentGroups.map((group) => {
              const ref = group.booking ? getBookingRef(group.booking) : 'Unknown';
              const customerName = group.booking?.customer ? `${group.booking.customer.first_name} ${group.booking.customer.last_name}` : 'Unknown';
              return (
                <details key={group.booking_id} open={group.isOverdue || group.isToday} className="group/details">
                  <summary className={`p-4 cursor-pointer list-none flex items-center justify-between gap-3 flex-wrap hover:bg-slate-50 transition-colors ${group.isOverdue ? 'bg-red-50/40' : ''}`}>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-slate-400 group-open/details:rotate-90 transition-transform inline-block">▸</span>
                      {group.isOverdue && (() => {
                        // Says how far past the 24-hour return deadline this
                        // is, rather than just "OVERDUE" — one day late and
                        // a week late are very different problems.
                        const late = daysOverdue(group.dueAt);
                        return (
                          <span
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-300"
                            title={group.dueAt ? `Was due back ${group.dueAt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : undefined}
                          >
                            <AlertTriangle size={10} /> OVERDUE{late > 0 ? ` · ${late}d` : ''}
                          </span>
                        );
                      })()}
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
              <p className="text-xs text-slate-400">{filteredHistoryRows.length} of {assignments.length} record{assignments.length !== 1 ? 's' : ''} shown{historySort.field ? '' : ', most recent first'}</p>
            </div>
            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200 sticky top-0">
                    <th className="p-4">{renderSortHeader(historySort, toggleHistorySort, 'equipment', 'Equipment')}</th>
                    <th className="p-4 font-bold">Booking</th>
                    <th className="p-4 font-bold text-center">Quantity</th>
                    <th className="p-4">{renderSortHeader(historySort, toggleHistorySort, 'eventDate', 'Event date')}</th>
                    <th className="p-4">{renderSortHeader(historySort, toggleHistorySort, 'assignedOn', 'Assigned on')}</th>
                    <th className="p-4 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
                  {isLoading ? (
                    <tr><td colSpan="6" className="p-6 text-center text-slate-400">Loading history...</td></tr>
                  ) : filteredHistoryRows.length === 0 ? (
                    <tr><td colSpan="6" className="p-6 text-center text-slate-400 italic">No assignment history matches your search/filter.</td></tr>
                  ) : (
                    sortedFilteredHistoryRows.map((a) => {
                      const ref = a.booking ? getBookingRef(a.booking) : 'Unknown';
                      const customerName = a.booking?.customer ? `${a.booking.customer.first_name} ${a.booking.customer.last_name}` : 'Unknown';
                      return (
                        <tr key={a.assignment_id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4 font-semibold text-slate-900">{a.equipment?.eqm_name || 'Unknown'}</td>
                          <td className="p-4">
                            <p className="font-medium text-slate-800">{customerName}</p>
                            <p className="text-xs text-slate-500 flex items-center gap-2">
                              {a.booking ? (
                                <button
                                  onClick={() => goToBookingDetails(a.booking.booking_id, a.booking.booking_type)}
                                  className="font-mono font-bold text-[#008A45] hover:underline inline-flex items-center gap-0.5 cursor-pointer"
                                  title="View full booking details"
                                >
                                  {ref} <ExternalLink size={10} />
                                </button>
                              ) : (
                                <span className="font-mono font-bold">{ref}</span>
                              )}
                              {a.booking?.venue && <span className="flex items-center gap-1"><MapPin size={10} /> {a.booking.venue}</span>}
                            </p>
                          </td>
                          <td className="p-4 text-center font-bold text-[#008A45]">{a.quantity}</td>
                          <td className="p-4 text-slate-600">{a.booking?.event_datetime ? new Date(a.booking.event_datetime).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}</td>
                          <td className="p-4 text-slate-500">{a.assigned_at ? new Date(a.assigned_at).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A'}</td>
                          <td className="p-4">
                            {a.returned ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600">
                                <CheckCircle2 size={12} /> Returned {a.returned_at ? new Date(a.returned_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}
                              </span>
                            ) : (() => {
                              const status = getAssignmentStatus(a.returned, a.booking?.event_datetime);
                              return (
                                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${status.key === 'in_use' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'}`}>
                                  {status.label}
                                </span>
                              );
                            })()}
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
                            className="font-mono font-bold text-[#008A45] hover:underline flex items-center gap-1 cursor-pointer"
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
                          <p className="text-xs text-slate-400 italic">No equipment assigned to this booking yet.</p>
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
                <p className="text-xs text-slate-500 mt-0.5">Free on {selectedDateLabel}: <span className={`font-bold ${availabilityDetailItem.free < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{availabilityDetailItem.free}</span> of {availabilityDetailItem.quantity_available} total</p>
              </div>
              <button onClick={() => setIsAvailabilityDetailOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"><X size={18} /></button>
            </div>
            <div className="p-4 overflow-y-auto flex-1 space-y-2">
              {availabilityDetailItem.events.length === 0 ? (
                <p className="text-sm text-slate-500 italic text-center py-8">No events using this item on this date.</p>
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
                        <p className="text-[10px] text-amber-600 font-semibold mt-0.5">Estimated from package (not yet manually assigned)</p>
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
                        <span className="text-[10px] text-slate-400">No return action</span>
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
                  setBookingSearchTerm('');
                  setShowBookingDropdown(false);
                }}
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
                                setAssignFormData(prev => ({ ...prev, booking_id: b.booking_id }));
                                setBookingSearchTerm(`${ref} - ${customerName}`);
                                setShowBookingDropdown(false);
                              }}
                              className="w-full text-left px-4 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0 transition-colors"
                            >
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-slate-800">{ref}</span>
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-100 text-blue-700 border border-blue-200 rounded-full">
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
                      <span className="ml-2 text-[10px] font-bold px-2 py-0.5 bg-blue-100 text-blue-700 border border-blue-200 rounded-full">
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
                            <div key={i.equipment_id} className={`text-[11px] px-2 py-1 rounded border ${i.free < 0 ? 'bg-red-50 border-red-200 text-red-700' : i.free === 0 ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
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

              {/* Add Equipment to Queue */}
              <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Add Equipment to Assignment List</label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Select
                    value={tempEquipId}
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
                    {equipmentList.map((eq) => (
                      <option key={eq.equipment_id} value={eq.equipment_id}>
                        {eq.eqm_name} ({eq.quantity_available} in stock) {eq.equipment_type === 'Decoration' ? '[Decoration]' : ''}
                        {eq.pax_per_unit ? ` - ${eq.pax_per_unit} pax/unit` : ''}
                      </option>
                    ))}
                  </Select>
                  <input
                    type="number"
                    min="1"
                    value={tempQuantity}
                    onChange={(e) => setTempQuantity(parseInt(e.target.value) || 1)}
                    className="w-20 border border-slate-300 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
                  <button
                    type="button"
                    onClick={addToQueue}
                    className="bg-[#008A45] hover:bg-[#007038] text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-1"
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
                    setBookingSearchTerm('');
                    setShowBookingDropdown(false);
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
            <div className="p-4 overflow-y-auto flex-1">
              {equipmentUsage.length === 0 ? (
                <p className="text-sm text-slate-500 italic text-center py-8">No usage records found.</p>
              ) : (
                <div className="space-y-3">
                  {equipmentUsage.map(record => {
                    const booking = record.booking;
                    const customerName = booking?.customer
                      ? `${booking.customer.first_name} ${booking.customer.last_name}`
                      : 'Unknown';
                    const bookingRef = booking?.booking_number ||
                      (booking?.booking_id ?
                        (booking.booking_type === 'Short Order' ? 'SO' : 'BKG') + '-' + booking.booking_id.slice(0, 8)
                        : 'N/A');
                    const status = getAssignmentStatus(record.returned, booking?.event_datetime);
                    return (
                      <div key={record.assignment_id} className={`border rounded-lg p-3 flex justify-between items-center ${record.returned ? 'bg-slate-50 border-slate-200' : status.key === 'in_use' ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                        <div>
                          <p className="font-bold text-slate-900 text-sm">{customerName}</p>
                          <p className="text-xs text-slate-500">{booking?.venue || 'No venue'} · {booking?.event_datetime ? new Date(booking.event_datetime).toLocaleDateString() : 'N/A'}</p>
                          <p className="text-xs text-slate-500">Booking: {bookingRef} · Quantity: <span className="font-bold text-[#008A45]">{record.quantity}</span></p>
                        </div>
                        <div className="text-right">
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
