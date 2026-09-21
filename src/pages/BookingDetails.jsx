// src/pages/BookingDetails.jsx
import { useState, useEffect, useMemo} from 'react';
import Select from '../components/Select';
import AssignVehicleModal from '../components/AssignVehicleModal';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, X, Plus, RefreshCw, Edit, Trash2, Lock, ClipboardList, Search,
  MapPin, Calendar, User, Phone, Mail, Pencil, UtensilsCrossed, Briefcase, CreditCard, Truck, ArrowUpRight, ArrowDownLeft, AlertTriangle, ChevronDown, ChevronRight, ShieldAlert } from 'lucide-react';
import { SectionHeader, SectionCard, Field, CardScrollArea } from '../components/DetailPrimitives';
import { initialsOf, fmtDateTime, fmtShortDate, fmtTime, displayNotes } from '../utils/detailFormat';
import { createPortal } from 'react-dom';
import { supabase } from '../supabase';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { usePasswordConfirm } from '../contexts/PasswordConfirmContext';
import { usePaymentHandlers } from '../hooks/usePaymentHandlers';
import { useRealtimeRefresh } from '../hooks/useRealtimeRefresh';
import { useApprovalHandlers, extraPaxRate } from '../hooks/useApprovalHandlers';
import { useRejectionHandlers } from '../hooks/useRejectionHandlers';
import { useCancellationHandlers } from '../hooks/useCancellationHandlers';
import { useVerificationHandlers } from '../hooks/useVerificationHandlers';
import { useConfirmationHandlers } from '../hooks/useConfirmationHandlers';
import { useCompletionHandlers } from '../hooks/useCompletionHandlers';
import { allocateEquipmentForBooking } from '../utils/equipment';
import { TRIP_LEG, countDistinctVehicles, groupDispatchRuns, hasRunDeparted, removeScheduledRun, runRemovalMessage } from '../utils/vehicle';
import { totalLossOnRecompute, totalLossLockedMessage, sumVerifiedPositivePayments, sumDepositsCollected, isPaymentLedgerLocked, formatPaymentDeletionWarning, movesBooks, isRefundEntry, ledgerEntryBadge, PENDING_VERIFICATION, REFUNDED_STATUS, ENTRY_TYPES, RECEIPT_METHODS, REFUND_METHOD_MESSAGE, VERIFY_METHODS } from '../utils/payments';
import { ACTIVE_BOOKING_STATUSES, bookingEditLockedMessage } from '../utils/bookingStatus';
import { isResourceLocked, resourceLockReason } from '../utils/resourceLock';
import ReviewFlagBanner from '../components/ReviewFlagBanner';
import {
  lapsedChipLabel, LAPSED_ACCEPT_TOOLTIP, LAPSED_DECLINE_REASON,
} from '../utils/lapsed';
import StatusHistory from '../components/StatusHistory';
import OverrideStatusModal from '../components/OverrideStatusModal';
import {
  fetchEquipmentAvailability, eventDayLabel, overAllocationWarning,
} from '../utils/equipmentAvailability';
import { toDateTimeLocalValue } from '../utils/datetimeLocal';
import { validatePaxForPackage } from '../utils/packageRules';
import { autoCompletePastEvents, hasUnpaidPastEvent } from '../utils/autoComplete';
import ApprovalAvailabilityCheck from '../components/ApprovalAvailabilityCheck';
import { errorInputClass } from '../utils/formErrors';
import DateTimePicker from '../components/DateTimePicker';
import { fetchAllRows } from '../utils/fetchAllRows';
import { getAssignmentStatus } from '../utils/statusLabels';
import ImageUploadField from '../components/ImageUploadField';
import RefundMethodField from '../components/RefundMethodField';
import { prepareRefundEvidence } from '../utils/refundEvidence';
import ReceiptFields from '../components/ReceiptFields';

// The allocation history for one booking, from booking_equipment_log. The log
// has no foreign keys (so a deleted booking or item cannot block it), which
// means names are resolved here rather than embedded. `changed_by` is an auth
// uid; a manager can read only their own manager row, so anyone else's change
// falls back to "A manager", as customer notes do.
async function fetchAllocationLog(bookingId) {
  try {
    const rows = await fetchAllRows(() => supabase
      .from('booking_equipment_log')
      .select('log_id, equipment_id, action, qty_before, qty_after, changed_by, changed_at')
      .eq('booking_id', bookingId)
      .order('changed_at', { ascending: false })
      .order('log_id', { ascending: true }), 'allocation history');
    if (rows.length === 0) return [];

    const equipmentIds = [...new Set(rows.map(r => r.equipment_id).filter(Boolean))];
    const userIds = [...new Set(rows.map(r => r.changed_by).filter(Boolean))];
    const [{ data: equipmentRows }, { data: managerRows }] = await Promise.all([
      equipmentIds.length
        ? supabase.from('equipment').select('equipment_id, eqm_name').in('equipment_id', equipmentIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? supabase.from('manager').select('user_id, first_name, last_name').in('user_id', userIds)
        : Promise.resolve({ data: [] }),
    ]);
    const nameOf = Object.fromEntries((equipmentRows || []).map(e => [e.equipment_id, e.eqm_name]));
    const managerOf = Object.fromEntries((managerRows || []).map(m => [m.user_id, `${m.first_name} ${m.last_name}`]));
    return rows.map(r => ({
      ...r,
      eqm_name: nameOf[r.equipment_id] || 'Equipment no longer listed',
      changed_by_name: managerOf[r.changed_by] || 'A manager',
    }));
  } catch (error) {
    // History is secondary to the allocation itself; never fail the page on it.
    console.error('Could not load the allocation history:', error);
    return [];
  }
}

// "5 → 8", "removed (was 2)" — what one log row did.
const describeAllocationChange = (row) => {
  if (row.action === 'changed') return `${row.qty_before} → ${row.qty_after}`;
  if (row.action === 'removed') return `removed (was ${row.qty_before})`;
  if (row.action === 'returned') return `returned (${row.qty_after} of ${row.qty_before})`;
  return `added (${row.qty_after})`;
};

// "18 Sep, 2:14 PM"
const formatLogTime = (value) => {
  const d = new Date(value);
  return `${d.getDate()} ${d.toLocaleString('en-US', { month: 'short' })}, ${d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
};

export default function BookingDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showConfirm } = useConfirm();
  const { requestPasswordConfirm } = usePasswordConfirm();

  // --- Local state (not duplicated) ---
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState([]);
  const [menuSelections, setMenuSelections] = useState([]);
  const [equipment, setEquipment] = useState([]);
  // { equipment_id: quantity } the package template would allocate for this
  // booking's pax, or null when it could not be derived (panel falls back to a
  // flat list). Derived on every load, never stored.
  const [templateDemand, setTemplateDemand] = useState(null);
  const [dispatches, setDispatches] = useState([]);
  const [isAssignVehicleOpen, setIsAssignVehicleOpen] = useState(false);
  // The one vehicle run being edited (a vehicle_assign row), or null.
  const [editingVehicleRun, setEditingVehicleRun] = useState(null);

  // --- Edit Modal state (unique) ---
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Field-level errors for the Edit Booking form — highlights exactly
  // which input is blocking submission (red border + inline message)
  // instead of only a toast.
  const [editFieldErrors, setEditFieldErrors] = useState({});
  const [customers, setCustomers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [packageCategories, setPackageCategories] = useState([]);
  const [categoryMenuItems, setCategoryMenuItems] = useState({});
  const [selectedPackageInfo, setSelectedPackageInfo] = useState(null); // ✅ NEW: store package pricing
  const [editFormData, setEditFormData] = useState({
    customer_id: '',
    package_id: '',
    booking_type: 'Package',
    event_datetime: '',
    venue: '',
    pax_count: '',
    motif_color: '',
    notes: '',
    total_amount: '',
    menu_selections: {},
  });

  // --- Equipment Assignment modal state (unique) ---
  const [isAssignEquipModalOpen, setIsAssignEquipModalOpen] = useState(false);
  const [equipmentList, setEquipmentList] = useState([]);
  const [assignEquipData, setAssignEquipData] = useState({ equipment_id: '', quantity: 1, notes: '' });
  const [isAssignSubmitting, setIsAssignSubmitting] = useState(false);
  const [equipSearchTerm, setEquipSearchTerm] = useState('');
  // Free units per item ON THIS BOOKING'S EVENT DATE, read when the Assign
  // modal opens. status: 'idle' | 'loading' | 'ready' | 'failed'. See
  // openAssignEquipModal for where the number comes from and its known gap.
  const [assignSnapshot, setAssignSnapshot] = useState({ status: 'idle', freeById: {} });

  // --- Edit Equipment Assignment modal state (unique) ---
  const [isEditEquipModalOpen, setIsEditEquipModalOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const [editEquipData, setEditEquipData] = useState({ quantity: 1 });
  // Changing a CONFIRMED booking's allocation is confirmed once per visit to
  // this booking, not once per line. Holds the booking id it was given for,
  // so moving to another booking asks again.
  const [confirmedEditAckFor, setConfirmedEditAckFor] = useState(null);
  // booking_equipment_log, written by trigger on every insert, quantity change,
  // removal and return. Read-only here: the page never inserts into it.
  const [allocationLog, setAllocationLog] = useState([]);
  const [isAllocationHistoryOpen, setIsAllocationHistoryOpen] = useState(false);

  // --- Refund after rejection/cancellation modal (still local) ---
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [refundModalAmount, setRefundModalAmount] = useState('');
  const [refundModalRemarks, setRefundModalRemarks] = useState('');
  const [refundModalFile, setRefundModalFile] = useState(null);
  const [refundModalMethod, setRefundModalMethod] = useState('');
  const [refundModalReceiptNo, setRefundModalReceiptNo] = useState('');
  const [isRefundSubmitting, setIsRefundSubmitting] = useState(false);

  // The booking's money and its two review flags, from v_booking_money.
  // This page computes plenty of its own payment figures for the refund and
  // completion paths; what it must NOT do is decide for itself whether the
  // system flagged this booking or what the outstanding balance is.
  const [money, setMoney] = useState(null);
  // Passed to isResourceLocked / resourceLockReason at every call site. A
  // lapsed booking holds nothing live in the database, so nothing it holds is
  // offered for change here.
  const lapsedLock = { lapsed: !!money?.is_lapsed };
  // What the package template says this booking should take, per item, from
  // v_booking_equipment_required — the view that owns that rule (per_pax ->
  // ceil(pax / pax_per_unit), otherwise the package's included_quantity).
  // Shown as a SUGGESTION the manager can overrule, never as a cap.
  const [suggestedById, setSuggestedById] = useState({});
  // usable / committed / free per item on the event's own date, from
  // f_equipment_availability. One source for the panel, the Assign modal's
  // labels and both write guards.
  const [availability, setAvailability] = useState({ status: 'idle', byId: {} });
  const [isOverrideOpen, setIsOverrideOpen] = useState(false);
  // Bumped after anything that can change the status, so the history list
  // re-reads without this page owning its rows.
  const [historyKey, setHistoryKey] = useState(0);

  // --- Proof Image Modal state ---
  const [isProofModalOpen, setIsProofModalOpen] = useState(false);
  const [proofModalUrl, setProofModalUrl] = useState('');

  // --- FETCH DATA ---
  const fetchBooking = async () => {
    setLoading(true);
    try {
      const { data: bookingData, error: bookingError } = await supabase
        .from('booking')
        .select(`
          *,
          customer:customer_id (first_name, last_name, contact_no, cus_address, email_address, customer_id),
          package:package_id (pkg_name, pkg_price, pkg_description, pricing_type, minimum_pax, max_pax, extra_pax_price)
        `)
        .eq('booking_id', id)
        .maybeSingle();
      if (bookingError) throw bookingError;
      setBooking(bookingData);
      if (!bookingData) {
        // The row is gone -- deleted here or from the mobile app while this
        // page was open. That is an ordinary outcome for a link that outlived
        // its record, so it renders as "not found" rather than raising an
        // error toast. .single() would have made it a 406 and thrown.
        return;
      }

      if (bookingData && !bookingData.is_read) {
        await supabase.from('booking').update({ is_read: true }).eq('booking_id', id);
        setBooking(prev => ({ ...prev, is_read: true }));
      }

      // The money row, including flagged_for_review / flag_reason: what the
      // database believes about this booking right now.
      const { data: moneyRow, error: moneyError } = await supabase
        .from('v_booking_money')
        .select('booking_id, outstanding, net_paid, verified_paid, awaiting_verification, is_overdue, days_overdue, flagged_for_review, flag_reason, flagged_at, is_lapsed')
        .eq('booking_id', id)
        .maybeSingle();
      if (moneyError) console.error('Could not read the booking money row:', moneyError);
      setMoney(moneyRow || null);

      // Payments
      // From v_payment_ledger, not the table: it carries counts_in_ledger and
      // is_reversed, which every paid figure on this page is read from.
      const { data: paymentsData, error: paymentsError } = await supabase
        .from('v_payment_ledger')
        .select('*')
        .eq('booking_id', id)
        .order('pay_datetime', { ascending: false });
      if (paymentsError) throw paymentsError;
      const filtered = (paymentsData || []).filter(p => !(p.amount_paid === 0 && p.pay_status === 'Pending'));
      setPayments(filtered);

      // Passive auto-complete: no server-side cron in this stack, so this
      // runs whenever the details page is loaded — completes this booking
      // if it's Confirmed, past its event date, and fully paid.
      const completedIds = await autoCompletePastEvents([{
        booking_id: bookingData.booking_id,
        booking_status: bookingData.booking_status,
        event_datetime: bookingData.event_datetime,
        total_amount: bookingData.total_amount,
        positivePayments: sumVerifiedPositivePayments(filtered),
      }]);
      if (completedIds.length > 0) {
        fetchBooking();
        return;
      }

      // Menu selections
      if (bookingData.menu_selections && typeof bookingData.menu_selections === 'object') {
        const selections = bookingData.menu_selections;
        const categoryIds = Object.keys(selections);
        const menuItemIds = Object.values(selections);
        if (categoryIds.length > 0) {
          const { data: categories } = await supabase
            .from('category')
            .select('category_id, category_name')
            .in('category_id', categoryIds);
          const { data: menuItems } = await supabase
            .from('menu_item')
            .select('menu_item_id, menu_name')
            .in('menu_item_id', menuItemIds);
          const selectionsList = categoryIds.map(catId => {
            const category = categories?.find(c => c.category_id === catId);
            const menuItemId = selections[catId];
            const menuItem = menuItems?.find(m => m.menu_item_id === menuItemId);
            return {
              category_name: category?.category_name || 'Unknown Category',
              menu_name: menuItem?.menu_name || 'Unknown Menu Item',
            };
          });
          setMenuSelections(selectionsList);
        } else {
          setMenuSelections([]);
        }
      } else {
        setMenuSelections([]);
      }

      // The template's suggested quantities and the day's availability. Both
      // are read from the database rather than derived here: the suggestion is
      // a package rule and the availability is a question about every booking
      // on that date, neither of which this page can answer on its own.
      // A LAPSED booking gets neither: no suggestions and no availability
      // read. Its event date has gone, the database no longer counts what it
      // holds as committed, and asking what is free on a day that has passed
      // answers a question nobody can act on. Not fetched at all, so
      // f_equipment_availability never fires for it.
      const lapsedNow = !!moneyRow?.is_lapsed;
      const { data: requiredRows, error: requiredError } = lapsedNow
        ? { data: [], error: null }
        : await supabase
          .from('v_booking_equipment_required')
          .select('equipment_id, eqm_name, required_qty, per_pax, pax_per_unit, included_quantity')
          .eq('booking_id', id);
      if (requiredError) console.error('Could not read the suggested equipment for this booking:', requiredError);
      setSuggestedById(Object.fromEntries((requiredRows || [])
        .filter(r => r.equipment_id)
        .map(r => [r.equipment_id, r])));

      setAvailability(lapsedNow
        ? { status: 'idle', byId: {} }
        : await fetchEquipmentAvailability(bookingData.event_datetime));

      // Equipment
      const { data: equipData } = await supabase
        .from('booking_equipment')
        .select(`assignment_id, quantity, returned, returned_quantity, equipment:equipment_id (eqm_name, equipment_id)`)
        .eq('booking_id', id)
        .order('assigned_at', { ascending: true });
      setEquipment(
        equipData?.map(item => ({
          assignment_id: item.assignment_id,
          equipment_id: item.equipment?.equipment_id,
          eqm_name: item.equipment?.eqm_name || 'Unknown',
          quantity: item.quantity,
          returned: item.returned,
          returned_quantity: item.returned_quantity || 0,
        })) || []
      );
      setAllocationLog(await fetchAllocationLog(id));
      // Which rows came from the package template and which a manager added.
      // booking_equipment has no column saying so and gets none (no schema
      // changes), so the template itself is the authority — and it is now the
      // SAME template the Suggested figures come from,
      // v_booking_equipment_required, rather than a second client-side
      // derivation of the same rule sitting a few lines away from it. An
      // empty result (no package, or a package with no template) sends every
      // row to "Added by manager", which is what it already did.
      setTemplateDemand(lapsedNow ? null : Object.fromEntries((requiredRows || [])
        .filter(r => r.equipment_id)
        .map(r => [r.equipment_id, Number(r.required_qty) || 0])));
      // Dispatch — what is actually carrying this event. The page could
      // previously only mention a vehicle in its delete warning, so a manager
      // had to open Vehicles and search for the reference to answer "is there
      // a van for this?".
      const { data: dispatchData } = await supabase
        .from('vehicle_assign')
        .select('assignment_id, vehicle_id, dispatch_datetime, assignment_status, vehicle:vehicle_id (plate_number, vehicle_type, vehicle_status)')
        .eq('booking_id', id)
        .order('dispatch_datetime', { ascending: true });
      setDispatches(dispatchData || []);

    } catch (error) {
      console.error(error);
      toast.error('Unable to load booking details.');
    } finally {
      setLoading(false);
    }
  };

  // Fetch dropdown data for edit modal
  useEffect(() => {
    fetchBooking();
    const fetchDropdownData = async () => {
      try {
        const { data: cust } = await supabase
          .from('customer')
          .select('customer_id, first_name, last_name')
          .eq('account_status', 'Active')
          .order('first_name');
        setCustomers(cust || []);
        const { data: pkgs } = await supabase
          .from('package')
          .select('package_id, pkg_name, pricing_type, max_pax, extra_pax_price')
          .eq('pkg_availability', 'Available')
          .order('pkg_name');
        setPackages(pkgs || []);
      } catch (error) {
        console.error('Dropdown fetch error:', error);
      }
    };
    fetchDropdownData();
  }, [id]);

  // Scoped to THIS booking with row filters, so an unrelated booking
  // changing elsewhere doesn't refetch this page. `booking` is filtered on
  // its primary key; the child tables on their booking_id foreign key.
  //
  // This is the page where two managers are most likely to collide on the
  // same record — one verifying a payment while the other approves or
  // assigns equipment — and where acting on stale data does the most
  // damage, since the status gates (assign/edit/return locks) are all
  // derived from booking_status.
  useRealtimeRefresh(
    `booking-details-${id}`,
    [
      { table: 'booking', filter: `booking_id=eq.${id}` },
      { table: 'payment', filter: `booking_id=eq.${id}` },
      { table: 'booking_equipment', filter: `booking_id=eq.${id}` },
      { table: 'vehicle_assign', filter: `booking_id=eq.${id}` },
    ],
    // Re-read rather than patch: after a reversal the status, the balance and
    // the review flag can all have moved, and only the database knows which.
    () => { setHistoryKey(k => k + 1); fetchBooking(); },
    { enabled: !!id }
  );

  // ============================================================
  // HOOKS: Payment, Approval, Rejection, Cancellation
  // ============================================================

  // --- Payment Handlers ---
  const {
    isPaymentModalOpen,
    setIsPaymentModalOpen,
    paymentFormData,
    selectedFile,
    isPaymentSubmitting,
    uploading,
    paymentAmountError,
    paymentFileError,
    paymentReceiptError,
    priorPaid,
    openPaymentModal,
    handlePaymentInputChange,
    handlePaymentFileChange,
    handlePaymentSubmit,
    getProofUrl,
    handlePaymentMethodChange,
  } = usePaymentHandlers({
    bookingId: id,
    payments,
    totalAmount: booking?.total_amount || 0,
    fetchData: fetchBooking,
    customerId: booking?.customer_id,
  });

  // --- Approval Handlers ---
  const {
    isApprovalModalOpen,
    setIsApprovalModalOpen,
    approvalBooking,
    approvalData,
    isSubmitting: isApprovalSubmitting,
    openApprovalModal,
    handleApprovalInputChange,
    handleFinalizeApproval,
    setApprovalVehicleIds,
  } = useApprovalHandlers({
    booking,
    payments,
    fetchData: fetchBooking,
  });

  // Reported by ApprovalAvailabilityCheck inside the approve modal — lets us
  // disable the Approve button instead of letting the manager click through
  // and get blocked by the hook's equipment hard-check afterward.
  const [approvalEquipmentStatus, setApprovalEquipmentStatus] = useState({ applicable: false, loading: false, sufficient: true, shortages: [] });
  const approveDisabled = isApprovalSubmitting || (approvalEquipmentStatus.applicable && (approvalEquipmentStatus.loading || !approvalEquipmentStatus.sufficient));

  // --- Rejection Handlers (with wrapper functions) ---
  const getBooking = (bookingId) => (bookingId === booking?.booking_id ? booking : null);
  const getPaymentSummary = (bookingId) => {
    if (bookingId === booking?.booking_id) {
      const positivePayments = sumVerifiedPositivePayments(payments);
      const downpaymentPaid = sumDepositsCollected(payments);
      return { positivePayments, downpaymentPaid };
    }
    return { positivePayments: 0, downpaymentPaid: 0 };
  };

  const {
    isRejectionModalOpen,
    setIsRejectionModalOpen,
    rejectionReason,
    setRejectionReason,
    rejectionRefundAmount,
    setRejectionRefundAmount,
    rejectionRefundRemarks,
    setRejectionRefundRemarks,
    rejectionRefundFile,
    setRejectionRefundFile,
    rejectionRefundMethod,
    setRejectionRefundMethod,
    rejectionRefundReceiptNo,
    setRejectionRefundReceiptNo,
    showRejectionRefund,
    rejectionMaxRefundable,
    openRejectionModal,
    handleRejectConfirm,
  } = useRejectionHandlers({
    getBooking,
    getPaymentSummary,
    fetchData: fetchBooking,
  });

  // --- Cancellation Handlers ---
  const {
    isCancelModalOpen,
    setIsCancelModalOpen,
    cancelReason,
    setCancelReason,
    refundAmount,
    setRefundAmount,
    refundRemarks,
    setRefundRemarks,
    refundFile,
    setRefundFile,
    refundMethod,
    setRefundMethod,
    refundReceiptNo,
    setRefundReceiptNo,
    isCancelling,
    openCancelModal,
    handleCancelBooking,
  } = useCancellationHandlers({
    booking,
    payments,
    fetchData: fetchBooking,
  });

  // --- Confirmation Handlers (Approved -> Confirmed) ---
  const {
    canConfirmBooking,
    isConfirming,
    handleConfirmBooking,
    promptToConfirm,
  } = useConfirmationHandlers({
    booking,
    payments,
    fetchData: fetchBooking,
  });

  // --- Completion Handlers (Confirmed -> Completed) ---
  const {
    canMarkCompleted,
    isFullyPaid: isCompletionFullyPaid,
    remainingBalance: completionRemainingBalance,
    isCompleting,
    handleMarkCompleted,
  } = useCompletionHandlers({
    booking,
    payments,
    fetchData: fetchBooking,
  });

  // --- Verification Handlers (Pending Verification payments) ---
  const {
    isRejectProofModalOpen,
    setIsRejectProofModalOpen,
    rejectProofTarget,
    rejectProofReason,
    setRejectProofReason,
    isVerifying,
    isVerifyModalOpen,
    setIsVerifyModalOpen,
    verifyTarget,
    verifyMethod,
    setVerifyMethod,
    openVerifyModal,
    handleVerifyConfirm,
    openRejectProofModal,
    handleRejectProofConfirm,
  } = useVerificationHandlers({
    payments,
    totalAmount: booking?.total_amount || 0,
    fetchData: fetchBooking,
    // Verifying a payment can be the moment a booking becomes confirmable, so
    // the Confirm Event dialog is offered right here instead of sending the
    // manager off to find the button. `silentIfIneligible` keeps it quiet when
    // the payment does not reach 50%: the dialog is offered, not requested, so
    // a booking that cannot be confirmed yet should raise nothing at all.
    onVerified: ({ paid }) => promptToConfirm({
      paidOverride: paid,
      silentIfIneligible: true,
      fromVerification: true,
    }),
  });

  // --- Refund after rejection/cancellation (local) ---
  // Uses the same policy-aware `remainingRefundableAmount` computed below in
  // the render body (excludes the forfeited downpayment when cancellation
  // happened within 3 days of the event) — must NOT recompute a simpler
  // "total paid minus already refunded" figure here, or the modal's max
  // will silently allow refunding the forfeited downpayment.
  const openRefundModal = () => {
    setRefundModalAmount(remainingRefundableAmount > 0 ? remainingRefundableAmount.toFixed(2) : '');
    setRefundModalRemarks('');
    setRefundModalFile(null);
    setRefundModalMethod('');
    setRefundModalReceiptNo('');
    setIsRefundModalOpen(true);
  };

  const handleRefundSubmit = async (e) => {
    e.preventDefault();

    const amount = parseFloat(refundModalAmount) || 0;
    if (amount <= 0) {
      toast.error('Please enter a valid refund amount.');
      return;
    }
    if (amount > remainingRefundableAmount) {
      toast.error(`Amount exceeds remaining refundable (₱${remainingRefundableAmount.toFixed(2)}).`);
      return;
    }
    if (!RECEIPT_METHODS.includes(refundModalMethod)) {
      toast.error(REFUND_METHOD_MESSAGE);
      return;
    }
    setIsRefundSubmitting(true);
    try {
      // Cash -> receipt number required, image optional; GCash / Bank
      // Transfer -> image required. One rule for every refund flow.
      const evidence = await prepareRefundEvidence({ method: refundModalMethod, file: refundModalFile, receiptNo: refundModalReceiptNo });
      if (evidence.error) throw new Error(evidence.error);
      const { proofUrl, receiptReference } = evidence;

      const { error: refundError } = await supabase
        .from('payment')
        .insert([{
          booking_id: id,
          amount_paid: -amount,
          pay_method: refundModalMethod,
          pay_status: REFUNDED_STATUS,
          entry_type: ENTRY_TYPES.refund,
          pay_datetime: new Date().toISOString(),
          pay_proof: proofUrl,
          receipt_reference: receiptReference,
          customer_id: booking.customer_id,
          remarks: refundModalRemarks || 'Refund processed after rejection/cancellation',
        }]);
      if (refundError) throw refundError;

      const refundNote = `[REFUND] Amount: ₱${amount.toFixed(2)}. ${refundModalRemarks || ''}`;
      const updatedNotes = booking.notes ? `${booking.notes}\n${refundNote}` : refundNote;
      await supabase
        .from('booking')
        .update({ notes: updatedNotes })
        .eq('booking_id', id);

      setIsRefundModalOpen(false);
      fetchBooking();
      toast.success('Refund recorded.');
    } catch (error) {
      console.error(error);
      toast.error(error.message || 'Failed to record refund.');
    } finally {
      setIsRefundSubmitting(false);
    }
  };

  // --- DELETE (unique) ---
  const handleDelete = async () => {
    // Name the money. This is the most destructive action in the app, and
    // "associated payments will also be deleted" does not convey that a
    // six-figure sum is about to disappear from every report. The figure is
    // the same verified total the rest of the page shows.
    const recordedMoney = sumVerifiedPositivePayments(payments);
    const paymentRowCount = (payments || []).length;
    const moneyWarning = formatPaymentDeletionWarning(paymentRowCount, recordedMoney);

    const confirmed = await showConfirm({
      title: 'Delete Booking?',
      message: `Are you sure you want to permanently delete this ${booking.booking_status} booking? This action cannot be undone. Its equipment and vehicle assignments will be released.${moneyWarning}`,
      confirmLabel: 'Delete',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: 'Deleting this booking is permanent. Re-enter your password to continue.',
    });
    if (!passwordOk) return;

    try {
      const { error: paymentsError } = await supabase
        .from('payment')
        .delete()
        .eq('booking_id', id);
      if (paymentsError) throw paymentsError;
      await supabase.from('booking_equipment').delete().eq('booking_id', id);
      await supabase.from('vehicle_assign').delete().eq('booking_id', id);
      const { error } = await supabase
        .from('booking')
        .delete()
        .eq('booking_id', id);
      if (error) throw error;
      toast.success('Booking deleted.');
      navigate('/app/bookings');
    } catch (error) {
      console.error(error);
      // Children have to go before the parent for the foreign keys, so a
      // failure at the last step leaves the booking standing with its
      // payments already gone. "Failed to delete" would suggest nothing
      // happened, which is the one thing that cannot be true here.
      toast.error(
        'Failed to delete this booking, and some of its records may already have been removed. Check it on the Receivables page before trying again.',
        { duration: 10000 }
      );
    }
  };

  // --- EDIT MODAL (unique) ---
  // What the edit form would recalculate this booking's total to, from the
  // stored record. `booking.package` carries the pricing fields, so this needs
  // nothing the modal has to load first.
  //
  // Packages are the harder half: unlike short orders, approval writes NO
  // note when it adjusts a package total, so the money itself is the only
  // evidence that an adjustment happened.
  const recomputedBookingTotal = () => {
    const pkg = booking?.package;
    if (!pkg) return null;
    const pax = parseInt(booking.pax_count) || 0;
    let total = 0;
    if (pkg.pricing_type === 'per_pax') {
      total = (pkg.pkg_price || 0) * pax;
    } else {
      total = pkg.pkg_price || 0;
      if (pkg.max_pax && pax > pkg.max_pax) {
        total += (pax - pkg.max_pax) * (pkg.extra_pax_price || 0);
      }
    }
    // A package booking carries no delivery fee — Vaughn's rule, 4 Sep 2026.
    // The add form never collected one; this page was the outlier.
    return total;
  };

  const editWouldLoseTotal = () => {
    const recomputed = recomputedBookingTotal();
    if (recomputed === null) return 0;
    return totalLossOnRecompute(booking?.total_amount, recomputed);
  };

  const openEditModal = () => {
    if (!booking) return;
    if (isPaymentLedgerLocked(booking.booking_status)) {
      toast.error(bookingEditLockedMessage(booking.booking_status));
      return;
    }
    if (editWouldLoseTotal() > 0) {
      toast.error(totalLossLockedMessage(booking.total_amount, recomputedBookingTotal()), { duration: 10000 });
      return;
    }
    setEditFormData({
      customer_id: booking.customer_id || '',
      package_id: booking.package_id || '',
      booking_type: booking.booking_type || 'Package',
      event_datetime: toDateTimeLocalValue(booking.event_datetime),
      venue: booking.venue || '',
      pax_count: booking.pax_count?.toString() || '',
      motif_color: booking.motif_color || '',
      notes: booking.notes || '',
      total_amount: booking.total_amount?.toString() || '',
      menu_selections: booking.menu_selections || {},
    });
    // Fetch package info for the current package
    if (booking.package_id) {
      fetchPackageDetails(booking.package_id);
    } else {
      setPackageCategories([]);
      setCategoryMenuItems({});
      setSelectedPackageInfo(null);
    }
    setEditFieldErrors({});
    setIsEditModalOpen(true);
  };

  // --- Fetch package categories, menu items, and pricing ---
  const fetchPackageDetails = async (packageId) => {
    try {
      // 1. Fetch package pricing
      const { data: pkgData, error: pkgError } = await supabase
        .from('package')
        .select('pkg_name, pkg_price, pricing_type, max_pax, extra_pax_price, minimum_pax')
        .eq('package_id', packageId)
        .maybeSingle();
      if (!pkgError && pkgData) {
        setSelectedPackageInfo(pkgData);
      } else {
        setSelectedPackageInfo(null);
      }

      // 2. Fetch categories and menu items
      const { data: catData, error: catError } = await supabase
        .from('package_category')
        .select(`category_id, category:category_id (category_id, category_name)`)
        .eq('package_id', packageId);
      if (catError) throw catError;
      const categories = catData.map(item => ({
        category_id: item.category.category_id,
        category_name: item.category.category_name,
      }));
      setPackageCategories(categories);

      const menuItemsMap = {};
      for (const cat of categories) {
        const { data: menuData, error: menuError } = await supabase
          .from('menu_item')
          .select('menu_item_id, menu_name')
          .eq('category_id', cat.category_id)
          .eq('menu_availability', 'Available')
          .order('menu_name');
        if (menuError) throw menuError;
        menuItemsMap[cat.category_id] = menuData || [];
      }
      setCategoryMenuItems(menuItemsMap);
    } catch (error) {
      console.error('Error fetching package details:', error);
      toast.error('Unable to load package details.');
    }
  };

  // --- Recalculate total based on selected package info and pax ---
  // Derived, not stored. The input showing this is disabled, so it was never
  // something a manager typed — it was a computed number an effect wrote back
  // into editFormData, re-rendering the modal on every pax keystroke.
  //
  // The no-package fallback is preserved deliberately: recalcTotal returned
  // early without touching the total when no package was selected, so the
  // loaded value stood. editFormData.total_amount stays as that loaded
  // baseline; nothing writes to it any more.
  const editComputedTotal = useMemo(() => {
    const pkg = selectedPackageInfo;
    if (!pkg) return editFormData.total_amount;

    const pax = parseInt(editFormData.pax_count) || 0;

    let total = 0;
    if (pkg.pricing_type === 'per_pax') {
      total = (pkg.pkg_price || 0) * pax;
    } else {
      total = pkg.pkg_price || 0;
      if (pkg.max_pax && pax > pkg.max_pax) {
        total += (pax - pkg.max_pax) * (pkg.extra_pax_price || 0);
      }
    }
    return total.toFixed(2);
  }, [selectedPackageInfo, editFormData.pax_count, editFormData.total_amount]);

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    setEditFormData(prev => ({ ...prev, [name]: value }));
    setEditFieldErrors(prev => (prev[name] ? { ...prev, [name]: undefined } : prev));
    // If package changes, reset menu selections and fetch new package details
    if (name === 'package_id') {
      // Reset menu selections
      setEditFormData(prev => ({ ...prev, menu_selections: {} }));
      // Fetch package details
      if (value) {
        fetchPackageDetails(value);
      } else {
        setPackageCategories([]);
        setCategoryMenuItems({});
        setSelectedPackageInfo(null);
      }
    }
  };

  const handleMenuSelectionChange = (categoryId, menuItemId) => {
    setEditFormData(prev => ({
      ...prev,
      menu_selections: { ...prev.menu_selections, [categoryId]: menuItemId },
    }));
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setEditFieldErrors({});

    if (isPaymentLedgerLocked(booking.booking_status)) {
      toast.error(bookingEditLockedMessage(booking.booking_status));
      setIsSubmitting(false);
      return;
    }

    if (!editFormData.venue || editFormData.venue.trim() === '') {
      toast.error('Please enter a venue.');
      setEditFieldErrors({ venue: 'Please enter a venue.' });
      setIsSubmitting(false);
      return;
    }
    // Was `>= 1` and nothing else, so a booking created at the package
    // minimum could be edited below it — or, now, above the cap — and saved.
    // selectedPackageInfo is already loaded for the total calculation.
    const paxCheck = validatePaxForPackage(selectedPackageInfo, editFormData.pax_count);
    if (!paxCheck.ok) {
      toast.error(paxCheck.message);
      setEditFieldErrors({ pax_count: paxCheck.message });
      setIsSubmitting(false);
      return;
    }
    if (!editComputedTotal || parseFloat(editComputedTotal) <= 0) {
      toast.error('Total amount must be greater than zero.');
      setEditFieldErrors({ total_amount: 'Must be greater than zero.' });
      setIsSubmitting(false);
      return;
    }
    if (editFormData.event_datetime) {
      const eventDate = new Date(editFormData.event_datetime);
      const now = new Date();
      const eventDay = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const diffDays = Math.round((eventDay - today) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) {
        toast.error('The event date cannot be in the past. Please choose today or a later date.');
        setEditFieldErrors({ event_datetime: 'This date has already passed.' });
        setIsSubmitting(false);
        return;
      } else if (diffDays < 3) {
        // Same hard block as the Bookings list page's Add/Edit form — this
        // Details-page edit form never had it, so editing a booking's date
        // here could silently violate PG's 3-day notice policy.
        toast.error('Bookings must be made at least 3 days before the event date — this is PG\'s catering policy.');
        setEditFieldErrors({ event_datetime: 'Must be at least 3 days from today.' });
        setIsSubmitting(false);
        return;
      }
    }

    try {
      const oldPackageId = booking.package_id;
      const newPackageId = editFormData.package_id;
      const packageChanged = newPackageId && newPackageId !== oldPackageId;
      const newPaxCount = parseInt(editFormData.pax_count) || 0;
      const paxChanged = newPaxCount !== (booking.pax_count || 0);
      // Whichever package is actually in effect after this save — needed so
      // a pax-only change (package unchanged) still knows what to re-allocate against.
      const effectivePackageId = newPackageId || oldPackageId;
      const shouldReallocateEquipment = !!effectivePackageId && (packageChanged || paxChanged);

      if (packageChanged || paxChanged) {
        const shouldContinue = await showConfirm({
          title: packageChanged ? 'Package Changed' : 'Guest Count Changed',
          message: packageChanged
            ? 'You have changed the package. Equipment assignments will be re‑allocated based on the new package. Continue?'
            : 'You have changed the guest count. Equipment assignments will be recalculated to match. Continue?',
          confirmLabel: 'Continue',
          confirmVariant: 'warning',
        });
        if (!shouldContinue) {
          setIsSubmitting(false);
          return;
        }
      }

      const payload = {
        customer_id: editFormData.customer_id,
        package_id: editFormData.package_id,
        booking_type: 'Package',
        event_datetime: editFormData.event_datetime ? new Date(editFormData.event_datetime).toISOString() : null,
        venue: editFormData.venue,
        pax_count: parseInt(editFormData.pax_count) || 0,
        motif_color: editFormData.motif_color || null,
        notes: editFormData.notes || null,
        total_amount: parseFloat(editComputedTotal) || 0,
        menu_selections: editFormData.menu_selections,
      };

      const { error } = await supabase
        .from('booking')
        .update(payload)
        .eq('booking_id', id);
      if (error) throw error;

      // --- Re‑allocate equipment if the package or the guest count changed ---
      // (guest count matters because Countable equipment quantities are
      // computed from pax_count — leaving old equipment in place after a
      // pax change would silently under/over-provision the event)
      if (shouldReallocateEquipment) {
        // Look before deleting.
        //
        // This used to delete every equipment row and then allocate. Two ways
        // that lost data silently:
        //
        //   allocateEquipmentForBooking RETURNS [] rather than throwing when a
        //   package has no equipment template, so switching to such a package
        //   wiped the equipment, skipped the catch, and still reported
        //   "Equipment reassigned."
        //
        //   The delete had no `returned` filter, so rows already marked
        //   returned — the booking's return history, which the Equipment page's
        //   History tab reads and which its own delete guard refuses to
        //   destroy — went with them.
        let templateCount = null;
        try {
          const { count, error: templateError } = await supabase
            .from('package_equipment')
            .select('*', { count: 'exact', head: true })
            .eq('package_id', effectivePackageId);
          if (templateError) throw templateError;
          templateCount = count || 0;
        } catch (templateError) {
          console.warn('Could not read the package equipment template:', templateError);
        }

        if (templateCount === null) {
          toast.error('Could not check the package’s equipment template, so equipment was left unchanged. Review it on the Equipment page.', { duration: 8000 });
        } else if (templateCount === 0) {
          // Nothing would be allocated, so destroying what is there would
          // leave the event with no equipment at all.
          toast.error('This package has no equipment template, so nothing could be re-allocated. The existing equipment was left as it is — adjust it from the Equipment page if it no longer fits.', { duration: 9000 });
        } else {
          // Only what is still out. Returned rows are history, not a current
          // assignment, and re-allocation has no business rewriting them.
          const { error: clearError } = await supabase
            .from('booking_equipment')
            .delete()
            .eq('booking_id', id)
            .eq('returned', false);
          if (clearError) {
            console.warn('Could not clear current equipment:', clearError);
            toast.error('Equipment could not be re-allocated. It was left unchanged — review it on the Equipment page.', { duration: 8000 });
          } else {
            try {
              const allocated = await allocateEquipmentForBooking(id, effectivePackageId, newPaxCount);
              if (allocated && allocated.length > 0) {
                toast.success(`Equipment reassigned (${allocated.length} item${allocated.length === 1 ? '' : 's'}).`);
              } else {
                toast.error('Equipment was cleared but nothing was allocated in its place. Assign it from the Equipment page.', { duration: 9000 });
              }
            } catch (allocError) {
              console.warn('Equipment re-allocation failed:', allocError);
              toast.error(`Equipment was cleared but could not be reassigned: ${allocError.message}. Assign it from the Equipment page.`, { duration: 10000 });
            }
          }
        }
      }

      setIsEditModalOpen(false);
      toast.success('Booking saved.');
      fetchBooking();
    } catch (error) {
      console.error(error);
      toast.error('Failed to update booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Equipment Assignment Handlers (unique) ---
  // The lock is not cosmetic — styling alone leaves the modal reachable, so
  // the handler refuses too. Same shape as openAssignEquipModal below.
  const openAssignVehicleModal = () => {
    if (isResourceLocked(booking.booking_status, lapsedLock)) {
      toast.error(resourceLockReason(booking.booking_status, 'vehicles', lapsedLock));
      return;
    }
    setIsAssignVehicleOpen(true);
  };

  // Change one run's vehicle or departure time. Guards are repeated in the
  // modal against fresh rows; these only stop a modal opening that could never
  // save.
  const openEditVehicleRun = (run) => {
    if (isResourceLocked(booking.booking_status, lapsedLock)) {
      toast.error(resourceLockReason(booking.booking_status, 'vehicles', lapsedLock));
      return;
    }
    if (run.assignment_status === 'Completed') {
      toast.error('This run has been marked returned, so it is history now and cannot be changed.');
      return;
    }
    if (hasRunDeparted(run)) {
      toast.error('This run has already left, so it cannot be moved or given another vehicle. Mark it returned on the Vehicles page when it is back.', { duration: 9000 });
      return;
    }
    setEditingVehicleRun(run);
  };

  const handleRemoveVehicleRun = async (run, legLabel) => {
    if (isResourceLocked(booking.booking_status, lapsedLock)) {
      toast.error(resourceLockReason(booking.booking_status, 'vehicles', lapsedLock));
      return;
    }
    if (run.assignment_status === 'Completed') {
      toast.error('This run has been marked returned, so it is part of the dispatch history and cannot be removed.');
      return;
    }
    const isLastScheduled = !dispatches.some(d => d.assignment_id !== run.assignment_id && d.assignment_status !== 'Completed');
    const confirmed = await showConfirm({
      title: 'Remove Vehicle Run?',
      message: runRemovalMessage({ run, legLabel, bookingNumber: booking.booking_number, isLastScheduled }),
      confirmLabel: 'Remove',
      confirmVariant: 'warning',
    });
    if (!confirmed) return;
    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: 'Removing this vehicle run is permanent. Re-enter your password to continue.',
    });
    if (!passwordOk) return;
    try {
      await removeScheduledRun(run.assignment_id);
      toast.success('Vehicle run removed.');
    } catch (error) {
      console.error(error);
      toast.error(error.userMessage || 'Failed to remove the vehicle run.');
    } finally {
      fetchBooking();
    }
  };

  // Before the first equipment change on a Confirmed booking. The customer has
  // paid and the event is locked in, so changing what goes out is a different
  // act from adjusting an Approved booking: allowed, but said out loud once.
  // Approved bookings are the normal working window and are never asked.
  const confirmConfirmedEquipmentEdit = async () => {
    if (booking?.booking_status !== 'Confirmed' || confirmedEditAckFor === id) return true;
    const eventDate = booking.event_datetime
      ? new Date(booking.event_datetime).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
      : 'its event date';
    const ok = await showConfirm({
      title: 'Change equipment on a confirmed event?',
      message: `${booking.booking_number} is confirmed for ${eventDate}. Changing what goes out is allowed, and the change is recorded against your account.`,
      confirmLabel: 'Continue',
      confirmVariant: 'warning',
    });
    if (ok) setConfirmedEditAckFor(id);
    return ok;
  };

  const openAssignEquipModal = async () => {
    if (isResourceLocked(booking.booking_status, lapsedLock)) {
      toast.error(resourceLockReason(booking.booking_status, 'equipment', lapsedLock));
      return;
    }
    if (!(await confirmConfirmedEquipmentEdit())) return;
    const fetchEquipmentList = async () => {
      try {
        const data = await fetchAllRows(() => supabase
          .from('equipment')
          .select('equipment_id, eqm_name, quantity_available, equipment_type')
          .order('eqm_name')
          .order('equipment_id', { ascending: true }), 'equipment list');
        setEquipmentList(data || []);
      } catch (error) {
        console.error('Error fetching equipment list:', error);
        toast.error('Unable to load equipment list.');
      }
    };
    fetchEquipmentList();

    // AVAILABILITY ON THE EVENT DATE. The dropdown used to show
    // quantity_available — total usable stock — which ignores everything
    // already committed that day, this booking's own rows included, so a
    // manager saw 170 Guest Tables where 161 could actually be assigned.
    //
    // The number comes from getDailyEquipmentSnapshot, the same call the
    // Equipment page's Availability tab reads, so the two screens agree by
    // construction. It INCLUDES this booking's own rows, deliberately: Assign
    // adds a new row on top of the existing ones, so topping 9 Guest Tables up
    // to 10 needs 10 free units that day. handleAssignEquipSubmit counts them
    // too, which is why its limit and this label line up.
    //
    // KNOWN GAP — do not read the two as one rule. The snapshot and the submit
    // guard count different bookings:
    //   - getDailyEquipmentSnapshot counts only ACTIVE_BOOKING_STATUSES
    //     (Approved, Confirmed), and for an active booking with no
    //     booking_equipment rows it subtracts that booking's ESTIMATED package
    //     demand instead.
    //   - handleAssignEquipSubmit counts every unreturned booking_equipment row
    //     on the date regardless of booking status, and no estimates.
    // On current data they are equal: Pending bookings hold no equipment,
    // Completed rows are returned, and every active booking has its rows.
    // They diverge in two directions:
    //   - Unreturned rows on a Pending, Completed, Cancelled or Rejected
    //     booking that day: the guard is STRICTER, so the label can offer units
    //     the submit then refuses — a refused assignment, not an oversell.
    //   - An active booking that day with no rows yet: the snapshot is
    //     stricter, so the label shows FEWER free than the guard would accept.
    // Neither direction can oversell. FOLLOW-UP, NOT DONE: point this guard
    // AND the Edit Equipment guard (handleEditEquipSubmit) at the same
    // snapshot so all three agree by construction.
    //
    // If the snapshot fails the modal falls back to the raw "in stock" label:
    // a degraded label beats an unusable form, and the guard still protects
    // the data.
    if (booking.event_datetime) {
      setAssignSnapshot({ status: 'loading', freeById: {} });
      const fresh = await fetchEquipmentAvailability(booking.event_datetime);
      setAvailability(fresh);
      setAssignSnapshot({
        status: fresh.status === 'ready' ? 'ready' : 'failed',
        freeById: Object.fromEntries(Object.entries(fresh.byId).map(([eid, v]) => [eid, v.free])),
      });
    } else {
      setAssignSnapshot({ status: 'failed', freeById: {} });
    }

    setAssignEquipData({ equipment_id: '', quantity: 1, notes: '' });
    setEquipSearchTerm('');
    setIsAssignEquipModalOpen(true);
  };

  const handleAssignEquipChange = (e) => {
    const { name, value } = e.target;
    setAssignEquipData(prev => ({
      ...prev,
      [name]: name === 'quantity' ? parseInt(value) || 1 : value,
    }));
  };

  const handleAssignEquipSubmit = async (e) => {
    e.preventDefault();

    if (!assignEquipData.equipment_id) {
      toast.error('Please select an equipment item.');
      return;
    }
    const quantity = assignEquipData.quantity;
    if (!quantity || quantity < 1) {
      toast.error('Quantity must be at least 1.');
      return;
    }

    setIsAssignSubmitting(true);
    try {
      const selectedEquip = equipmentList.find(eq => eq.equipment_id === assignEquipData.equipment_id);
      if (!selectedEquip) throw new Error('Equipment not found');

      // OVER-ALLOCATION WARNS, IT DOES NOT BLOCK. Asking for more than is
      // free on the date is sometimes a real decision — units coming back
      // early, one borrowed from another site — and refusing it sends the
      // manager to a spreadsheet, which is worse than a system that knows
      // what was promised. Read fresh: the last read may be minutes old and
      // another manager may have committed the same units since.
      if (booking?.event_datetime) {
        const fresh = await fetchEquipmentAvailability(booking.event_datetime);
        setAvailability(fresh);
        const free = fresh.byId[assignEquipData.equipment_id]?.free;
        if (fresh.status === 'ready' && typeof free === 'number' && quantity > free) {
          const ok = await showConfirm(overAllocationWarning({
            name: selectedEquip.eqm_name,
            requested: quantity,
            free,
            dayLabel: eventDayLabel(booking.event_datetime),
          }));
          if (!ok) {
            setIsAssignSubmitting(false);
            return;
          }
        }
      }

      // ONE ROW PER ITEM PER BOOKING — booking_equipment now carries a unique
      // key on (booking_id, equipment_id), so a second assignment of the same
      // item is an increase of the existing line, not another row. Read the
      // line first and add to it; a blind insert would now be rejected.
      const { data: existingLine, error: existingError } = await supabase
        .from('booking_equipment')
        .select('assignment_id, quantity')
        .eq('booking_id', id)
        .eq('equipment_id', assignEquipData.equipment_id)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existingLine) {
        const combined = (Number(existingLine.quantity) || 0) + quantity;
        const { error: bumpError } = await supabase
          .from('booking_equipment')
          .update({ quantity: combined })
          .eq('assignment_id', existingLine.assignment_id);
        if (bumpError) throw bumpError;
        setIsAssignEquipModalOpen(false);
        fetchBooking();
        toast.success(`${selectedEquip.eqm_name} increased to ${combined}.`);
        return;
      }

      const { error: insertError } = await supabase
        .from('booking_equipment')
        .insert([{
          booking_id: id,
          equipment_id: assignEquipData.equipment_id,
          quantity,
          notes: assignEquipData.notes || null,
          returned: false,
        }]);
      if (insertError) throw insertError;

      setIsAssignEquipModalOpen(false);
      fetchBooking();
      toast.success('Equipment assigned.');
    } catch (error) {
      console.error(error);
      toast.error('Failed to assign equipment.');
    } finally {
      setIsAssignSubmitting(false);
    }
  };

  /**
   * Set one item to the quantity the package template suggests.
   *
   * A shortcut, not a rule: the suggestion is what the package implies for
   * this guest count, and the manager stays free to type any number after.
   * Written through the unique key (booking_id, equipment_id) so it works the
   * same whether the line exists or not.
   */
  const applySuggestedQuantity = async (equipmentId, suggested, name) => {
    if (isResourceLocked(booking.booking_status, lapsedLock)) {
      toast.error(resourceLockReason(booking.booking_status, 'equipment', lapsedLock));
      return;
    }
    if (!(await confirmConfirmedEquipmentEdit())) return;
    const qty = Number(suggested) || 0;
    if (qty < 1) {
      toast.error('The template suggests nothing for this item.');
      return;
    }
    try {
      const existing = equipment.find(e => e.equipment_id === equipmentId);
      if (existing && (existing.returned_quantity || 0) > qty) {
        toast.error(`Can't set ${name} to ${qty} — ${existing.returned_quantity} unit(s) are already recorded as returned.`);
        return;
      }

      // Warn once if the suggestion itself exceeds what is free that day.
      if (booking?.event_datetime) {
        const fresh = await fetchEquipmentAvailability(booking.event_datetime);
        setAvailability(fresh);
        const entry = fresh.byId[equipmentId];
        const increase = qty - (Number(existing?.quantity) || 0);
        if (fresh.status === 'ready' && entry && increase > entry.free) {
          const ok = await showConfirm(overAllocationWarning({
            name,
            requested: qty,
            free: (Number(existing?.quantity) || 0) + entry.free,
            dayLabel: eventDayLabel(booking.event_datetime),
          }));
          if (!ok) return;
        }
      }

      const { error } = await supabase
        .from('booking_equipment')
        .upsert(
          { booking_id: id, equipment_id: equipmentId, quantity: qty, returned: false },
          { onConflict: 'booking_id,equipment_id' },
        );
      if (error) throw error;
      fetchBooking();
      toast.success(`${name} set to the suggested ${qty}.`);
    } catch (error) {
      console.error(error);
      toast.error('Could not apply the suggested quantity.');
    }
  };

  const handleRemoveEquipment = async (item) => {
    const assignmentId = item.assignment_id;
    if (isResourceLocked(booking.booking_status, lapsedLock)) {
      toast.error(resourceLockReason(booking.booking_status, 'equipment', lapsedLock));
      return;
    }
    // Returned units are a record of what came back. Removing the line would
    // erase it, so a line with any returns stays. Read fresh: a return can be
    // recorded from the Operations Manager app while this page is open.
    const { data: current, error: currentError } = await supabase
      .from('booking_equipment')
      .select('returned_quantity')
      .eq('assignment_id', assignmentId)
      .maybeSingle();
    if (currentError) {
      console.error(currentError);
      toast.error('Failed to remove equipment.');
      return;
    }
    if (!current) {
      toast.error('This equipment line no longer exists. The page has been refreshed.');
      fetchBooking();
      return;
    }
    if ((current.returned_quantity || 0) > 0) {
      toast.error(`Can't remove this — ${current.returned_quantity} unit(s) have already been recorded as returned.`);
      return;
    }
    if (!(await confirmConfirmedEquipmentEdit())) return;

    const isLastLine = equipment.length === 1;
    const confirmed = await showConfirm({
      title: 'Remove Equipment?',
      message: isLastLine
        ? `${item.eqm_name} is the only equipment on this booking. Removing it leaves ${booking.booking_number} with no equipment at all. This action cannot be undone.`
        : `Remove ${item.eqm_name} (× ${item.quantity}) from this booking? This action cannot be undone.`,
      confirmLabel: 'Remove',
      confirmVariant: 'warning',
    });
    if (!confirmed) return;

    const passwordOk = await requestPasswordConfirm({
      title: 'Confirm Your Password',
      message: 'Removing this equipment assignment is permanent. Re-enter your password to continue.',
    });
    if (!passwordOk) return;

    try {
      const { error: deleteError, count: deletedCount } = await supabase
        .from('booking_equipment')
        .delete({ count: 'exact' })
        .eq('assignment_id', assignmentId);
      if (deleteError) throw deleteError;
      // RLS refuses a delete without an error; it just removes nothing.
      if (!deletedCount) throw new Error('No equipment line was removed.');
      fetchBooking();
      toast.success('Equipment removed.');
    } catch (error) {
      console.error(error);
      toast.error('Failed to remove equipment.');
    }
  };

  // --- Edit Equipment Assignment ---
  const openEditEquipModal = async (assignment) => {
    if (isResourceLocked(booking.booking_status, lapsedLock)) {
      toast.error(resourceLockReason(booking.booking_status, 'equipment', lapsedLock));
      return;
    }
    if (!(await confirmConfirmedEquipmentEdit())) return;
    setEditingAssignment(assignment);
    setEditEquipData({ quantity: assignment.quantity });
    setIsEditEquipModalOpen(true);
  };

  const handleEditEquipSubmit = async (e) => {
    e.preventDefault();
    setIsAssignSubmitting(true);

    const newQuantity = editEquipData.quantity;
    if (!newQuantity || newQuantity < 1) {
      toast.error('Quantity must be at least 1.');
      setIsAssignSubmitting(false);
      return;
    }
    // Lowering a quantity is the manager's call: whether the event can run
    // with fewer is not something the software can know. What it must not do
    // is un-return units. returned_quantity is a record of what came back, so
    // the quantity can't drop below it. (The table's CHECK constraint refuses
    // it too; this says why first.) Read fresh, since a return can be recorded
    // from the Operations Manager app while this page is open.
    try {
      const { data: current, error: currentError } = await supabase
        .from('booking_equipment')
        .select('quantity, returned_quantity')
        .eq('assignment_id', editingAssignment.assignment_id)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) {
        toast.error('This equipment line no longer exists. The page has been refreshed.');
        setIsEditEquipModalOpen(false);
        fetchBooking();
        return;
      }
      const returnedUnits = current.returned_quantity || 0;
      if (newQuantity < returnedUnits) {
        toast.error(`Can't lower this to ${newQuantity} — ${returnedUnits} unit(s) have already been recorded as returned.`);
        return;
      }

      // Availability binds only when MORE is being committed. Lowering frees
      // stock; warning about a decrease on an already-oversold date is noise
      // at exactly the moment the manager is fixing it.
      //
      // And it warns rather than refuses — same reasoning as the Assign flow.
      // `free` nets off every commitment that day including this line, so the
      // question asked is about the increase: how much more is being taken.
      if (booking?.event_datetime && newQuantity > current.quantity) {
        const fresh = await fetchEquipmentAvailability(booking.event_datetime);
        setAvailability(fresh);
        const entry = fresh.byId[editingAssignment.equipment_id];
        const increase = newQuantity - current.quantity;
        if (fresh.status === 'ready' && entry && increase > entry.free) {
          const ok = await showConfirm(overAllocationWarning({
            name: entry.eqm_name || editingAssignment.eqm_name,
            requested: newQuantity,
            free: (Number(current.quantity) || 0) + entry.free,
            dayLabel: eventDayLabel(booking.event_datetime),
          }));
          if (!ok) {
            setIsAssignSubmitting(false);
            return;
          }
        }
      }

      const { error } = await supabase
        .from('booking_equipment')
        .update({ quantity: newQuantity })
        .eq('assignment_id', editingAssignment.assignment_id);
      if (error?.code === '23514') {
        // booking_equipment_returned_quantity_check: a return landed between
        // the read above and this write.
        toast.error(`Can't lower this to ${newQuantity} — more units have just been recorded as returned. The page has been refreshed.`);
        fetchBooking();
        return;
      }
      if (error) throw error;
      setIsEditEquipModalOpen(false);
      fetchBooking();
      toast.success('Equipment quantity updated.');
    } catch (error) {
      console.error(error);
      toast.error('Failed to update equipment.');
    } finally {
      setIsAssignSubmitting(false);
    }
  };

  // --- Render helpers ---
  // The Reference / Proof cell: the receipt number when there is one (Cash
  // records the number on the paper receipt instead of a photo), then the
  // proof image when there is one. Only the image was shown before, so a cash
  // receipt read "None" here while Receivables showed its number.
  const renderEvidence = (p) => {
    const hasProof = p.pay_proof && p.pay_proof !== 'placeholder.png' && p.pay_proof !== 'refund_placeholder.png';
    if (!p.receipt_reference && !hasProof) return renderProof(null);
    return (
      <div className="flex items-center gap-2">
        {p.receipt_reference && <span className="text-[13px] whitespace-nowrap">No. {p.receipt_reference}</span>}
        {hasProof && renderProof(p.pay_proof)}
      </div>
    );
  };

  const renderProof = (proofUrl) => {
    if (!proofUrl || proofUrl === 'placeholder.png' || proofUrl === 'refund_placeholder.png') {
      return <span className="text-xs text-slate-400 italic">None</span>;
    }
    const fullUrl = getProofUrl(proofUrl);
    if (!fullUrl) {
      return <span className="text-xs text-slate-400 italic">Invalid</span>;
    }
    return (
      <button
        onClick={() => {
          setProofModalUrl(fullUrl);
          setIsProofModalOpen(true);
        }}
        className="w-8 h-8 rounded border border-slate-200 overflow-hidden hover:shadow-md transition-shadow cursor-pointer flex items-center justify-center bg-slate-50"
        title="Click to view proof"
      >
        <img
          src={fullUrl}
          alt="Payment proof"
          className="w-full h-full object-cover"
          onError={(e) => {
            e.target.style.display = 'none';
            const parent = e.target.parentElement;
            const fallback = document.createElement('div');
            fallback.className = 'w-full h-full flex items-center justify-center text-slate-400';
            fallback.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>`;
            parent.appendChild(fallback);
          }}
        />
      </button>
    );
  };

  // --- RENDER ---
  if (loading) return <div className="p-12 text-center text-slate-500 font-medium">Loading...</div>;
  if (!booking) return <div className="p-12 text-center text-slate-500">Booking not found.</div>;

  // --- Assign modal: the event date as the options name it ("19 Sep"), and
  // free units per item on it — null while loading or after a failed snapshot,
  // which is the signal to fall back to raw stock.
  const assignEventDay = booking.event_datetime
    ? `${new Date(booking.event_datetime).getDate()} ${new Date(booking.event_datetime).toLocaleString('en', { month: 'short' })}`
    : '';
  const freeOnEventDay = (equipmentId) => (assignSnapshot.status === 'ready'
    ? (assignSnapshot.freeById[equipmentId] ?? 0)
    : null);
  const selectedAssignEquip = equipmentList.find(eq => eq.equipment_id === assignEquipData.equipment_id);
  const selectedAssignFree = selectedAssignEquip ? freeOnEventDay(selectedAssignEquip.equipment_id) : null;
  const assignQuantityMax = selectedAssignEquip
    ? (selectedAssignFree !== null ? Math.max(1, selectedAssignFree) : selectedAssignEquip.quantity_available)
    : undefined;

  // --- Equipment panel: package-derived rows vs rows a manager added. Judged
  // PER ITEM (all of an item's rows summed) against the template demand, so a
  // second Guest Tables row does not split one item into two verdicts. An
  // empty demand — no package, or a package with no template — sends every row
  // to "Added by manager" with no special case. null (derivation failed)
  // means no grouping: the flat list, so a grouping failure never hides
  // equipment.
  const equipmentGroups = (() => {
    if (!templateDemand) return null;
    const unitsByItem = {};
    equipment.forEach(item => {
      unitsByItem[item.equipment_id] = (unitsByItem[item.equipment_id] || 0) + (Number(item.quantity) || 0);
    });
    const fromPackage = [];
    const addedByManager = [];
    equipment.forEach(item => {
      if (templateDemand[item.equipment_id] === undefined) {
        addedByManager.push({ item, note: null });
      } else {
        const adjusted = unitsByItem[item.equipment_id] !== templateDemand[item.equipment_id];
        fromPackage.push({ item, note: adjusted ? 'From package · adjusted' : null });
      }
    });
    const units = (rows) => rows.reduce((sum, r) => sum + (Number(r.item.quantity) || 0), 0);
    return [
      { key: 'package', title: 'From package', rows: fromPackage, units: units(fromPackage) },
      { key: 'manual', title: 'Added by manager', rows: addedByManager, units: units(addedByManager) },
    ].filter(group => group.rows.length > 0);
  })();

  // One row of the Equipment panel, shared by both groups and the flat
  // fallback so the Assigned badge and the edit/delete controls stay
  // identical wherever a row appears.
  const renderEquipmentRow = (item, idx, note) => {
    // The two facts a manager needs beside a line: what the package implies
    // for this guest count, and how much of the item is free on the day.
    // Both are read — the suggestion from v_booking_equipment_required, the
    // availability from f_equipment_availability — so neither can drift from
    // the rules the rest of the system enforces.
    const suggestion = suggestedById[item.equipment_id];
    const suggested = Number(suggestion?.required_qty) || 0;
    const offSuggestion = suggested > 0 && suggested !== (Number(item.quantity) || 0);
    const free = availability.status === 'ready' ? availability.byId[item.equipment_id]?.free : null;
    return (
      <div key={item.assignment_id ?? idx} className="flex justify-between items-center gap-3 px-1 py-3">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-800 truncate">{item.eqm_name}</span>
          {note && <span className="block text-xs text-slate-500">{note}</span>}
          <span className="block text-xs text-slate-500">
            {suggested > 0 && <>Suggested {suggested}</>}
            {suggested > 0 && free !== null && ' · '}
            {free !== null && <>{free} free on {eventDayLabel(booking.event_datetime)}</>}
          </span>
          {offSuggestion && !item.returned && !isResourceLocked(booking.booking_status, lapsedLock) && (
            <button
              type="button"
              onClick={() => applySuggestedQuantity(item.equipment_id, suggested, item.eqm_name)}
              className="mt-1 text-[12px] font-semibold text-[#007038] hover:underline"
            >
              Use suggested ({suggested})
            </button>
          )}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-sm font-bold tabular-nums text-slate-700">× {item.quantity}</span>
          {/* A lapsed booking lists what it holds and nothing else: no state
              badge, no controls. Nothing on it is live, so nothing here is
              offered for change — cancelling the booking is what releases it. */}
          {!money?.is_lapsed && (
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${item.returned ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-slate-50 border border-slate-200 text-slate-600'}`}>
            {item.returned ? 'Returned' : 'Assigned'}
          </span>
          )}
          {!item.returned && !money?.is_lapsed && (
            <div className="flex gap-2">
              <button
                onClick={() => openEditEquipModal(item)}
                className={isResourceLocked(booking.booking_status, lapsedLock) ? 'text-slate-400 hover:text-slate-600' : 'text-blue-500 hover:text-blue-700'}
                title={isResourceLocked(booking.booking_status, lapsedLock) ? resourceLockReason(booking.booking_status, 'equipment', lapsedLock) : 'Edit quantity'}
              >
                {isResourceLocked(booking.booking_status, lapsedLock) ? <Lock size={14} /> : <Edit size={14} />}
              </button>
              <button
                onClick={() => handleRemoveEquipment(item)}
                className={isResourceLocked(booking.booking_status, lapsedLock) ? 'text-slate-400 hover:text-slate-600' : 'text-red-400 hover:text-red-600'}
                title={isResourceLocked(booking.booking_status, lapsedLock) ? resourceLockReason(booking.booking_status, 'equipment', lapsedLock) : 'Remove'}
              >
                {isResourceLocked(booking.booking_status, lapsedLock) ? <Lock size={14} /> : <Trash2 size={14} />}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Items the package template implies that carry no line at all. Without
  // this they are invisible: the panel lists what IS assigned, so something
  // the manager removed, or that approval never allocated, simply vanishes.
  const missingSuggested = Object.values(suggestedById).filter(
    r => r.equipment_id && Number(r.required_qty) > 0 && !equipment.some(e => e.equipment_id === r.equipment_id),
  );

  // --- PAYMENT CALCULATIONS (including Cancelled) ---
  // `positivePayments` stays a gross figure (money paid in, ignoring
  // refunds) — the refund-eligibility math below (refundableBase,
  // remainingRefundableAmount, refundStatus, Cancel modal's maxRefundable)
  // all depend on that gross number. `netPaid` is refunds netted out, used
  // only where the UI is showing "how much does the customer actually have
  // paid in right now" (the Total Paid stat).
  const positivePayments = sumVerifiedPositivePayments(payments);
  const totalRefunded = payments
    .filter(p => isRefundEntry(p) && movesBooks(p))
    .reduce((sum, p) => sum + Math.abs(p.amount_paid), 0);
  const netPaid = Math.max(0, positivePayments - totalRefunded);

  // A refund is money going out, not a kind of payment — it doesn't belong
  // in the Payment Tracking ledger alongside actual payments. Split once
  // here so the Payment Tracking table only ever lists real payments, and
  // refunds get their own Refund History section instead.
  // A reversal is a correction to a receipt, so it is listed with the receipts
  // (beneath the one it cancels), never under Refund History.
  const paymentEntries = payments.filter(p => !isRefundEntry(p));
  const refundEntries = payments.filter(isRefundEntry);

  let remainingBalance = Math.max(0, (booking.total_amount || 0) - positivePayments);
  if (booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled') remainingBalance = 0;

  const downpaymentPaid = sumDepositsCollected(payments);

  // How much of the contract has actually been collected, as a proportion —
  // the hero's Balance KPI states it. Guarded so a booking with no total
  // reads 0% rather than NaN, and clamped so an overpayment cannot read 110%.
  // Runs, not rows — see groupDispatchRuns.
  const dispatchRuns = groupDispatchRuns(dispatches, booking);

  const pctCollected = (booking.total_amount || 0) > 0
    ? Math.min(100, Math.round((positivePayments / booking.total_amount) * 100))
    : 0;

  // Vehicles are dispatched for a booking that is going ahead. Approval is
  // what allocates them, so assigning before that point would be duplicated by
  // the auto-allocation approval runs; and a Cancelled, Rejected or Completed
  // booking is not going anywhere.
  const canDispatch = ACTIVE_BOOKING_STATUSES.includes(booking?.booking_status);

  const eventDate = booking.event_datetime ? new Date(booking.event_datetime) : null;
  const now = new Date();
  let daysUntilEvent = null;
  let isRefundable = false;
  if (eventDate) {
    const diffTime = eventDate.getTime() - now.getTime();
    daysUntilEvent = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    isRefundable = daysUntilEvent >= 3;
  }

  let remainingRefundableAmount = 0;
  if (booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled') {
    if (eventDate && daysUntilEvent !== null && daysUntilEvent < 3) {
      const refundableBase = Math.max(0, positivePayments - downpaymentPaid);
      remainingRefundableAmount = Math.max(0, refundableBase - totalRefunded);
    } else {
      remainingRefundableAmount = Math.max(0, positivePayments - totalRefunded);
    }
  }

  let refundStatus = null;
  if (positivePayments > 0 && (booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled')) {
    if (totalRefunded >= positivePayments) {
      refundStatus = 'Fully Refunded';
    } else if (isRefundable) {
      refundStatus = 'Refundable';
    } else {
      refundStatus = 'Non-Refundable';
    }
  }

  // Cancellation opens up once the event is genuinely locked in (Confirmed)
  // — not while it is merely Approved-but-unpaid.
  //
  // WITH ONE EXCEPTION: an Approved booking whose event date has passed. It
  // can no longer be confirmed, so under the old rule it had no ending at all
  // — not Confirm, not Complete, not Cancel, not Reject — and a manager could
  // only close it through a manager override. Overrides are for corrections
  // and for recording something genuinely unusual; a request that went stale
  // waiting for an answer is neither, and a log full of routine overrides
  // stops meaning anything. So a lapsed booking can be cancelled outright.
  const canCancel = booking.booking_status === 'Confirmed'
    || (booking.booking_status === 'Approved' && !!money?.is_lapsed);
  const showAddRefund = (booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled') && remainingRefundableAmount > 0;
  // Payments only open up once a booking has been approved (Updated Flow:
  // Pending -> Approve/Reject -> Proceed to Payment). Confirmed/Completed
  // bookings can still take a late/final payment.
  const canRecordPayment = ['Approved', 'Confirmed', 'Completed'].includes(booking.booking_status);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* ================= HERO =================
          The old header was a back arrow, a name and a booking number, with
          the four figures a manager actually opens this page for scattered
          down a 430px rail. Those four are promoted here; none of them is a
          new calculation. */}
      <div className="relative overflow-hidden rounded-[18px] bg-[#00713a] p-[clamp(22px,2.4vw,30px)] shadow-[0_10px_24px_-14px_rgba(4,47,26,0.42)]">
        <div className="absolute -top-[150px] -right-[110px] w-[380px] h-[380px] rounded-full bg-white/[0.06]" />
        <div className="absolute -bottom-[190px] left-[34%] w-[320px] h-[320px] rounded-full bg-white/[0.045]" />

        <div className="relative flex items-start justify-between gap-5 flex-wrap">
          <div className="min-w-0">
            <button
              onClick={() => navigate('/app/bookings')}
              className="inline-flex items-center gap-1.5 mb-[11px] text-[13px] font-semibold text-white/80 hover:text-white cursor-pointer"
            >
              <ArrowLeft size={15} /> Back to Events
            </button>
            <div className="flex items-center gap-[11px] flex-wrap">
              <h1 className="text-[clamp(24px,2.3vw,30px)] font-extrabold tracking-[-0.03em] text-white">
                {booking.customer?.first_name} {booking.customer?.last_name}
                {booking.package?.pkg_name ? ` — ${booking.package.pkg_name}` : ''}
              </h1>
              {/* booking_number, not booking_id — the id is a uuid. */}
              <span className="px-[11px] py-[5px] rounded-full bg-white/[0.16] text-xs font-bold tracking-[0.04em] text-white whitespace-nowrap">
                {booking.booking_number || `#${booking.booking_id.slice(0, 8)}`}
              </span>
            </div>
            <p className="mt-2 flex items-start gap-[7px] text-sm text-white/[0.84]">
              <MapPin size={15} className="shrink-0 mt-0.5" /> {booking.venue || 'No venue set'}
            </p>
          </div>

          {/* Status chips — existing logic, unchanged, moved here. */}
          <div className="flex items-center gap-3 flex-wrap">
        <span className={`px-4 py-1.5 rounded-full text-xs font-bold border ${(
          booking.booking_status === 'Pending' ? 'bg-amber-50 border-amber-200 text-amber-700' :
          booking.booking_status === 'Approved' ? 'bg-[#EAF3F2] border-[#C1DEDC] text-slate-800' :
          booking.booking_status === 'Confirmed' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
          booking.booking_status === 'Completed' ? 'bg-blue-50 border-blue-200 text-blue-700' :
          booking.booking_status === 'Cancelled' ? 'bg-slate-100 border-slate-300 text-slate-600' :
          'bg-red-50 border-red-200 text-red-700'
        )}`}>
          {booking.booking_status}
        </span>

        {/* Grey, and never the rose used for overdue: this request is dead,
            not urgent. See utils/lapsed.js. */}
        {money?.is_lapsed && (
          <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-slate-100 border-slate-300 text-slate-600" title={LAPSED_ACCEPT_TOOLTIP}>
            {lapsedChipLabel(booking.event_datetime)}
          </span>
        )}

        {hasUnpaidPastEvent({ booking_status: booking.booking_status, event_datetime: booking.event_datetime, total_amount: booking.total_amount, positivePayments }) && (
          <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-red-50 border-red-200 text-red-700">
            Past Event — ₱{remainingBalance.toLocaleString()} Remaining
          </span>
        )}

        {/* Refund status indicator for rejected/cancelled bookings with payments */}
        {refundStatus === 'Fully Refunded' && (
          <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-blue-50 border-blue-200 text-blue-700">
            Fully Refunded
          </span>
        )}
        {refundStatus === 'Refundable' && (
          <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-green-50 border-green-200 text-green-700">
            Refundable
          </span>
        )}
        {refundStatus === 'Non-Refundable' && (
          <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-red-50 border-red-200 text-red-700">
            Non-Refundable
          </span>
        )}

        {/* ✅ NEW: Show balance remaining for completed bookings */}
{booking.booking_status === 'Completed' && positivePayments < (booking.total_amount || 0) && (
  <span className="px-4 py-1.5 rounded-full text-xs font-bold border bg-amber-50 border-amber-200 text-amber-700">
    Balance Remaining
  </span>
)}
          </div>
        </div>

        <div className="relative grid grid-cols-2 md:grid-cols-4 gap-px mt-[26px] bg-white/[0.16] rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-4 bg-white/[0.07]">
            <span className="block text-[10.5px] font-bold tracking-[0.12em] uppercase text-white/[0.82]">Event date</span>
            <div className="mt-1.5 text-[21px] font-extrabold tracking-[-0.025em] text-white">{fmtShortDate(booking.event_datetime)}</div>
            <span className="block mt-[3px] text-xs text-white/70">{fmtTime(booking.event_datetime) || '—'}</span>
          </div>
          <div className="px-[18px] py-4 bg-white/[0.07]">
            <span className="block text-[10.5px] font-bold tracking-[0.12em] uppercase text-white/[0.82]">Guests</span>
            <div className="mt-1.5 text-[21px] font-extrabold tracking-[-0.025em] text-white">{booking.pax_count}</div>
            <span className="block mt-[3px] text-xs text-white/70">{booking.package?.pkg_name || 'No package'}</span>
          </div>
          <div className="px-[18px] py-4 bg-white/[0.07]">
            <span className="block text-[10.5px] font-bold tracking-[0.12em] uppercase text-white/[0.82]">Contract total</span>
            <div className="mt-1.5 text-[21px] font-extrabold tracking-[-0.025em] text-white">₱{booking.total_amount?.toLocaleString() || '0'}</div>
            <span className="block mt-[3px] text-xs text-white/70">{booking.package?.pricing_type === 'fixed' ? 'Fixed pricing' : 'Per pax'}</span>
          </div>
          <div className="px-[18px] py-4 bg-white/[0.07]">
            <span className="block text-[10.5px] font-bold tracking-[0.12em] uppercase text-white/[0.82]">Balance</span>
            <div className={`mt-1.5 text-[21px] font-extrabold tracking-[-0.025em] ${remainingBalance > 0 ? 'text-[#ffd88a]' : 'text-white'}`}>₱{remainingBalance.toLocaleString()}</div>
            <span className="block mt-[3px] text-xs text-white/70">{pctCollected}% collected</span>
          </div>
        </div>
      </div>

      {/* Actions — every button unchanged, lifted out of the hero so the
          coloured states do not fight the green. */}
      <div className="flex items-center gap-3 flex-wrap bg-white border border-slate-200 rounded-2xl px-[18px] py-3.5 shadow-xs">
          {booking.booking_status === 'Pending' && (
            <>
              {/* Approving is the accepting act, so a passed event date takes
                  it away. Reject stays, with the reason already written. */}
              <button
                onClick={() => openApprovalModal(booking, 'package')}
                disabled={!!money?.is_lapsed}
                title={money?.is_lapsed ? LAPSED_ACCEPT_TOOLTIP : undefined}
                className={`font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm ${money?.is_lapsed ? 'bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed shadow-none' : 'bg-[#008A45] hover:bg-[#007038] text-white'}`}
              >
                {money?.is_lapsed ? <Lock size={18} /> : <Check size={18} />} Approve
              </button>
              <button onClick={() => openRejectionModal(booking.booking_id, money?.is_lapsed ? LAPSED_DECLINE_REASON : '')} className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm">
                <X size={18} /> Reject
              </button>
            </>
          )}
          {canConfirmBooking && (
            /* Confirming is an acceptance too — the guard refuses entry to
               Approved OR Confirmed once the date has gone. */
            <button
              onClick={handleConfirmBooking}
              disabled={isConfirming || !!money?.is_lapsed}
              title={money?.is_lapsed ? LAPSED_ACCEPT_TOOLTIP : undefined}
              className={`font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm disabled:opacity-50 ${money?.is_lapsed ? 'bg-slate-100 border border-slate-200 text-slate-400 cursor-not-allowed shadow-none' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
            >
              {money?.is_lapsed ? <Lock size={18} /> : <Check size={18} />} {isConfirming ? 'Confirming...' : 'Confirm Event'}
            </button>
          )}
          {canMarkCompleted && (
            <button
              onClick={handleMarkCompleted}
              disabled={isCompleting}
              className={isCompletionFullyPaid ? 'bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm disabled:opacity-50' : 'bg-white border border-slate-300 text-slate-500 font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors'}
              title={isCompletionFullyPaid ? undefined : `Locked — ₱${completionRemainingBalance.toLocaleString()} balance due`}
            >
              {isCompletionFullyPaid ? <Check size={18} /> : <Lock size={18} />} {isCompleting ? 'Completing...' : 'Mark Completed'}
            </button>
          )}
          {canCancel && (
            <button
              onClick={openCancelModal}
              title={money?.is_lapsed ? 'Closes the record' : undefined}
              className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
            >
              <X size={18} /> Cancel Booking
            </button>
          )}
          {showAddRefund && (
            <button
              onClick={openRefundModal}
              className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
            >
              Add Refund
            </button>
          )}
          <button
            onClick={openEditModal}
            className={(isPaymentLedgerLocked(booking.booking_status) || editWouldLoseTotal() > 0) ? 'bg-white border border-slate-300 text-slate-400 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors' : 'bg-white border border-slate-300 text-slate-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50 transition-colors'}
            title={isPaymentLedgerLocked(booking.booking_status)
              ? bookingEditLockedMessage(booking.booking_status)
              : editWouldLoseTotal() > 0
                ? totalLossLockedMessage(booking.total_amount, recomputedBookingTotal())
                : undefined}
          >
            {(isPaymentLedgerLocked(booking.booking_status) || editWouldLoseTotal() > 0) ? <Lock size={16} /> : <Edit size={16} />} Edit
          </button>
          {/* The sanctioned exception path. Goes through the RPC, never a
              direct status write, so the reason is captured and the log
              records an override rather than an ordinary manual change. */}
          <button
            onClick={() => setIsOverrideOpen(true)}
            className="bg-white border border-blue-300 text-blue-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-blue-50 transition-colors"
            title="Set any status, with a recorded reason"
          >
            <ShieldAlert size={16} /> Override Status
          </button>
          <button
            onClick={handleDelete}
            className="bg-white border border-red-300 text-red-600 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-red-50 transition-colors"
            title="Permanently delete this booking (password required)"
          >
            <Trash2 size={16} /> Delete
          </button>
          <button onClick={fetchBooking} className="bg-white border border-slate-300 text-slate-700 font-bold text-sm px-4 py-2.5 rounded-lg flex items-center gap-2 hover:bg-slate-50">
            <RefreshCw size={16} /> Refresh
          </button>
      </div>


      {/* The system changed this booking and wants a person to look. Sits
          above the payment banner because it is about the booking itself,
          not about one receipt. */}
      {money?.flagged_for_review && (
        <ReviewFlagBanner
          bookingId={booking.booking_id}
          reason={money.flag_reason}
          flaggedAt={money.flagged_at}
          onCleared={fetchBooking}
        />
      )}

      {/* Mobile payment(s) awaiting verification — a manually recorded
          payment is verified by definition, so this only ever fires for
          something the customer submitted from the app that needs a
          manager's eyes on the proof. */}
      {payments.some(p => p.pay_status === PENDING_VERIFICATION) && (
        <div className="relative overflow-hidden rounded-xl border-2 border-red-300 bg-red-50 p-4 flex items-center gap-3">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-bold text-red-800">
              {payments.filter(p => p.pay_status === PENDING_VERIFICATION).length} payment{payments.filter(p => p.pay_status === PENDING_VERIFICATION).length > 1 ? 's' : ''} awaiting verification
            </p>
            <p className="text-xs text-red-600">Submitted from the mobile app — review the proof below and Verify or Reject it.</p>
          </div>
        </div>
      )}

      {/* Day / Equipment Availability — any Pending booking, same shared layout as the Approve modal */}
      {booking.booking_status === 'Pending' && booking.event_datetime && !money?.is_lapsed && (
        <ApprovalAvailabilityCheck
                onVehicleSelectionChange={setApprovalVehicleIds}
          booking={booking}
          effectivePaxCount={booking.pax_count || 0}
        />
      )}

      <div className="space-y-6">
        {/* LEFT COLUMN */}
      {/* ================= EVENT + CUSTOMER =================
          Full width, not a 430px rail. The old 5/7 split put twelve
          label/value rows against four list cards, so the left column ended a
          third of the way down and the values inside it were squeezed to
          ~280px — a venue address wrapped to two lines in the width "120" was
          wasting. Labels now sit ABOVE their values, so each value gets the
          whole cell. */}
      <div className="grid grid-cols-1 min-[980px]:grid-cols-12 gap-6 items-start">

        <SectionCard className="min-[980px]:col-span-7">
          <SectionHeader icon={Calendar} title="Event">
            <button onClick={openEditModal} className="text-[13px] font-bold text-[#007038] hover:text-[#00532a] cursor-pointer shrink-0">Edit</button>
          </SectionHeader>

          {/* grid-flow-row-dense: without it a `wide` field that cannot fit
              beside a single-width one leaves the neighbouring cell empty.
              Dense flow backfills those holes at every breakpoint. */}
          <div className="grid grid-flow-row-dense grid-cols-2 min-[820px]:grid-cols-3 gap-x-[22px] gap-y-[18px]">
            <Field label="Event date" value={fmtDateTime(booking.event_datetime)} />
            <Field label="Guests" value={`${booking.pax_count} pax`} />
            <Field label="Motif" value={booking.motif_color || 'N/A'} />
            <Field label="Venue" value={booking.venue || 'N/A'} wide />
            <Field label="Package" value={booking.package?.pkg_name || 'None'} />
            <Field label="Booked on" value={fmtDateTime(booking.book_datetime)} />
            <Field label="Total amount">
              <span className="text-[#007038]">₱{booking.total_amount?.toLocaleString() || '0'}</span>
            </Field>
            {booking.package && (
              <Field label="Pricing" wide>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2.5 py-[3px] rounded-full bg-[#f4f6f8] border border-slate-200 text-[11.5px] font-bold text-slate-600">
                    {booking.package.pricing_type === 'fixed' ? 'Fixed' : 'Per pax'}
                  </span>
                  <span className="text-[14.5px] font-bold text-slate-900">₱{booking.package.pkg_price?.toLocaleString()}</span>
                  {booking.package.pricing_type === 'fixed'
                    ? booking.package.max_pax && <span className="text-[12.5px] text-slate-500">up to {booking.package.max_pax} pax</span>
                    : <span className="text-[12.5px] text-slate-500">/pax</span>}
                </div>
              </Field>
            )}
          </div>

          {booking.notes && (
            <div className="flex items-start gap-2.5 mt-[22px] px-4 py-3.5 bg-[#fbfcfd] border border-[#eef2f6] rounded-xl">
              <Pencil size={15} className="shrink-0 mt-0.5 text-slate-400" />
              <div className="min-w-0">
                <span className="block text-[10.5px] font-bold tracking-[0.1em] uppercase text-slate-600">Notes</span>
                {/* The refund flow appends "[REFUND] Amount: PHP ..." into this
                    user-facing field. Stripped from DISPLAY only — the stored
                    value is untouched, because this column is shared with the
                    customer mobile app. The refund is stated properly by the
                    Refund History card below. */}
                <p className="mt-1 text-[13.5px] leading-[1.5] text-slate-700 whitespace-pre-wrap [text-wrap:pretty]">{displayNotes(booking.notes)}</p>
              </div>
            </div>
          )}
        </SectionCard>

        <SectionCard className="min-[980px]:col-span-5">
          <SectionHeader icon={User} title="Customer" />

          <div className="flex items-center gap-[13px] pb-[18px] border-b border-slate-100">
            <span className="inline-flex items-center justify-center w-[46px] h-[46px] rounded-full bg-[#00713a] text-base font-extrabold text-white shrink-0">
              {initialsOf(booking.customer)}
            </span>
            <div className="min-w-0">
              <span className="block text-[15.5px] font-bold text-slate-900 break-words">
                {booking.customer?.first_name} {booking.customer?.last_name}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-[3px] mt-2">
            {[
              { Icon: Phone, label: 'Contact', value: booking.customer?.contact_no || 'N/A' },
              { Icon: Mail, label: 'Email', value: booking.customer?.email_address || 'N/A' },
              { Icon: MapPin, label: 'Address', value: booking.customer?.cus_address || 'N/A' },
            ].map(({ Icon, label, value }) => (
              <div key={label} className="flex items-start gap-[11px] px-0.5 py-2.5">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-[9px] bg-[#f6f8fa] text-slate-500 shrink-0">
                  <Icon size={14} />
                </span>
                <div className="min-w-0 pt-px">
                  <span className="block text-[10.5px] font-bold tracking-[0.1em] uppercase text-slate-600">{label}</span>
                  <div className="mt-[3px] text-sm font-semibold leading-[1.4] text-slate-900 break-words [text-wrap:pretty]">{value}</div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      {/* ================= LISTS =================
          The former right column, now a real 50/50. Its cards are direct grid
          children, so they fill row-wise: Menu | Payments, Equipment |
          Dispatch. items-start stops the shorter column stretching to match
          the taller one, which was a second source of apparent emptiness. */}
        {/* One 12-column grid per ROW, every row using the same 7/5 spans, so
            the seam between the columns sits at the same x all the way down.
            It used to be grid-cols-12 for the first row and a separate 50/50
            grid for everything below, which moved the seam ~70px partway down.

            Explicit rows rather than one flowing grid: in a single grid a card
            migrates between columns depending on what precedes it, so Equipment
            sat in a different column on a record that had Refund History than
            on one that did not.

            The 7-column side takes the cards containing TABLES; the 5-column
            side takes list and summary cards.

            items-stretch, not items-start. The comment that used to sit here
            defended items-start as stopping the shorter column stretching —
            which is precisely what left a ~180px void beside Menu Selections.
            Stretching moves that space INSIDE the card, where it reads as
            padding rather than a hole in the page.

            NOTE: the section comments in this block used to name the wrong
            cards — "Payment Tracking" sat above Menu Selections, "Dispatch"
            above Payment Tracking, "Menu Selections" above Equipment. Each
            card is now labelled by what it actually renders. */}
        {/* Two independent COLUMN STACKS, not paired rows.

            Pairing cards into rows and stretching them to equal height did
            exactly what it was meant to prevent: Equipment, with three line
            items, was padded to match a Dispatch card that was itself
            scrolling inside a 300px cap. Content was hidden on one side and
            ~200px of white space manufactured on the other, in the same row.

            Stretching only helps when two cards are close in height. These are
            not: Menu is a fixed short list, Dispatch and Equipment both grow
            with the record.

            Each column is now a stack at natural height. What is left over
            falls to the BOTTOM of the shorter column, below its last card,
            where it is page background rather than a hole punched in a white
            card. The seam still sits at one x, because the columns are fixed
            7/5 widths — and a card still cannot migrate between columns,
            because membership is explicit here. That was only ever a hazard of
            a single flowing grid. */}
        <div className="grid grid-cols-1 min-[980px]:grid-cols-12 gap-6 items-start">
          <div className="min-[980px]:col-span-7 flex flex-col gap-6 min-w-0">
            {/* Payment Tracking */}
            <div className="bg-white border border-slate-200 rounded-2xl p-[clamp(20px,2.2vw,24px)] shadow-xs">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-[11px] min-w-0"><span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px] bg-[#f4f6f8] text-slate-600 shrink-0"><CreditCard size={17} /></span><h3 className="text-[15px] font-bold tracking-[-0.015em] text-slate-900">Payment Tracking</h3></div>
                {canRecordPayment && (
                  <button
                    onClick={openPaymentModal}
                    className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
                  >
                    <Plus size={14} /> Record Payment
                  </button>
                )}
                {!canRecordPayment && booking.booking_status === 'Pending' && (
                  <span className="text-xs text-slate-400 italic">Approve this booking to enable payments</span>
                )}
                {!canRecordPayment && (booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled') && (
                  <span className="text-xs text-slate-400 italic">Payments closed</span>
                )}
              </div>
              {/* One panel instead of four stacked rows. Total, downpayment, paid
                  and remaining were four equal grey bars, so the figure a manager
                  opens this card for — what is still owed — had the same weight
                  as the contract total they already knew. The relationship is a
                  proportion, so it is drawn as one. */}
              <div className="bg-[#fbfcfd] border border-[#eef2f6] rounded-[13px] px-[19px] py-[17px] mb-3.5">
                <span className="block text-[10.5px] font-bold tracking-[0.11em] uppercase text-slate-500">
                  {booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled' ? 'Balance' : 'Balance remaining'}
                </span>
                <div className="mt-1.5 flex items-baseline gap-2.5 flex-wrap">
                  <span className={`text-[clamp(28px,2.6vw,34px)] font-extrabold tracking-[-0.035em] tabular-nums ${
                    remainingBalance > 0 ? 'text-[#8a5a0a]' : 'text-[#056636]'
                  }`}>
                    {booking.booking_status === 'Rejected' || booking.booking_status === 'Cancelled'
                      ? `N/A — ${booking.booking_status}`
                      : `₱${remainingBalance.toLocaleString()}`}
                  </span>
                  <span className="text-[13px] font-semibold text-slate-500">of ₱{booking.total_amount?.toLocaleString() || '0'}</span>
                </div>
                {/* Clamped at 100% so an overpayment cannot draw a bar wider than
                    its track — the same guard FinancialTab uses. */}
                <div className="mt-[13px] h-2 rounded-full bg-[#e8edf3] overflow-hidden">
                  <div className="h-full rounded-full bg-[#008A45]" style={{ width: `${pctCollected}%` }} />
                </div>
                <span className="block mt-2 text-xs font-semibold text-slate-500">
                  {pctCollected}% collected · ₱{netPaid.toLocaleString()} of ₱{booking.total_amount?.toLocaleString() || '0'}
                  {downpaymentPaid > 0 && ` · ₱${downpaymentPaid.toLocaleString()} deposit`}
                </span>
              </div>

              {paymentEntries.length > 0 && (
                <div className="mt-4 border border-slate-300 rounded-lg overflow-hidden">
                  <CardScrollArea>
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-[#EAF3F2] text-slate-900 font-bold border-b border-slate-300">
                        <th className="p-3">Amount</th>
                        <th className="p-3">Method</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Reference / Proof</th>
                        <th className="p-3">Date</th>
                        <th className="p-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-slate-700">
                      {paymentEntries.map(p => {
                        const pendingVerification = p.pay_status === PENDING_VERIFICATION;
                        // The stored stage is the truth now; reversed entries and
                        // the reversals themselves say so instead.
                        const badge = ledgerEntryBadge(p);
                        return (
                        <tr key={p.payment_id} className={pendingVerification ? 'bg-blue-50' : ''}>
                          <td className={`p-3 font-bold tabular-nums ${badge.struck ? 'line-through text-slate-400' : ''}`}>
                            {p.amount_paid < 0 ? '−' : ''}₱{Math.abs(p.amount_paid).toLocaleString()}
                          </td>
                          <td className="p-3">{p.pay_method || 'N/A'}</td>
                          <td className="p-3">
                            <span title={badge.note || undefined} className={`px-2 py-1 rounded-full border text-xs font-medium whitespace-nowrap ${badge.className}`}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="p-3">{renderEvidence(p)}</td>
                          <td className="p-3">{p.pay_datetime ? new Date(p.pay_datetime).toLocaleString() : 'N/A'}</td>
                          <td className="p-3 text-center">
                            {pendingVerification && (
                              <div className="flex justify-center gap-2">
                                <button onClick={() => openVerifyModal(p)} disabled={isVerifying} className="text-green-600 hover:text-green-800 disabled:opacity-50" title="Verify Payment">
                                  <Check size={14} />
                                </button>
                                <button onClick={() => openRejectProofModal(p)} disabled={isVerifying} className="text-red-500 hover:text-red-700 disabled:opacity-50" title="Reject Proof">
                                  <X size={14} />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </CardScrollArea>
                </div>
              )}
            </div>

            {/* Equipment Assignment */}
            <div className="bg-white border border-slate-200 rounded-2xl p-[clamp(20px,2.2vw,24px)] shadow-xs">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-[11px] min-w-0"><span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px] bg-[#f4f6f8] text-slate-600 shrink-0"><Briefcase size={17} /></span><h3 className="text-[15px] font-bold tracking-[-0.015em] text-slate-900">Equipment Assignment</h3></div>
                <div className="flex items-center gap-2.5">
                  {/* The count moved to the footer, where it sits beside the unit
                      total it belongs with. What earns space in the header is the
                      STATE: whether anything is still out. */}
                  {equipment.length > 0 && !money?.is_lapsed && (
                    equipment.every(i => i.returned)
                      ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap"><Check size={13} /> All returned</span>
                      : equipment.some(i => i.returned)
                        ? <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">{equipment.filter(i => i.returned).length} of {equipment.length} returned</span>
                        : <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap"><Check size={13} /> All assigned</span>
                  )}
                  {!money?.is_lapsed && (
                  <button
                    onClick={openAssignEquipModal}
                    className={isResourceLocked(booking.booking_status, lapsedLock)
                      ? 'bg-slate-100 text-slate-400 font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors'
                      : 'bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors shadow-sm'}
                    title={isResourceLocked(booking.booking_status, lapsedLock) ? resourceLockReason(booking.booking_status, 'equipment', lapsedLock) : undefined}
                  >
                    {isResourceLocked(booking.booking_status, lapsedLock) ? <Lock size={14} /> : <ClipboardList size={14} />} Assign Equipment
                  </button>
                  )}
                </div>
              </div>
              {equipment.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No equipment allocated.</p>
              ) : (
                <CardScrollArea>
                {/* Divided rows rather than a stack of boxes: with a dozen line
                    items a bordered card each turns the list into corduroy. The
                    quantity gets its own right-hand column so the numbers read
                    DOWN as a column instead of trailing each name. */}
                {equipmentGroups ? (
                  // Two labelled groups, package-derived first. A quiet label
                  // and a unit subtotal per group — organisation, not an alert.
                  <div className="space-y-4">
                    {equipmentGroups.map(group => (
                      <div key={group.key}>
                        <div className="flex justify-between items-baseline gap-3 px-1 pb-1.5 text-xs text-slate-500">
                          <span className="font-semibold uppercase tracking-[0.05em]">{group.title}</span>
                          <span className="tabular-nums">{group.units} unit{group.units !== 1 ? 's' : ''}</span>
                        </div>
                        <div className="divide-y divide-slate-100 border-t border-slate-100">
                          {group.rows.map(({ item, note }, idx) => renderEquipmentRow(item, idx, note))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {equipment.map((item, idx) => renderEquipmentRow(item, idx, null))}
                  </div>
                )}
                </CardScrollArea>
              )}
              {/* In the package, not on this booking. Listed so a manager can
                  see what the template implies and put it back in one click;
                  it is not an error state, and nothing here is enforced. */}
              {missingSuggested.length > 0 && !isResourceLocked(booking.booking_status, lapsedLock) && (
                <div className="mt-3.5 pt-3 border-t border-slate-100">
                  <p className="text-xs font-semibold uppercase tracking-[0.05em] text-slate-500 mb-1.5">
                    In the package, not assigned
                  </p>
                  <div className="divide-y divide-slate-100">
                    {missingSuggested.map(r => {
                      const free = availability.status === 'ready' ? availability.byId[r.equipment_id]?.free : null;
                      return (
                        <div key={r.equipment_id} className="flex justify-between items-center gap-3 px-1 py-2.5">
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-slate-700 truncate">{r.eqm_name}</span>
                            <span className="block text-xs text-slate-500">
                              Suggested {r.required_qty}
                              {free !== null && <> · {free} free on {eventDayLabel(booking.event_datetime)}</>}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => applySuggestedQuantity(r.equipment_id, r.required_qty, r.eqm_name)}
                            className="shrink-0 text-[12px] font-semibold text-[#007038] hover:underline"
                          >
                            Use suggested ({r.required_qty})
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Line items and units are different quantities and were never
                  both stated — the header said "3 items" of a 109-unit
                  allocation. */}
              {equipment.length > 0 && (
                <div className="flex justify-between items-center gap-3 mt-3.5 pt-3 border-t border-slate-100 text-[12.5px] text-slate-500">
                  <span>{equipment.length} line item{equipment.length !== 1 ? 's' : ''}</span>
                  <span className="font-semibold text-slate-700 tabular-nums">
                    {equipment.reduce((sum, i) => sum + (Number(i.quantity) || 0), 0)} units total
                  </span>
                </div>
              )}
              {/* Only when something beyond the initial allocation happened: a
                  booking that was simply allocated at approval has nothing
                  worth opening. Collapsed by default. */}
              {allocationLog.some(r => r.action !== 'added') && (
                <div className="mt-3.5 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => setIsAllocationHistoryOpen(open => !open)}
                    aria-expanded={isAllocationHistoryOpen}
                    className="flex items-center gap-1.5 text-[12.5px] font-semibold text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    {isAllocationHistoryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    Allocation history
                    <span className="font-normal text-slate-400 tabular-nums">({allocationLog.length})</span>
                  </button>
                  {isAllocationHistoryOpen && (
                    <ul className="mt-2.5 space-y-1.5">
                      {allocationLog.map(row => (
                        <li key={row.log_id} className="text-[12.5px] text-slate-600 tabular-nums">
                          <span className="font-semibold text-slate-800">{row.eqm_name}</span>
                          {' · '}{describeAllocationChange(row)}
                          {' · '}{formatLogTime(row.changed_at)}
                          <span className="text-slate-400">{' · '}{row.changed_by_name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="min-[980px]:col-span-5 flex flex-col gap-6 min-w-0">
            {/* Why the status is what it is — including changes nobody on this
                page made. Sits above Menu Selections because it is the first
                question asked of a booking that moved on its own. */}
            <StatusHistory bookingId={booking.booking_id} refreshKey={historyKey} />

            {/* Menu Selections */}
            <div className="bg-white border border-slate-200 rounded-2xl p-[clamp(20px,2.2vw,24px)] shadow-xs">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-[11px] min-w-0"><span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px] bg-[#f4f6f8] text-slate-600 shrink-0"><UtensilsCrossed size={17} /></span><h3 className="text-[15px] font-bold tracking-[-0.015em] text-slate-900">Menu Selections</h3></div>
                <span className="text-xs font-medium text-slate-500">{menuSelections.length} item{menuSelections.length !== 1 ? 's' : ''}</span>
              </div>
              {menuSelections.length === 0 ? (
                <p className="text-sm text-slate-500 italic">No menu selections recorded.</p>
              ) : (
                <CardScrollArea>
                <div className="space-y-2">
                  {/* Category is the QUIET half — it repeats down the column and
                      only says which slot the dish fills. The dish is the thing
                      being read, so it carries the ink. */}
                  {menuSelections.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
                      <span className="shrink-0 px-[11px] py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-600 whitespace-nowrap">
                        {item.category_name}
                      </span>
                      <span className="text-[13.5px] font-semibold text-slate-900 text-right">{item.menu_name}</span>
                    </div>
                  ))}
                </div>
                </CardScrollArea>
              )}
            </div>

            {/* Dispatch — blueprint-03 5.8. Until now a vehicle appeared on
                this page only inside the delete warning, so the booking never
                knew what was carrying it while the vehicle knew its booking. */}
            <div className="bg-white border border-slate-200 rounded-2xl p-[clamp(20px,2.2vw,24px)] shadow-xs">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-[15px] font-bold tracking-[-0.015em] text-slate-900 flex items-center gap-2">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px] bg-[#f4f6f8] text-slate-600 shrink-0"><Truck size={17} /></span>
                  <span className="min-w-0">
                    Dispatch
                    <span className="block mt-0.5 text-[12.5px] font-normal text-slate-500">
                      {dispatchRuns.length} run{dispatchRuns.length !== 1 ? 's' : ''} · {countDistinctVehicles(dispatches)} vehicle{countDistinctVehicles(dispatches) !== 1 ? 's' : ''}
                      {dispatches.length > 0 && (dispatches.every(d => d.assignment_status === 'Completed') ? ' · all returned' : ' · all assigned')}
                    </span>
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200">
                    Package
                  </span>
                </h3>
                <div className="flex items-center gap-2">
                  {/* Always rendered and locked, the way Equipment does it — the
                      button used to vanish entirely, so a Confirmed booking gave
                      no hint that dispatch was deliberately closed rather than
                      missing. */}
                  <button
                    onClick={openAssignVehicleModal}
                    className={isResourceLocked(booking.booking_status, lapsedLock)
                      ? 'bg-slate-100 text-slate-400 font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors'
                      : 'bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors shadow-sm'}
                    title={isResourceLocked(booking.booking_status, lapsedLock) ? resourceLockReason(booking.booking_status, 'vehicles', lapsedLock) : undefined}
                  >
                    {isResourceLocked(booking.booking_status, lapsedLock) ? <Lock size={14} /> : <ClipboardList size={14} />} {dispatches.length === 0 ? 'Assign vehicle' : 'Manage'}
                  </button>

                </div>
              </div>

              {dispatches.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {canDispatch
                    ? 'No vehicle assigned yet. This event still needs transport arranged.'
                    : booking?.booking_status === 'Pending'
                      ? 'Vehicles are assigned when this booking is approved.'
                      : `No vehicles — this booking is ${booking?.booking_status?.toLowerCase() || 'not active'}.`}
                </p>
              ) : (
                <CardScrollArea>
                <div className="space-y-2.5">
                  {/* One block per RUN, not per vehicle-leg. The window text was
                      repeated once per vehicle, so a three-van event rendered
                      six near-identical rows. Grouped on the exact departure
                      time, so vehicles that genuinely leave at different times
                      still get their own block rather than being folded into a
                      tidy summary that hides the difference. */}
                  {dispatchRuns.map(run => {
                    const isCollection = run.leg === TRIP_LEG.pickup;
                    const stages = run.rows.map(r => getAssignmentStatus(r.assignment_status === 'Completed', booking?.event_datetime));
                    // No stage pill on a lapsed booking: "In Use" would say a
                    // van is out at an event that never happened.
                    const shared = money?.is_lapsed ? null : (stages.every(st => st.key === stages[0].key) ? stages[0] : null);
                    const pill = (st) => `inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12.5px] font-semibold whitespace-nowrap ${
                      // One meaning per colour, and the EXPECTED state is the
                      // quiet one. "Assigned" is the normal condition of every
                      // row, yet it was the loudest thing on the card — an amber
                      // pill in Equipment and blue text here, two colours for one
                      // state. Slate for expected, amber for still-out, emerald
                      // for settled, all on a 50/200/700 ladder so equal weights
                      // read at equal strength.
                      st.key === 'returned' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                        : st.key === 'in_use' ? 'bg-amber-50 border border-amber-200 text-amber-700'
                        : 'bg-slate-50 border border-slate-200 text-slate-600'
                    }`;
                    return (
                      <div key={run.key} className="bg-[#fbfcfd] border border-[#eef2f6] rounded-xl overflow-hidden">
                        {/* The run's own header: an arrow saying which direction
                            the van is going, the leg named as a micro-label, and
                            the window as "leaves -> back" on one line. The leg
                            used to be a coloured pill competing with the status
                            pill beside it; direction is not a status, so it is
                            drawn as an icon and a quiet label instead. */}
                        <div className="flex items-start gap-3 px-4 pt-3.5 pb-3 border-b border-[#eef2f6]">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-[9px] shrink-0 ${
                            isCollection ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {isCollection ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                          </span>
                          <div className="min-w-0 flex-1">
                            <span className="block text-[10.5px] font-bold tracking-[0.1em] uppercase text-slate-500">
                              {run.legLabel || 'Run'}{isCollection ? ' \u00b7 return' : ' \u00b7 outbound'}
                            </span>
                            <span className="block mt-0.5 text-[13.5px] font-bold text-slate-900">
                              {run.window
                                ? `${run.window.start.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} \u2192 back ${run.window.end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                                : (run.dispatchAt ? new Date(run.dispatchAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time not set')}
                            </span>
                            {/* Display only, never a correction. BKG-110's three
                                collection runs sit at +68h, which is 44 hours
                                past the point its equipment is already flagged
                                Overdue; rendering them as ordinary runs is how
                                they stayed wrong. Fixing one means reassigning
                                it, which is Vaughn's call, not a silent write to
                                a database the customer mobile app shares. */}
                            {run.outsideBounds && (
                              <span className="inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-800 text-[11.5px] font-semibold">
                                <AlertTriangle size={10} /> Outside the expected window
                              </span>
                            )}
                          </div>
                          {shared && <span className={`${pill(shared)} shrink-0`}>{shared.label}</span>}
                        </div>

                        {/* One row per vehicle, divided rather than boxed, so the
                            plates line up down the left edge. */}
                        <div className="divide-y divide-[#eef2f6]">
                          {run.rows.map((d, i) => (
                            <div key={d.assignment_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                              <span className="flex items-baseline gap-2 min-w-0">
                                <span className="text-[13.5px] font-bold text-slate-900 whitespace-nowrap">{d.vehicle?.plate_number || 'Unknown vehicle'}</span>
                                <span className="text-[12.5px] text-slate-500 truncate">{d.vehicle?.vehicle_type || ''}</span>
                              </span>
                              <span className="flex items-center gap-3 shrink-0">
                                {!shared && !money?.is_lapsed && <span className={pill(stages[i])}>{stages[i].label}</span>}
                                {/* A returned run is history; a locked booking
                                    says why on its Manage button. */}
                                {d.assignment_status !== 'Completed' && !isResourceLocked(booking.booking_status, lapsedLock) && (
                                  <span className="flex items-center gap-2">
                                    <button
                                      onClick={() => openEditVehicleRun(d)}
                                      disabled={hasRunDeparted(d)}
                                      title={hasRunDeparted(d) ? 'This run has already left, so it cannot be changed.' : 'Change vehicle or time'}
                                      aria-label="Edit vehicle run"
                                      className="text-blue-500 hover:text-blue-700 disabled:text-slate-300 disabled:cursor-not-allowed"
                                    >
                                      <Edit size={14} />
                                    </button>
                                    <button
                                      onClick={() => handleRemoveVehicleRun(d, run.legLabel)}
                                      title="Remove this run"
                                      aria-label="Remove vehicle run"
                                      className="text-red-400 hover:text-red-600"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </span>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                </CardScrollArea>
              )}
            </div>
          </div>
        </div>

        {/* Refund History last and full width: five columns of table, and it
            only appears on a cancelled or refunded record. Below the two
            stacks rather than between them, so it never splits a column. */}
        <div className="grid grid-cols-1 min-[980px]:grid-cols-12 gap-6 items-start">
          {refundEntries.length > 0 && (
            <div className="min-[980px]:col-span-12 bg-white border border-slate-200 rounded-2xl p-[clamp(20px,2.2vw,24px)] shadow-xs">
              <div className="flex items-center gap-[11px] min-w-0 mb-4"><span className="inline-flex items-center justify-center w-8 h-8 rounded-[10px] bg-[#f4f6f8] text-slate-600 shrink-0"><RefreshCw size={17} /></span><h3 className="text-[15px] font-bold tracking-[-0.015em] text-slate-900">Refund History</h3></div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <span className="text-xs font-medium text-slate-700 block">Total Refunded</span>
                  <span className="font-bold text-red-700">-₱{totalRefunded.toLocaleString()}</span>
                </div>
                <div className={`rounded-lg p-3 border ${remainingRefundableAmount > 0 ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                  <span className="text-xs font-medium text-slate-700 block">Remaining Refundable</span>
                  <span className={`font-bold ${remainingRefundableAmount > 0 ? 'text-green-700' : 'text-slate-500'}`}>
                    ₱{remainingRefundableAmount.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600">
                <p>
                  <span className="font-bold">Refund Status:</span>{' '}
                  {refundStatus === 'Fully Refunded' ? (
                    <span className="text-blue-600 font-medium">Fully refunded</span>
                  ) : remainingRefundableAmount > 0 ? (
                    <span className="text-green-600 font-medium">Partial refund available (₱{remainingRefundableAmount.toFixed(2)})</span>
                  ) : refundStatus === 'Non-Refundable' ? (
                    <span className="text-red-600 font-medium">Non-refundable per policy</span>
                  ) : (
                    <span className="text-slate-600">No payments</span>
                  )}
                </p>
                {refundStatus === 'Non-Refundable' && (
                  <p className="mt-1 text-red-500">Deposit forfeited (event within 3 days)</p>
                )}
                {refundStatus === 'Fully Refunded' && (
                  <p className="mt-1 text-blue-500">All payments have been refunded.</p>
                )}
              </div>

              <div className="border border-slate-300 rounded-lg overflow-hidden">
                <CardScrollArea>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="bg-red-50 text-slate-900 font-bold border-b border-slate-300">
                      <th className="p-3">Amount</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Reason</th>
                      <th className="p-3">Reference / Proof</th>
                      <th className="p-3">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-700">
                    {refundEntries.map(p => (
                      <tr key={p.payment_id} className="bg-red-50/40">
                        <td className="p-3 font-bold text-red-600">
                          -₱{Math.abs(p.amount_paid).toLocaleString()}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200">
                            Refunded
                          </span>
                        </td>
                        <td className="p-3">{p.remarks || 'N/A'}</td>
                        <td className="p-3">{renderEvidence(p)}</td>
                        <td className="p-3">{p.pay_datetime ? new Date(p.pay_datetime).toLocaleString() : 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 border-t-2 border-slate-200">
                    <tr>
                      <td className="p-3 font-bold text-red-700">-₱{totalRefunded.toLocaleString()}</td>
                      <td colSpan="4" className="p-3 text-right font-medium text-slate-600">Total refunded</td>
                    </tr>
                  </tfoot>
                </table>
                </CardScrollArea>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== EDIT MODAL ===== */}
      {isEditModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Edit Booking</h2>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-6 overflow-y-auto space-y-5 bg-[#fbfcfd] text-left">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Customer *</label>
                <Select
                  name="customer_id"
                  value={editFormData.customer_id}
                  onChange={handleEditInputChange}
                  required
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                >
                  <option value="">Select Customer</option>
                  {customers.map(c => (
                    <option key={c.customer_id} value={c.customer_id}>{c.first_name} {c.last_name}</option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Package *</label>
                <Select
                  name="package_id"
                  value={editFormData.package_id}
                  onChange={handleEditInputChange}
                  required
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                >
                  <option value="">Select Package</option>
                  {packages.map(p => (
                    <option key={p.package_id} value={p.package_id}>
                      {p.pkg_name} {p.pricing_type === 'fixed' ? '(Fixed)' : '(Per Pax)'}
                    </option>
                  ))}
                </Select>
                {editFormData.package_id !== booking.package_id && (
                  <p className="text-xs text-amber-600 mt-1">⚠️ Changing package will re‑allocate equipment and reset menu selections.</p>
                )}
              </div>

              {packageCategories.length > 0 && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-2">Menu Selections</label>
                  <div className="space-y-3 bg-white p-4 rounded-2xl border border-slate-200">
                    {packageCategories.map(cat => {
                      const items = categoryMenuItems[cat.category_id] || [];
                      const selected = editFormData.menu_selections[cat.category_id] || '';
                      return (
                        <div key={cat.category_id} className="flex items-center gap-4">
                          <span className="w-32 text-sm font-bold text-slate-700">{cat.category_name}</span>
                          <Select
                            value={selected}
                            onChange={(e) => handleMenuSelectionChange(cat.category_id, e.target.value)}
                            className="flex-1 border border-slate-300 rounded-lg p-2 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                            required
                          >
                            <option value="">Select Menu Item</option>
                            {items.map(item => (
                              <option key={item.menu_item_id} value={item.menu_item_id}>{item.menu_name}</option>
                            ))}
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Choose one menu item per category.</p>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Event Date & Time</label>
                <DateTimePicker
                  name="event_datetime"
                  value={editFormData.event_datetime}
                  onChange={handleEditInputChange}
                  hasError={!!editFieldErrors.event_datetime}
                  minLeadDays={3}
                />
                {editFieldErrors.event_datetime && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.event_datetime}</p>}
                <p className="text-[11px] text-slate-400 mt-1">Bookings must be made at least 3 days before the event — PG's catering policy.</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Venue</label>
                <input
                  type="text"
                  name="venue"
                  value={editFormData.venue}
                  onChange={handleEditInputChange}
                  placeholder="e.g. Grand Pavilion"
                  className={errorInputClass(!!editFieldErrors.venue, 'w-full border rounded-lg p-2.5 text-sm outline-none')}
                />
                {editFieldErrors.venue && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.venue}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Pax Count</label>
                  <input
                    type="number"
                    name="pax_count"
                    value={editFormData.pax_count}
                    onChange={handleEditInputChange}
                    placeholder="e.g. 80"
                    className={errorInputClass(!!editFieldErrors.pax_count, 'w-full border rounded-lg p-2.5 text-sm outline-none')}
                  />
                  {editFieldErrors.pax_count && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.pax_count}</p>}
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Motif Color</label>
                  <input
                    type="text"
                    name="motif_color"
                    value={editFormData.motif_color}
                    onChange={handleEditInputChange}
                    placeholder="e.g. Burgundy"
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Total Amount (auto-calculated)</label>
                  <input
                    type="number"
                    name="total_amount"
                    value={editComputedTotal}
                    placeholder="Auto-calculated"
                    disabled
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none bg-slate-50 text-slate-600"
                  />
                  {editFieldErrors.total_amount && <p className="text-xs text-red-600 font-semibold mt-1">{editFieldErrors.total_amount}</p>}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Notes</label>
                <textarea
                  name="notes"
                  value={editFormData.notes}
                  onChange={handleEditInputChange}
                  rows="2"
                  placeholder="Special instructions..."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45] resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => setIsEditModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : 'Update Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== ASSIGN EQUIPMENT MODAL ===== */}
      {isAssignEquipModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-xl w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Assign Equipment to Booking</h2>
              <button
                onClick={() => setIsAssignEquipModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleAssignEquipSubmit} className="p-6 space-y-5 bg-[#fbfcfd] text-left">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm">
                <p><span className="font-medium">Booking:</span> {booking.booking_number || `BKG-${booking.booking_id.slice(0, 8)}`} – {booking.customer?.first_name} {booking.customer?.last_name}</p>
                <p className="text-xs text-slate-500 mt-1">Equipment will be assigned to this booking only.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Select Equipment</label>
                  <div className="relative mb-1.5">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" size={13} />
                    <input
                      type="text"
                      placeholder="Search equipment..."
                      value={equipSearchTerm}
                      onChange={(e) => setEquipSearchTerm(e.target.value)}
                      className="w-full pl-7 pr-2 py-1.5 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none bg-white"
                    />
                  </div>
                  <Select
                    name="equipment_id"
                    value={assignEquipData.equipment_id}
                    onChange={handleAssignEquipChange}
                    disabled={assignSnapshot.status === 'loading'}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm bg-white focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none font-medium text-slate-800"
                    required
                  >
                    <option value="">
                      {assignSnapshot.status === 'loading' ? `Checking availability for ${assignEventDay}…` : 'Choose equipment...'}
                    </option>
                    {equipmentList
                      .filter(eq => eq.eqm_name.toLowerCase().includes(equipSearchTerm.toLowerCase()))
                      .map((eq) => {
                        // Free on the event date (see openAssignEquipModal);
                        // null means the snapshot failed, so fall back to raw
                        // stock. Nothing free that day cannot be picked.
                        const free = freeOnEventDay(eq.equipment_id);
                        const noneFree = free !== null && free <= 0;
                        return (
                          <option key={eq.equipment_id} value={eq.equipment_id} disabled={noneFree}>
                            {eq.eqm_name} — {free === null
                              ? `${eq.quantity_available} in stock`
                              : noneFree
                                ? `none available on ${assignEventDay}`
                                : `${free} available on ${assignEventDay}`}{eq.equipment_type === 'Decoration' ? ' (Decoration)' : ''}
                          </option>
                        );
                      })}
                  </Select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5">Quantity</label>
                  <input
                    type="number"
                    name="quantity"
                    min="1"
                    max={assignQuantityMax}
                    value={assignEquipData.quantity}
                    onChange={handleAssignEquipChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Notes (optional)</label>
                <textarea
                  name="notes"
                  rows="2"
                  placeholder="Any special instructions..."
                  value={assignEquipData.notes}
                  onChange={handleAssignEquipChange}
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm text-slate-700 focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAssignEquipModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isAssignSubmitting}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm cursor-pointer disabled:opacity-50"
                >
                  {isAssignSubmitting ? 'Assigning...' : 'Assign Equipment'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== RECORD PAYMENT MODAL ===== */}
      {isPaymentModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Record Receipt</h2>
              <button
                onClick={() => setIsPaymentModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handlePaymentSubmit} className="p-6 overflow-y-auto space-y-6 bg-[#fbfcfd] text-left">
              <div className="bg-[#F8F9FA] border border-slate-200 rounded-lg p-4 space-y-2 text-sm">
                <h4 className="font-bold text-slate-900 text-sm mb-2">Booking Details</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  <span className="text-slate-600 font-medium">Customer:</span>
                  <span className="text-slate-900 font-semibold">
                    {booking.customer ? `${booking.customer.first_name} ${booking.customer.last_name}` : 'Unknown'}
                  </span>
                  <span className="text-slate-600 font-medium">Type:</span>
                  <span className="text-slate-900 font-semibold">{booking.booking_type || 'N/A'}</span>
                  <span className="text-slate-600 font-medium">Venue:</span>
                  <span className="text-slate-900 font-semibold">{booking.venue || 'N/A'}</span>
                  <span className="text-slate-600 font-medium">Event Date:</span>
                  <span className="text-slate-900 font-semibold">
                    {booking.event_datetime ? new Date(booking.event_datetime).toLocaleString() : 'N/A'}
                  </span>
                  <span className="text-slate-600 font-medium">Contract Amount:</span>
                  <span className="text-slate-900 font-bold text-[#008A45]">
                    ₱{booking.total_amount?.toLocaleString() || '0'}
                  </span>
                  <span className="text-slate-600 font-medium">Collected:</span>
                  <span className="text-slate-900 font-semibold">₱{positivePayments.toLocaleString()}</span>
                  <span className="text-slate-600 font-medium">Balance Due:</span>
                  <span className={`font-semibold ${remainingBalance <= 0 ? 'text-green-700' : 'text-amber-700'}`}>
                    ₱{remainingBalance.toLocaleString()}
                  </span>
                  <span className="text-slate-600 font-medium">Status:</span>
                  <span className="text-slate-900 font-semibold capitalize">{booking.booking_status || 'N/A'}</span>
                  <span className="text-slate-600 font-medium">Deposit?</span>
                  <span className="text-slate-900 font-semibold">{positivePayments === 0 ? '✅ Yes' : 'No'}</span>
                </div>
              </div>

              <ReceiptFields
                amount={paymentFormData.amount}
                onAmountChange={handlePaymentInputChange}
                method={paymentFormData.pay_method}
                onMethodChange={handlePaymentMethodChange}
                receiptReference={paymentFormData.receipt_reference}
                onReceiptReferenceChange={handlePaymentInputChange}
                file={selectedFile}
                onFileChange={handlePaymentFileChange}
                errors={{ amount: paymentAmountError, receipt: paymentReceiptError, file: paymentFileError }}
                priorPaid={priorPaid}
                total={booking.total_amount || 0}
              />

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => setIsPaymentModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button type="submit" disabled={isPaymentSubmitting || uploading} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50">
                  {uploading ? 'Uploading...' : (isPaymentSubmitting ? 'Saving...' : 'Record Receipt')}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== CANCEL BOOKING MODAL ===== */}
      {isCancelModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Cancel Booking</h2>
              <button
                onClick={() => setIsCancelModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 bg-[#fbfcfd]">
              <div className={`p-3 rounded-lg text-sm border ${eventDate && daysUntilEvent < 3 ? 'bg-red-50 border-red-200 text-red-700' : 'bg-amber-50 border-amber-200 text-amber-700'}`}>
                <p className="font-bold">Event Date: {eventDate ? new Date(eventDate).toLocaleString() : 'N/A'}</p>
                {eventDate && daysUntilEvent !== null && (
                  <p>{daysUntilEvent >= 0 ? `${daysUntilEvent} days until event` : 'Event has already passed'}</p>
                )}
                <p className="mt-1">Total paid: <span className="font-bold">₱{positivePayments.toLocaleString()}</span></p>

                {positivePayments > 0 ? (
                  <>
                    {eventDate && daysUntilEvent !== null && daysUntilEvent < 3 && daysUntilEvent >= 0 && (
                      <p className="font-bold mt-1 text-red-600">⚠️ Cancellation is within 3 days – downpayment is NON‑REFUNDABLE per policy.</p>
                    )}
                    {eventDate && daysUntilEvent !== null && daysUntilEvent >= 3 && (
                      <p className="font-bold mt-1 text-green-700">✅ Cancellation is 3+ days before event – downpayment IS refundable.</p>
                    )}
                    {!isRefundable && downpaymentPaid > 0 && (
                      <p className="mt-1 text-xs text-red-600">Deposit (₱{downpaymentPaid.toLocaleString()}) will be forfeited.</p>
                    )}
                    {isRefundable && downpaymentPaid > 0 && (
                      <p className="mt-1 text-xs text-green-600">Deposit is refundable as per policy.</p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">No payments have been made, so no refund is applicable.</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Cancellation Reason *</label>
                <textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  rows="3"
                  placeholder="e.g. Customer cancelled, rescheduled, budget issues"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                  required
                />
              </div>

{isRefundable && (() => {
  const maxRefundable = positivePayments; // since it's refundable, all payments are refundable
  return maxRefundable > 0 && (
    <div className="border-t border-slate-200 pt-3 mt-3">
      <p className="text-xs font-bold text-slate-700 mb-2">
        Record Refund Details <span className="font-normal text-slate-400">(optional – leave blank to skip)</span>
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-0.5">Refund Amount (₱)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
            placeholder="Enter amount (optional)"
            className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none"
          />
          <p className="text-[10px] text-slate-400 mt-0.5">Max: ₱{positivePayments.toLocaleString()}</p>
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-0.5">Remarks</label>
          <input
            type="text"
            value={refundRemarks}
            onChange={(e) => setRefundRemarks(e.target.value)}
            placeholder="Reason for refund"
            className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none"
          />
        </div>
      </div>
      <div className="mt-2">
        <RefundMethodField value={refundMethod} onChange={setRefundMethod} receiptNo={refundReceiptNo} onReceiptNoChange={setRefundReceiptNo} />
        <ImageUploadField
          label="Receipt / Proof of Refund"
          required={refundMethod !== 'Cash'}
          note={refundMethod === 'Cash' ? '(optional for cash)' : '(required if amount entered)'}
          file={refundFile}
          onChange={(e) => setRefundFile(e.target.files[0])}
        />
      </div>
    </div>
  );
})()}

              {positivePayments > 0 && !isRefundable && downpaymentPaid > 0 && (
                <div className="border-t border-slate-200 pt-3 mt-3 text-xs text-slate-500">
                  <p>⚠️ This booking is <strong>non‑refundable</strong> because the event is less than 3 days away. The deposit of ₱{downpaymentPaid.toLocaleString()} will be forfeited.</p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsCancelModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCancelBooking}
                  disabled={isCancelling}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                >
                  {isCancelling ? 'Processing...' : 'Confirm Cancellation'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== EDIT EQUIPMENT QUANTITY MODAL ===== */}
      {isEditEquipModalOpen && editingAssignment && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Edit Equipment Quantity</h2>
              <button onClick={() => setIsEditEquipModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleEditEquipSubmit} className="p-6 space-y-4 bg-[#fbfcfd]">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Equipment</label>
                <p className="text-sm font-medium text-slate-900">{editingAssignment.eqm_name}</p>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Quantity</label>
                <input type="number" min={Math.max(1, editingAssignment.returned_quantity || 0)} value={editEquipData.quantity} onChange={(e) => setEditEquipData({ quantity: parseInt(e.target.value) || 1 })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-[#008A45]" required />
                <p className="text-[11px] text-slate-500 mt-1">
                  Currently {editingAssignment.quantity}. Raising it is checked against what is free on the event date.
                  {(editingAssignment.returned_quantity || 0) > 0 && ` It can't go below the ${editingAssignment.returned_quantity} already recorded as returned.`}
                </p>
              </div>
              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setIsEditEquipModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button type="submit" disabled={isAssignSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50">
                  {isAssignSubmitting ? 'Updating...' : 'Update Quantity'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== REJECTION REASON MODAL ===== */}
      {isRejectionModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Rejection Reason</h2>
              <button onClick={() => setIsRejectionModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 bg-[#fbfcfd]">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Rejection *</label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  rows="3"
                  placeholder="e.g., Incomplete details, customer requested cancellation, etc."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none resize-none"
                  required
                />
                <p className="text-xs text-slate-400 mt-1">Reason is required.</p>
              </div>

              {showRejectionRefund && (
                <div className="border-t border-slate-200 pt-3 mt-3">
                  <p className="text-xs font-bold text-slate-700 mb-2">
                    Process Refund <span className="font-normal text-slate-400">(optional – leave blank to skip)</span>
                  </p>
                  <p className="text-xs text-slate-500 mb-2">Max refundable: ₱{rejectionMaxRefundable.toLocaleString()}</p>
                  <p className="text-xs text-red-500 mb-2">* Proof of refund is required if you enter an amount.</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">Refund Amount (₱)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={rejectionRefundAmount}
                        onChange={(e) => setRejectionRefundAmount(e.target.value)}
                        placeholder="Enter amount (optional)"
                        className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-0.5">Remarks</label>
                      <input
                        type="text"
                        value={rejectionRefundRemarks}
                        onChange={(e) => setRejectionRefundRemarks(e.target.value)}
                        placeholder="Reason for refund"
                        className="w-full border border-slate-300 rounded-lg p-2 text-sm focus:border-[#008A45] outline-none"
                      />
                    </div>
                  </div>
                  <div className="mt-2">
                    <RefundMethodField value={rejectionRefundMethod} onChange={setRejectionRefundMethod} receiptNo={rejectionRefundReceiptNo} onReceiptNoChange={setRejectionRefundReceiptNo} />
                    <ImageUploadField
                      label="Receipt / Proof of Refund"
                      required={rejectionRefundMethod !== 'Cash'}
                      note={rejectionRefundMethod === 'Cash' ? '(optional for cash)' : '(required if amount entered)'}
                      file={rejectionRefundFile}
                      onChange={(e) => setRejectionRefundFile(e.target.files[0])}
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsRejectionModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRejectConfirm}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm"
                >
                  Confirm Rejection
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== REFUND AFTER REJECTION/CANCELLATION MODAL ===== */}
      {isRefundModalOpen && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Record Refund</h2>
              <button onClick={() => setIsRefundModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleRefundSubmit} className="p-6 space-y-4 bg-[#fbfcfd]">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-sm">
                <p><span className="font-medium">Booking:</span> {booking.booking_number || `BKG-${booking.booking_id.slice(0, 8)}`} – {booking.customer?.first_name} {booking.customer?.last_name}</p>
                <p className="text-xs text-slate-500 mt-1">Refundable amount: ₱{remainingRefundableAmount.toLocaleString()}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Refund Amount (₱)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={refundModalAmount}
                  onChange={(e) => setRefundModalAmount(e.target.value)}
                  placeholder="e.g. 5000"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:border-[#008A45] outline-none"
                  required
                />
                <p className="text-xs text-slate-400 mt-0.5">Max: ₱{remainingRefundableAmount.toLocaleString()}</p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Remarks</label>
                <input
                  type="text"
                  value={refundModalRemarks}
                  onChange={(e) => setRefundModalRemarks(e.target.value)}
                  placeholder="Reason for refund"
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:border-[#008A45] outline-none"
                />
              </div>

              <RefundMethodField value={refundModalMethod} onChange={setRefundModalMethod} receiptNo={refundModalReceiptNo} onReceiptNoChange={setRefundModalReceiptNo} />
              <ImageUploadField
                label="Proof of Refund"
                required={refundModalMethod !== 'Cash'}
                file={refundModalFile}
                onChange={(e) => setRefundModalFile(e.target.files[0])}
                hint={refundModalMethod === 'Cash' ? 'Optional for cash — the receipt number is the proof.' : 'PNG, JPG up to 5MB. Proof image is required.'}
              />

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setIsRefundModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2 rounded-lg border border-slate-300 transition-colors">Cancel</button>
                <button type="submit" disabled={isRefundSubmitting} className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2 rounded-lg transition-colors shadow-sm disabled:opacity-50">
                  {isRefundSubmitting ? 'Processing...' : 'Record Refund'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* ===== APPROVAL MODAL ===== */}
      {isApprovalModalOpen && approvalBooking && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200 shrink-0">
              <h2 className="text-lg font-bold text-slate-900">Approve Booking – Adjust Fees</h2>
              <button
                onClick={() => setIsApprovalModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6 bg-[#fbfcfd] text-left">
              <div className="bg-white p-4 rounded-2xl border border-slate-200 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="font-medium text-slate-600">Customer:</span>
                  <span className="font-bold text-slate-900">
                    {approvalBooking.customer?.first_name} {approvalBooking.customer?.last_name}
                  </span>
                  <span className="font-medium text-slate-600">Package:</span>
                  <span className="font-bold text-slate-900">{approvalBooking.package?.pkg_name}</span>
                  <span className="font-medium text-slate-600">Current Pax:</span>
                  <span className="font-bold text-slate-900">{approvalBooking.pax_count}</span>
                  <span className="font-medium text-slate-600">Current Total:</span>
                  <span className="font-bold text-slate-900">₱{approvalBooking.total_amount?.toLocaleString() || '0'}</span>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  {/* The extra-pax input is hidden on a fixed package — it covers
                      a band and refuses anything outside it — so this line must
                      not keep offering it. Per-pax packages still have it. */}
                  {approvalBooking.package?.pricing_type === 'fixed'
                    ? '* Add fees below.'
                    : '* Adjust extra pax or add fees below.'}
                </p>
              </div>

              <ApprovalAvailabilityCheck
                onVehicleSelectionChange={setApprovalVehicleIds}
                booking={approvalBooking}
                effectivePaxCount={(approvalBooking.pax_count || 0) + (approvalData.extraPax || 0)}
                onEquipmentStatusChange={setApprovalEquipmentStatus}
              />

              <div className="space-y-4">
                {/* Hidden on a fixed package. It covers a band now, and a
                    booking outside that band is refused — so extra guests
                    cannot change the total, and a field that cannot change
                    anything should not be asking for a number. Per-pax
                    packages have no cap and keep it. */}
                {approvalBooking.package?.pricing_type !== 'fixed' && (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Extra Pax (additional guests)</label>
                  <input
                    type="number"
                    name="extraPax"
                    min="0"
                    value={approvalData.extraPax}
                    onChange={handleApprovalInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Each extra guest costs ₱{extraPaxRate(approvalBooking.package).toLocaleString()}
                    {approvalBooking.package?.pricing_type === 'per_pax'
                      ? ' (this package is priced per guest).'
                      : ' (the extra-guest rate for this fixed-price package).'}
                  </p>
                </div>
                )}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Other Fees (add-ons, extra services)</label>
                  <input
                    type="number"
                    name="additionalFee"
                    min="0"
                    step="0.01"
                    value={approvalData.additionalFee}
                    onChange={handleApprovalInputChange}
                    className="w-full border border-slate-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-[#008A45]/20 focus:border-[#008A45] outline-none"
                    placeholder="e.g. 2000"
                  />
                </div>
              </div>

              <div className="bg-[#EAF3F2] border border-[#d2e8e5] rounded-lg p-4 flex justify-between items-center">
                <span className="font-bold text-slate-800">New Total:</span>
                <span className="text-xl font-extrabold text-[#008A45]">₱{approvalData.newTotal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
              </div>
              <div className="text-sm text-slate-500">
                <p>Deposit (50%): <span className="font-bold">₱{(approvalData.newTotal * 0.5).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></p>
                <p className="text-xs mt-1">A deposit is required to secure the booking. Non-refundable within 3 days of the event.</p>
              </div>

              {approvalEquipmentStatus.applicable && !approvalEquipmentStatus.loading && !approvalEquipmentStatus.sufficient && (
                <p className="text-xs font-semibold text-red-600 text-right">
                  Can't approve — not enough {approvalEquipmentStatus.shortages.map(s => s.eqm_name).join(', ')} for this date.
                </p>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsApprovalModalOpen(false)}
                  className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleFinalizeApproval('package')}
                  disabled={approveDisabled}
                  title={approveDisabled && !isApprovalSubmitting ? 'Not enough equipment for this date' : undefined}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isApprovalSubmitting ? 'Approving...' : 'Confirm Approval & Update Total'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== PROOF IMAGE MODAL ===== */}
      {isProofModalOpen && proofModalUrl && createPortal(
        <div
          className="fixed inset-0 z-[99999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsProofModalOpen(false)}
        >
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">Payment Proof</h3>
              <button
                onClick={() => setIsProofModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 flex items-center justify-center max-h-[75vh] overflow-auto">
              <img src={proofModalUrl} alt="Payment proof" className="max-w-full max-h-full object-contain rounded-lg" />
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-slate-50 border-t border-slate-200">
              <button
                onClick={() => setIsProofModalOpen(false)}
                className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors"
              >
                Close
              </button>
              <a
                href={proofModalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-[#008A45] hover:bg-[#007038] text-white font-semibold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors"
              >
                Open in New Tab
              </a>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== VERIFY PAYMENT MODAL ===== */}
      {isVerifyModalOpen && verifyTarget && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Verify Payment</h2>
              <button onClick={() => setIsVerifyModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 bg-[#fbfcfd] text-left">
              <p className="text-sm text-slate-600">Review the proof and confirm this payment is legitimate.</p>

              <div className="flex gap-4 items-center bg-slate-50 border border-slate-200 rounded-lg p-3">
                <button
                  type="button"
                  onClick={() => {
                    const url = getProofUrl(verifyTarget.pay_proof);
                    if (url) { setProofModalUrl(url); setIsProofModalOpen(true); }
                  }}
                  className="shrink-0 w-20 h-20 rounded-lg border border-slate-200 overflow-hidden bg-white flex items-center justify-center hover:shadow-md transition-shadow"
                  title="Click to view full proof"
                >
                  {verifyTarget.pay_proof && verifyTarget.pay_proof !== 'placeholder.png' && verifyTarget.pay_proof !== 'refund_placeholder.png' ? (
                    <img src={getProofUrl(verifyTarget.pay_proof)} alt="Payment proof" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] text-slate-400 italic px-1 text-center">No proof</span>
                  )}
                </button>
                <div className="flex-1 space-y-1.5">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Amount</span>
                    <span className="font-bold text-[#008A45]">₱{(verifyTarget.amount_paid || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Booking Total</span>
                    <span className="font-semibold text-slate-900">₱{(booking?.total_amount || 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Payment Method *</label>
                <div className="grid grid-cols-2 gap-2">
                  {VERIFY_METHODS.map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setVerifyMethod(method)}
                      className={`flex items-center justify-center gap-1.5 p-2.5 rounded-lg border-2 font-semibold text-xs transition-all ${
                        verifyMethod === method
                          ? 'border-[#008A45] bg-[#EAF3F2] text-slate-900'
                          : 'border-slate-300 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <div className={`w-3 h-3 rounded-full border flex items-center justify-center ${verifyMethod === method ? 'border-[#008A45]' : 'border-slate-400'}`}>
                        {verifyMethod === method && <div className="w-1.5 h-1.5 rounded-full bg-[#008A45]" />}
                      </div>
                      {method}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsVerifyModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleVerifyConfirm}
                  disabled={isVerifying}
                  className="bg-[#008A45] hover:bg-[#007038] text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isVerifying ? 'Verifying...' : 'Verify Payment'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ===== REJECT PAYMENT PROOF MODAL ===== */}
      {isRejectProofModalOpen && rejectProofTarget && createPortal(
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-[2px] z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
            <div className="flex justify-between items-center px-6 py-5 border-b border-slate-200">
              <h2 className="text-lg font-bold text-slate-900">Reject Payment Proof</h2>
              <button onClick={() => setIsRejectProofModalOpen(false)} className="text-slate-400 hover:text-slate-700 border border-slate-300 rounded-md p-1">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 space-y-4 bg-[#fbfcfd] text-left">
              <p className="text-sm text-slate-600">
                Rejecting the proof for the ₱{(rejectProofTarget.amount_paid || 0).toLocaleString()} payment submitted by the customer. They'll need to resubmit — let them know why.
              </p>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Reason *</label>
                <textarea
                  value={rejectProofReason}
                  onChange={(e) => setRejectProofReason(e.target.value)}
                  rows="3"
                  placeholder="e.g. Proof image is unreadable, amount doesn't match, wrong receiving account..."
                  className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-red-400 resize-none"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setIsRejectProofModalOpen(false)} className="bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm px-6 py-2.5 rounded-lg border border-slate-300 transition-colors">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRejectProofConfirm}
                  disabled={isVerifying}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold text-sm px-6 py-2.5 rounded-lg shadow-sm transition-colors disabled:opacity-50"
                >
                  {isVerifying ? 'Rejecting...' : 'Reject Proof'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
      {/* In place, next to the page's other modals — assigning a vehicle is
          a decision about THIS booking, so it should not cost the manager
          their place on the page. */}
      {isAssignVehicleOpen && (
        <AssignVehicleModal
          booking={booking}
          isOpen={isAssignVehicleOpen}
          onClose={() => setIsAssignVehicleOpen(false)}
          onAssigned={fetchBooking}
        />
      )}
      {editingVehicleRun && (
        <AssignVehicleModal
          key={editingVehicleRun.assignment_id}
          booking={booking}
          isOpen
          editingRun={editingVehicleRun}
          onClose={() => setEditingVehicleRun(null)}
          onAssigned={fetchBooking}
        />
      )}

      <OverrideStatusModal
        booking={booking}
        isOpen={isOverrideOpen}
        onClose={() => setIsOverrideOpen(false)}
        verifiedPaid={Number(money?.verified_paid) || 0}
        isLapsed={!!money?.is_lapsed}
        onDone={() => { setHistoryKey(k => k + 1); fetchBooking(); }}
      />
    </div>
  );
}