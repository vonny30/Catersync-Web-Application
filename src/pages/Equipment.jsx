// src/pages/Equipment.jsx
import { useState, useEffect, useRef } from 'react';
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
import { errorInputClass } from '../utils/formErrors';
import { getDailyEquipmentSnapshot, checkEquipmentAvailabilityImpact } from '../utils/equipment.jsx';
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

// Equipment can't physically come back until the event it's out for is
// actually happening or over — returning it "early" (before the event
// even starts) had no trap at all before this. Gives a 3-hour grace period
// past the event's start (covers events that run long) before Return
// becomes usable. No event_datetime at all (shouldn't normally happen) is
// treated as returnable, rather than permanently locking the item out.
const RETURN_GRACE_MS = 3 * 60 * 60 * 1000;
const getReturnAvailability = (eventDatetimeStr) => {
  if (!eventDatetimeStr) return { canReturn: true, opensAt: null };
  const opensAt = new Date(new Date(eventDatetimeStr).getTime() + RETURN_GRACE_MS);
  return { canReturn: Date.now() >= opensAt.getTime(), opensAt };
};
const formatReturnOpensAt = (opensAt) =>
  opensAt ? opensAt.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

// Every "is this equipment currently out" status display used to only
// know two states — returned or not — and showed "In use"/"Assigned" for
// literally any not-yet-returned row regardless of whether the event had
// even started. An item assigned to an event three days from now isn't
// "in use" yet, it's just reserved. Adds the missing middle state: an
// assignment is only actually "In Use" from the event's start time until
// it's marked returned; before that (or with no event_datetime at all)
// it's "Assigned".
const getEquipmentAssignmentStatus = (returned, eventDatetimeStr) => {
  if (returned) return { key: 'returned', label: 'Returned' };
  if (eventDatetimeStr && new Date(eventDatetimeStr) > new Date()) {
    return { key: 'assigned', label: 'Assigned' };
  }
  return { key: 'in_use', label: 'In Use' };
};

export default function Equipment() {
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();

  // --- STATE ---
  const [equipmentList, setEquipmentList] = useState([]);
  const [assignments, setAssignments] = useState([]); // ALL booking_equipment rows (returned + active) — feeds Usage history and the grouped Active Assignments section
  const [bookings, setBookings] = useState([]); // Package bookings, for the Assign modal's booking picker
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
  const [activeTableTab, setActiveTableTab] = useState('availability'); // 'availability' | 'inventory' | 'assignments' | 'history'
  const [inventorySearch, setInventorySearch] = useState('');
  const [inventoryTypeFilter, setInventoryTypeFilter] = useState('All'); // 'All' | 'Countable' | 'Decoration'

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

  // --- Equipment Detail Modal State (for the "Needs Attention" card) ---
  const [isEquipmentModalOpen, setIsEquipmentModalOpen] = useState(false);
  const [equipmentModalData, setEquipmentModalData] = useState([]);
  const [equipmentModalTitle, setEquipmentModalTitle] = useState('');

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

      const { data: bookingData, error: bookingError } = await supabase
        .from('booking')
        .select(`
          booking_id, booking_number, booking_type, booking_status, event_datetime, venue, pax_count, notes,
          customer:customer_id (first_name, last_name, contact_no, cus_address)
        `)
        .eq('booking_type', 'Package')
        .in('booking_status', [...ACTIVE_BOOKING_STATUSES, 'Pending'])
        .order('event_datetime', { ascending: true });
      if (bookingError) throw bookingError;
      setBookings(bookingData || []);
      setFilteredBookings(bookingData || []);

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

  // --- "Needs Attention" card click ---
  const handleEquipmentCardClick = (filterFn, title) => {
    const filtered = equipmentList.filter(filterFn);
    setEquipmentModalData(filtered);
    setEquipmentModalTitle(title);
    setIsEquipmentModalOpen(true);
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
      toast.success('Equipment added successfully!');
      await fetchData();
    } catch (error) {
      handleError(error, 'Failed to add equipment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- EDIT EQUIPMENT ---
  const handleEditClick = (item) => {
    const total = item.quantity_available + (item.damaged_quantity || 0) + (item.maintenance_quantity || 0);
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
      toast.success('Equipment updated successfully!');
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

    const total = flagIssueItem.quantity_available + (flagIssueItem.damaged_quantity || 0) + (flagIssueItem.maintenance_quantity || 0);
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
    const confirmed = await showConfirm({
      title: 'Delete Equipment?',
      message: 'Are you sure you want to delete this equipment? This action cannot be undone.',
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: 'Deleting this equipment is permanent. Re-enter your password to continue.',
    });
    if (!passwordOk) return;

    try {
      const { count, error: countError } = await supabase
        .from('booking_equipment')
        .select('*', { count: 'exact', head: true })
        .eq('equipment_id', id)
        .eq('returned', false);
      if (countError) throw countError;
      if (count > 0) {
        toast.error(`Cannot delete this equipment because it is currently assigned to ${count} active booking(s). Please return it first.`);
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
        toast.error(`Cannot delete this equipment because it has ${historyCount} past assignment record(s) in its history. Deleting it would erase that history.`);
        return;
      }

      const { count: pkgCount, error: pkgCountError } = await supabase
        .from('package_equipment')
        .select('*', { count: 'exact', head: true })
        .eq('equipment_id', id);
      if (pkgCountError) throw pkgCountError;
      if (pkgCount > 0) {
        toast.error(`Cannot delete this equipment because it is used in ${pkgCount} package template(s). Remove it from packages first.`);
        return;
      }

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

    if (tempQuantity > equip.quantity_available) {
      toast.error(`Only ${equip.quantity_available} "${equip.eqm_name}" in stock — can't assign ${tempQuantity}.`);
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

    // Quantity-aware capacity check — equipment isn't exclusive to one event
    // per day, there's just a finite amount of it. Sum what's already
    // committed to OTHER bookings on the same date and make sure adding
    // this request wouldn't exceed total stock.
    const eventDate = selectedBooking?.event_datetime ? new Date(selectedBooking.event_datetime) : null;
    if (eventDate) {
      for (const item of assignmentQueue) {
        const equip = equipmentList.find(e => e.equipment_id === item.equipment_id);
        if (!equip) continue;
        const alreadyCommitted = assignments
          .filter(a =>
            a.equipment_id === item.equipment_id &&
            a.booking?.event_datetime &&
            new Date(a.booking.event_datetime).toDateString() === eventDate.toDateString() &&
            a.booking_id !== assignFormData.booking_id &&
            !a.returned
          )
          .reduce((sum, a) => sum + (a.quantity || 0), 0);
        const totalNeeded = alreadyCommitted + item.quantity;
        if (totalNeeded > equip.quantity_available) {
          toast.error(
            `"${equip.eqm_name}": ${alreadyCommitted} already committed to other events on ${eventDate.toLocaleDateString()}, ` +
            `plus ${item.quantity} requested exceeds the ${equip.quantity_available} in stock.`
          );
          return;
        }
      }
    }
    setIsSubmitting(true);

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
      toast.success(`Successfully assigned ${itemsToAssign.length} equipment item(s).`);
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
      toast.error(`Can't return this yet — available starting 3 hours after the event, at ${formatReturnOpensAt(opensAt)}.`);
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

      toast.success('Equipment returned successfully!');
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
      toast.error(`Can't return these yet — available starting 3 hours after the event, at ${formatReturnOpensAt(opensAt)}.`);
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

      toast.success('All items for this event marked as returned.');
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

  // --- Jump to the Active Assignments tab (Overdue Returns card) ---
  const scrollToAssignments = () => {
    setActiveTableTab('assignments');
  };

  // --- Jump to the Availability tab (In use / Free to use stat cards) —
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
  const totalStockAll = equipmentList.reduce((sum, eq) => sum + (eq.quantity_available || 0), 0);
  const unitsCommitted = snapshot.items.reduce((sum, item) => sum + (item.committed || 0), 0);
  const unitsFree = totalStockAll - unitsCommitted;
  const needsAttentionUnits = equipmentList.reduce((sum, eq) => sum + (eq.damaged_quantity || 0) + (eq.maintenance_quantity || 0), 0);

  // Top few problem items for the sidebar panel — live/always-current, not
  // scoped to the date picker, so it's kept visually separate from the
  // date-scoped stat cards above.
  const needsAttentionItems = equipmentList
    .filter(eq => (eq.damaged_quantity || 0) > 0 || (eq.maintenance_quantity || 0) > 0)
    .sort((a, b) => ((b.damaged_quantity || 0) + (b.maintenance_quantity || 0)) - ((a.damaged_quantity || 0) + (a.maintenance_quantity || 0)));

  // Overdue: not returned, event date already passed — deliberately based
  // on "now", not the selected date on the page, since this is asking "is
  // anything overdue right now", not "overdue relative to whatever date
  // I'm browsing".
  const now = new Date();
  const overdueAssignments = assignments.filter(a => !a.returned && a.booking?.event_datetime && new Date(a.booking.event_datetime) < now);
  const overdueUnits = overdueAssignments.reduce((sum, a) => sum + (a.quantity || 0), 0);

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
  const getAvailabilityStatus = (item) => {
    const total = item.quantity_available || 0;
    if (item.committed > total) return { key: 'overbooked', label: `Short by ${item.committed - total}`, rank: 0, barColor: 'bg-red-600', textColor: 'text-red-700', pillClass: 'bg-red-100 border-red-300 text-red-700' };
    if (total > 0 && item.free === 0) return { key: 'fully', label: 'Fully committed', rank: 1, barColor: 'bg-amber-500', textColor: 'text-amber-700', pillClass: 'bg-amber-100 border-amber-300 text-amber-700' };
    if (total > 0 && item.free / total < 0.2) return { key: 'tight', label: 'Low stock', rank: 1, barColor: 'bg-amber-500', textColor: 'text-amber-700', pillClass: 'bg-amber-100 border-amber-300 text-amber-700' };
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
    if (inventoryTypeFilter !== 'All' && item.equipment_type !== inventoryTypeFilter) return false;
    if (inventorySearch) {
      const term = inventorySearch.toLowerCase();
      if (!item.eqm_name.toLowerCase().includes(term) && !(item.eqm_description || '').toLowerCase().includes(term)) return false;
    }
    return true;
  });

  const activeInventoryFilterCount = (inventorySearch.trim() ? 1 : 0) + (inventoryTypeFilter !== 'All' ? 1 : 0);

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

  // Overdue events for the sidebar panel — already sorted overdue-first by
  // assignmentGroups' own sort, so just filter.
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
        const status = getEquipmentAssignmentStatus(a.returned, a.booking?.event_datetime);
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
      returns" are live/always-current, not tied to the date picker, so they
      no longer live in this row — mixing the two scopes in one row read as
      "the cards only work for today" even when a different date was picked.
      They now live in the sidebar below instead. --- */}
      <div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            onClick={() => setIsEventsModalOpen(true)}
            className="bg-white border border-slate-200 border-l-4 border-l-[#008A45] rounded-2xl p-5 text-center shadow-sm hover:shadow-md transition-all cursor-pointer group"
          >
            <p className="text-xs font-semibold text-slate-600 mb-1">Events on this date</p>
            <h3 className="text-3xl font-extrabold text-slate-900">{snapshot.eventsOnDate.length}</h3>
            <p className="text-[10px] text-slate-400 group-hover:text-[#008A45] transition-colors mt-1">Click to view</p>
          </button>
          <button
            onClick={() => scrollToAvailability('All')}
            className="bg-white border border-slate-200 border-l-4 border-l-blue-500 rounded-2xl p-5 text-center shadow-sm hover:shadow-md transition-all cursor-pointer group"
          >
            <p className="text-xs font-semibold text-slate-600 mb-1">In use on this date</p>
            <h3 className="text-3xl font-extrabold text-blue-700">{unitsCommitted}</h3>
            <p className="text-[10px] text-slate-400 group-hover:text-blue-600 transition-colors mt-1">units across all events → Availability tab</p>
          </button>
          <button
            onClick={() => scrollToAvailability('available')}
            className="bg-white border border-slate-200 border-l-4 border-l-emerald-500 rounded-2xl p-5 text-center shadow-sm hover:shadow-md transition-all cursor-pointer group"
          >
            <p className="text-xs font-semibold text-slate-600 mb-1">Free to use</p>
            <h3 className={`text-3xl font-extrabold ${unitsFree < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{unitsFree}</h3>
            <p className="text-[10px] text-slate-400 group-hover:text-emerald-600 transition-colors mt-1">units left → Availability tab</p>
          </button>
        </div>
        <p className="text-center text-[11px] font-semibold text-blue-500 mt-2">Date-scoped — follows the date selected above</p>
      </div>

      {/* --- MAIN WORKSPACE: tabbed panel takes priority on the left; live
      operational alerts (not tied to the date picker) sit in a narrower
      sidebar on the right, so their "always current" scope is visually
      separated from the date-scoped cards above instead of blended into
      one row. --- */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">

      {/* --- TAB CONTROL --- */}
      <div ref={availabilityPanelRef} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-2 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-1">
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
          <p className="text-xs text-slate-500 px-1 pt-2">
            {activeTableTab === 'availability' && <>Every item's free/committed status for <span className="font-semibold text-slate-700">{selectedDateLabel}</span>.</>}
            {activeTableTab === 'inventory' && <>The full equipment list — edit details, add new items, or flag damage/maintenance.</>}
            {activeTableTab === 'assignments' && <>Everything currently out at any event, regardless of the date selected above.</>}
            {activeTableTab === 'history' && <>The full log of every assignment ever made — assigned and returned — across all equipment.</>}
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
                  placeholder="Search equipment name..."
                  value={availabilitySearch}
                  onChange={(e) => setAvailabilitySearch(e.target.value)}
                  className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${availabilitySearch.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
                />
              </div>
              <select
                value={availabilityTypeFilter}
                onChange={(e) => setAvailabilityTypeFilter(e.target.value)}
                className={`border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${availabilityTypeFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
              >
                <option value="All">All types</option>
                <option value="Countable">Countable</option>
                <option value="Decoration">Decoration</option>
              </select>
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
                  <th className="p-4 font-bold text-center">Total stock</th>
                  <th className="p-4 font-bold text-center">Damaged / Under Maintenance</th>
                  <th className="p-4 font-bold text-center">In use on this date</th>
                  <th className="p-4 text-center">{renderSortHeader(availabilitySort, toggleAvailabilitySort, 'free', 'Free to use', 'justify-center mx-auto')}</th>
                  <th className="p-4 font-bold">Status</th>
                  <th className="p-4 font-bold w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
                {isLoading || snapshotLoading ? (
                  <tr><td colSpan="7" className="p-6 text-center text-slate-400">Calculating availability…</td></tr>
                ) : filteredAvailabilityItems.length === 0 ? (
                  <tr><td colSpan="7" className="p-6 text-center text-slate-400 italic">No equipment matches your search/filter.</td></tr>
                ) : (
                  sortedFilteredAvailabilityItems.map((item) => {
                    const status = getAvailabilityStatus(item);
                    const outOfService = (item.damaged_quantity || 0) + (item.maintenance_quantity || 0);
                    const total = item.quantity_available || 0;
                    const usedRatio = total > 0 ? Math.min(1, item.committed / total) : (item.committed > 0 ? 1 : 0);
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
                        </td>
                        <td className="p-4 text-center font-semibold text-slate-800">{total}</td>
                        <td className="p-4 text-center text-slate-600">
                          {outOfService > 0 ? (
                            <span title={`${item.damaged_quantity || 0} damaged, ${item.maintenance_quantity || 0} under maintenance`}>
                              {item.damaged_quantity || 0} damaged, {item.maintenance_quantity || 0} under maintenance
                            </span>
                          ) : <span className="text-slate-400">None</span>}
                        </td>
                        <td className="p-4 text-center font-semibold text-slate-700">{item.committed} <span className="text-slate-400 font-normal">units</span></td>
                        <td className="p-4 text-center">
                          <span className={`inline-flex items-center justify-center min-w-[3rem] px-3 py-1 rounded-full text-xl font-extrabold ${status.key === 'overbooked' ? 'bg-red-100 text-red-700' : status.rank === 1 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                            {item.free}
                          </span>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${status.pillClass}`}>{status.label}</span>
                            <div className="w-14 h-1.5 rounded-full bg-slate-200 overflow-hidden shrink-0">
                              <div className={`h-full ${status.barColor}`} style={{ width: `${Math.round(usedRatio * 100)}%` }} />
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
                  placeholder="Search equipment name or description..."
                  value={inventorySearch}
                  onChange={(e) => setInventorySearch(e.target.value)}
                  className={`w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white ${inventorySearch.trim() ? 'border-emerald-300' : 'border-slate-300'}`}
                />
              </div>
              <select
                value={inventoryTypeFilter}
                onChange={(e) => setInventoryTypeFilter(e.target.value)}
                className={`border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none ${inventoryTypeFilter !== 'All' ? 'border-emerald-300' : 'border-slate-300'}`}
              >
                <option value="All">All types</option>
                <option value="Countable">Countable</option>
                <option value="Decoration">Decoration</option>
              </select>
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
                  <tr className="bg-[#EAF3F2] text-slate-800 text-sm border-b border-slate-200">
                    <th className="p-4">{renderSortHeader(inventorySort, toggleInventorySort, 'name', 'Equipment')}</th>
                    <th className="p-4 font-bold text-center">Total stock</th>
                    <th className="p-4 font-bold text-center">Damaged</th>
                    <th className="p-4 font-bold text-center">Under Maintenance</th>
                    <th className="p-4 font-bold text-center">Type</th>
                    <th className="p-4 font-bold text-center">Guests per Unit</th>
                    <th className="p-4 font-bold text-center">Usage</th>
                    <th className="p-4 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm text-slate-700">
                  {isLoading ? (
                    <tr><td colSpan="8" className="p-6 text-center text-slate-400">Loading equipment...</td></tr>
                  ) : filteredInventory.length === 0 ? (
                    <tr><td colSpan="8" className="p-6 text-center text-slate-400 italic">No equipment found.</td></tr>
                  ) : (
                    sortedFilteredInventory.map((item) => {
                      const usageCount = assignments.filter(a => a.equipment_id === item.equipment_id && !a.returned).length;
                      const total = item.quantity_available + (item.damaged_quantity || 0) + (item.maintenance_quantity || 0);
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
                          <td className="p-4 text-center font-semibold text-slate-800">{total}</td>
                          <td className="p-4 text-center font-semibold text-red-600">{item.damaged_quantity || 0}</td>
                          <td className="p-4 text-center font-semibold text-amber-600">{item.maintenance_quantity || 0}</td>
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
                              {usageCount > 0 ? `${usageCount} in use` : 'No usage'}
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
            <select
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
            </select>
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
                      <span className="text-xs font-semibold text-slate-500">{group.items.length} item type{group.items.length !== 1 ? 's' : ''} · {group.totalUnits} units</span>
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
                        <span className="font-medium text-slate-700">{a.equipment?.eqm_name || 'Unknown'} × <span className="font-bold text-[#008A45]">{a.quantity}</span></span>
                        <button
                          onClick={() => handleReturnEquipment(a.assignment_id)}
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
                              const status = getEquipmentAssignmentStatus(a.returned, a.booking?.event_datetime);
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

      {/* --- SIDEBAR: live operational alerts, always-current (not tied to
      the date picker above) --- */}
      <div className="space-y-4">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <span className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
              <AlertTriangle size={14} className="text-red-500" /> Needs Attention ({needsAttentionUnits})
            </span>
            <button
              onClick={() => handleEquipmentCardClick(eq => (eq.damaged_quantity || 0) > 0 || (eq.maintenance_quantity || 0) > 0, 'Needs Attention')}
              className="text-xs font-semibold text-[#008A45] hover:underline cursor-pointer"
            >
              View all
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {needsAttentionItems.length === 0 ? (
              <p className="p-4 text-xs text-slate-400 italic">Nothing needs attention right now.</p>
            ) : (
              needsAttentionItems.slice(0, 4).map(eq => {
                const damaged = eq.damaged_quantity || 0;
                const maintenance = eq.maintenance_quantity || 0;
                return (
                  <button
                    key={eq.equipment_id}
                    type="button"
                    onClick={() => handleFlagIssueClick(eq)}
                    title="Click to update this item's damaged / in-repair count"
                    className="w-full flex items-center justify-between px-4 py-2.5 gap-2 text-left hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{eq.eqm_name}</p>
                      <p className="text-xs text-slate-500">{damaged > 0 && maintenance > 0 ? 'Damaged & under maintenance' : damaged > 0 ? 'Damaged' : 'Under maintenance'}</p>
                    </div>
                    <span className="shrink-0 inline-flex items-center justify-center min-w-[1.75rem] h-7 px-2 rounded-full text-xs font-bold bg-red-100 text-red-700">{damaged + maintenance}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
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
              <p className="p-4 text-xs text-slate-400 italic">No overdue returns.</p>
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
                    className="w-full flex items-center justify-between px-4 py-2.5 gap-2 text-left hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-red-700 truncate">{customerName}</p>
                      <p className="text-xs text-slate-500">{group.items.length} item{group.items.length !== 1 ? 's' : ''} overdue</p>
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
                              const eqiStatus = getEquipmentAssignmentStatus(eqi.returned, ev.event_datetime);
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
                <select
                  name="equipmentType"
                  value={addFormData.equipmentType}
                  onChange={handleAddInputChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                >
                  <option value="Countable">Countable (chairs, plates, etc.)</option>
                  <option value="Decoration">Decoration / Per Event</option>
                </select>
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
                <select name="equipment_type" value={editFormData.equipment_type} onChange={handleEditInputChange} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none">
                  <option value="Countable">Countable (chairs, plates, etc.)</option>
                  <option value="Decoration">Decoration / Per Event</option>
                </select>
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
                Set how many units are damaged or under maintenance. The rest of the total stock ({flagIssueItem.quantity_available + (flagIssueItem.damaged_quantity || 0) + (flagIssueItem.maintenance_quantity || 0)} units) stays available automatically.
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
                        <div className="p-3 text-sm text-slate-500 text-center">No bookings found.</div>
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
                  <select
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
                  </select>
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
                    const status = getEquipmentAssignmentStatus(record.returned, booking?.event_datetime);
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

      {/* NEEDS ATTENTION MODAL (Clickable Card) */}
      {isEquipmentModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0 bg-white">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{equipmentModalTitle}</h2>
                <p className="text-xs text-slate-500 mt-0.5">{equipmentModalData.length} item(s) found</p>
              </div>
              <button
                onClick={() => setIsEquipmentModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {equipmentModalData.length === 0 ? (
                <div className="text-center py-10 text-slate-500">Nothing needs attention right now.</div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-slate-700 text-xs font-bold border-b border-slate-200">
                      <th className="p-3">Equipment</th>
                      <th className="p-3 text-center">Damaged</th>
                      <th className="p-3 text-center">Under Maintenance</th>
                      <th className="p-3 text-center">Available</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {equipmentModalData.map((item) => (
                      <tr key={item.equipment_id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3">
                          <p className="font-bold text-slate-900">{item.eqm_name}</p>
                          <p className="text-xs text-slate-500">{item.eqm_description}</p>
                        </td>
                        <td className="p-3 text-center font-semibold text-red-600">{item.damaged_quantity || 0}</td>
                        <td className="p-3 text-center font-semibold text-amber-600">{item.maintenance_quantity || 0}</td>
                        <td className="p-3 text-center font-semibold text-emerald-700">{item.quantity_available}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200 shrink-0">
              <button
                onClick={() => setIsEquipmentModalOpen(false)}
                className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
